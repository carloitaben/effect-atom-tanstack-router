import * as Cause from "effect/Cause"
import * as Formatter from "effect/Formatter"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import type { AtomRegistry, Node } from "effect/reactivity/AtomRegistry"

/**
 * Lifecycle state reported by an Effect Atom registry node.
 */
export type AtomNodeState = ReturnType<Node<any>["currentState"]>

/**
 * One captured child of a snapshot value.
 */
export interface AtomValueEntry {
  readonly key: string
  readonly value: AtomValueNode
}

/**
 * A frozen, display-only slice of a value, captured when the snapshot was
 * taken.
 *
 * Nodes never contain live references to application objects, so a paused pane
 * keeps showing the sampled data even if the application mutates it later. Only
 * plain objects and arrays have `entries`; everything else is a `leaf` with a
 * bounded `preview`.
 */
export interface AtomValueNode {
  readonly kind: "leaf" | "array" | "object"
  /** Bounded display text. Branch previews are placeholders. */
  readonly preview: string
  /** Captured entries in key order. Empty for `leaf` nodes. */
  readonly entries: ReadonlyArray<AtomValueEntry>
  /** Entries present in the live value but not captured. */
  readonly omitted: number
  /** True when a depth, entry, or node limit cut this node short. */
  readonly truncated: boolean
}

/**
 * Cached value reported for a node.
 *
 * `uninitialized` nodes are deliberately left unread: reading them would build
 * the atom. `stale` values are the last value the registry committed and are
 * shown as-is, without rebuilding the atom.
 */
export type AtomValueSnapshot =
  | {
      readonly status: "uninitialized"
    }
  | {
      readonly status: "valid" | "stale"
      /** Frozen, bounded capture taken at sample time. */
      readonly value: AtomValueNode
      readonly preview: string
    }

/**
 * Structural summary of an `AsyncResult` value.
 */
export type AtomAsyncResultSnapshot =
  | {
      readonly tag: "Initial"
      readonly waiting: boolean
      readonly preview: string
    }
  | {
      readonly tag: "Success"
      readonly waiting: boolean
      readonly value: AtomValueNode
      readonly preview: string
    }
  | {
      readonly tag: "Failure"
      readonly waiting: boolean
      readonly cause: AtomValueNode
      readonly hasPreviousSuccess: boolean
      readonly preview: string
    }

/**
 * A point-in-time, read-only description of one registry node.
 */
export interface AtomNodeSnapshot {
  readonly id: string
  readonly name: string
  readonly key: string | null
  readonly state: AtomNodeState
  readonly keepAlive: boolean
  readonly lazy: boolean
  readonly idleTTL: number | null
  readonly listeners: number
  readonly canBeRemoved: boolean
  readonly value: AtomValueSnapshot
  readonly asyncResult: AtomAsyncResultSnapshot | null
  readonly parents: ReadonlyArray<string>
  readonly children: ReadonlyArray<string>
  /** Why this node could not be fully inspected, or `null` when it could. */
  readonly error: string | null
}

/**
 * A point-in-time snapshot of a registry.
 *
 * This is a sample, not a timeline: it contains no history and cannot observe
 * changes that happen between samples.
 */
export interface AtomRegistrySnapshot {
  readonly sampledAt: number
  readonly nodes: ReadonlyArray<AtomNodeSnapshot>
  readonly totalNodes: number
  readonly truncated: boolean
  readonly counts: {
    readonly valid: number
    readonly stale: number
    readonly uninitialized: number
    readonly removed: number
  }
}

export interface AtomInspectorOptions {
  /**
   * Maximum number of nodes included in a snapshot. Defaults to `1000`.
   */
  readonly maxNodes?: number
  /**
   * Maximum number of characters in a value preview. Defaults to `400`.
   */
  readonly maxPreviewLength?: number
}

const DEFAULT_MAX_NODES = 1000
const DEFAULT_MAX_PREVIEW_LENGTH = 400

/**
 * Preview depth and width are capped independently of `maxPreviewLength` so a
 * single enormous value cannot make one sample do unbounded work.
 */
const PREVIEW_MAX_DEPTH = 2
const PREVIEW_MAX_ENTRIES = 10

/**
 * Bounds for the captured display tree. The tree is what the pane expands, so
 * it is capped by depth, entries per node, and total nodes per value. The
 * preview budget bounds the amount of text captured across the whole tree.
 */
const CAPTURE_MAX_DEPTH = 5
const CAPTURE_MAX_ENTRIES = 50
const CAPTURE_MAX_NODES = 200
const CAPTURE_MAX_LEAF_PREVIEW = 160
const CAPTURE_MAX_PREVIEW_BUDGET = 2000

const truncate = (text: string, maxLength: number): string =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`

const errorMessage = (error: unknown): string => {
  try {
    return error instanceof Error
      ? error.message
      : "Could not inspect atom node"
  } catch {
    return "Could not inspect atom node"
  }
}

interface PreviewBudget {
  remaining: number
}

/**
 * Reads an own property descriptor, which never invokes accessors.
 */
const ownDescriptor = (
  target: object,
  key: PropertyKey,
): Option.Option<PropertyDescriptor> => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    return descriptor === undefined ? Option.none() : Option.some(descriptor)
  } catch {
    return Option.none()
  }
}

/**
 * Reads an own data property. Accessors are reported as `None` instead of
 * being called.
 */
const ownData = (target: object, key: PropertyKey): Option.Option<unknown> => {
  const descriptor = ownDescriptor(target, key)
  if (Option.isNone(descriptor)) return Option.none()
  const data = descriptor.value
  return "value" in data ? Option.some(data.value) : Option.none()
}

const functionLabel = (value: Function): string => {
  const name = ownData(value, "name")
  if (Option.isNone(name) || typeof name.value !== "string") return "[Function]"
  return name.value.length === 0
    ? "[Function anonymous]"
    : `[Function ${truncate(name.value, 120)}]`
}

/**
 * Formats strings without scanning or allocating the whole input.
 *
 * `Formatter.format` would quote and escape an arbitrarily large string before
 * the caller truncates it, so strings are clipped to the remaining budget
 * first. `JSON.stringify` of that bounded prefix preserves escaping.
 */
const stringPreview = (value: string, maxLength: number): string => {
  const limit = Math.max(0, maxLength)
  if (value.length <= limit) return JSON.stringify(value)

  let end = limit
  if (end > 0) {
    const code = value.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) end -= 1
  }
  return JSON.stringify(value.slice(0, end))
}

/**
 * Formats values that have no user-defined behaviour to execute.
 *
 * Effect's `Formatter.format` is reused for primitives. It is deliberately not
 * used for objects: it calls `toString`, iterators, and property getters, which
 * would make inspection observable.
 */
const primitivePreview = (
  value: unknown,
  maxLength: number,
): Option.Option<string> => {
  if (typeof value === "function") return Option.some(functionLabel(value))
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      return Option.some(stringPreview(value, maxLength))
    }
    return Option.some(Formatter.format(value))
  }
  return Option.none()
}

/**
 * Resolves a display tag without reading `.constructor` off arbitrary values,
 * because that property can be an accessor.
 */
const objectTag = (value: object): string => {
  let proto: object | null
  try {
    proto = Object.getPrototypeOf(value)
  } catch {
    return "Object"
  }

  for (let depth = 0; proto !== null && depth < 32; depth++) {
    const constructor = ownData(proto, "constructor")
    if (Option.isSome(constructor) && typeof constructor.value === "function") {
      const name = ownData(constructor.value, "name")
      if (
        Option.isSome(name) &&
        typeof name.value === "string" &&
        name.value.length > 0
      ) {
        return name.value
      }
    }
    try {
      proto = Object.getPrototypeOf(proto)
    } catch {
      return "Object"
    }
  }

  return "Object"
}

const datePreview = (value: Date): string => {
  try {
    const time = Reflect.apply(Date.prototype.getTime, value, [])
    if (typeof time !== "number" || Number.isNaN(time)) return "Invalid Date"
    const iso = Reflect.apply(Date.prototype.toISOString, value, [])
    return typeof iso === "string" ? iso : "Invalid Date"
  } catch {
    return "Invalid Date"
  }
}

const REGEXP_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["hasIndices", "d"],
  ["global", "g"],
  ["ignoreCase", "i"],
  ["multiline", "m"],
  ["dotAll", "s"],
  ["unicode", "u"],
  ["unicodeSets", "v"],
  ["sticky", "y"],
]

const regexpFlags = (value: RegExp): string => {
  let flags = ""
  for (const [name, flag] of REGEXP_FLAGS) {
    const getter = Object.getOwnPropertyDescriptor(RegExp.prototype, name)?.get
    if (getter === undefined) continue
    try {
      if (Reflect.apply(getter, value, []) === true) flags += flag
    } catch {
      return ""
    }
  }
  return flags
}

const regexpPreview = (value: RegExp): string => {
  try {
    const getter = Object.getOwnPropertyDescriptor(
      RegExp.prototype,
      "source",
    )?.get
    const source =
      getter === undefined ? undefined : Reflect.apply(getter, value, [])
    return typeof source === "string"
      ? `/${source}/${regexpFlags(value)}`
      : "[RegExp]"
  } catch {
    return "[RegExp]"
  }
}

const formatProperty = (
  target: object,
  key: PropertyKey,
  depth: number,
  budget: PreviewBudget,
  ancestors: WeakSet<object>,
): string => {
  const descriptor = ownDescriptor(target, key)
  if (Option.isNone(descriptor)) return "<empty>"

  const data = descriptor.value
  if (!("value" in data)) return accessorLabel(data)

  return formatValue(data.value, depth + 1, budget, ancestors)
}

const mapPreview = (
  value: Map<unknown, unknown>,
  depth: number,
  budget: PreviewBudget,
  ancestors: WeakSet<object>,
): string => {
  let size = 0
  const parts: Array<string> = []

  try {
    const sizeGetter = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "size",
    )?.get
    if (sizeGetter !== undefined) {
      const measured = Reflect.apply(sizeGetter, value, [])
      if (typeof measured === "number") size = measured
    }

    const iterator = Reflect.apply(
      Map.prototype.entries,
      value,
      [],
    ) as IterableIterator<[unknown, unknown]>
    for (let step = iterator.next(); !step.done; step = iterator.next()) {
      if (budget.remaining <= 0 || parts.length >= PREVIEW_MAX_ENTRIES) break
      const [key, entry] = step.value
      const text = `${formatValue(key, depth + 1, budget, ancestors)} => ${formatValue(
        entry,
        depth + 1,
        budget,
        ancestors,
      )}`
      budget.remaining -= text.length
      parts.push(text)
    }
  } catch {
    return "Map"
  }

  if (size > parts.length) parts.push("…")
  return `Map(${size}) { ${parts.join(", ")} }`
}

const setPreview = (
  value: Set<unknown>,
  depth: number,
  budget: PreviewBudget,
  ancestors: WeakSet<object>,
): string => {
  let size = 0
  const parts: Array<string> = []

  try {
    const sizeGetter = Object.getOwnPropertyDescriptor(
      Set.prototype,
      "size",
    )?.get
    if (sizeGetter !== undefined) {
      const measured = Reflect.apply(sizeGetter, value, [])
      if (typeof measured === "number") size = measured
    }

    const iterator = Reflect.apply(
      Set.prototype.values,
      value,
      [],
    ) as IterableIterator<unknown>
    for (let step = iterator.next(); !step.done; step = iterator.next()) {
      if (budget.remaining <= 0 || parts.length >= PREVIEW_MAX_ENTRIES) break
      const text = formatValue(step.value, depth + 1, budget, ancestors)
      budget.remaining -= text.length
      parts.push(text)
    }
  } catch {
    return "Set"
  }

  if (size > parts.length) parts.push("…")
  return `Set(${size}) { ${parts.join(", ")} }`
}

const arrayPreview = (
  value: ReadonlyArray<unknown>,
  depth: number,
  budget: PreviewBudget,
  ancestors: WeakSet<object>,
): string => {
  const length = ownData(value, "length")
  if (Option.isNone(length) || typeof length.value !== "number")
    return "[Array]"

  const total = length.value
  const parts: Array<string> = []

  for (
    let index = 0;
    index < total && parts.length < PREVIEW_MAX_ENTRIES;
    index++
  ) {
    if (budget.remaining <= 0) break
    const text = formatProperty(value, index, depth, budget, ancestors)
    budget.remaining -= text.length
    parts.push(text)
  }

  if (total > parts.length) parts.push("…")
  return `[${parts.join(", ")}]`
}

const objectPreview = (
  value: object,
  depth: number,
  budget: PreviewBudget,
  ancestors: WeakSet<object>,
): string => {
  const tag = objectTag(value)
  const isError = tag.endsWith("Error")
  const message = isError ? ownData(value, "message") : Option.none()

  let keys: Array<string>
  try {
    keys = Object.keys(value)
  } catch {
    return isError ? tag : tag === "Object" ? "{…}" : `${tag} {…}`
  }

  const parts: Array<string> = []
  for (const key of keys) {
    if (budget.remaining <= 0 || parts.length >= PREVIEW_MAX_ENTRIES) break
    const displayKey = JSON.stringify(
      truncate(key, Math.max(0, Math.min(budget.remaining, 80))),
    )
    const text = `${displayKey}: ${formatProperty(
      value,
      key,
      depth,
      budget,
      ancestors,
    )}`
    budget.remaining -= text.length
    parts.push(text)
  }

  const body =
    parts.length === 0
      ? ""
      : `{ ${parts.join(", ")}${keys.length > parts.length ? ", …" : ""} }`

  if (isError && Option.isSome(message) && typeof message.value === "string") {
    const summary = truncate(message.value, Math.max(0, budget.remaining))
    const label = summary.length === 0 ? tag : `${tag}: ${summary}`
    return body === "" ? label : `${label} ${body}`
  }

  if (tag === "Object") return body === "" ? "{}" : body
  return body === "" ? `${tag} {}` : `${tag} ${body}`
}

const formatValue = (
  value: unknown,
  depth: number,
  budget: PreviewBudget,
  ancestors: WeakSet<object>,
): string => {
  if (budget.remaining <= 0) return "…"

  const primitive = primitivePreview(value, budget.remaining)
  if (Option.isSome(primitive)) {
    budget.remaining -= primitive.value.length
    return primitive.value
  }

  const object = value as object
  if (ancestors.has(object)) {
    budget.remaining -= "[Circular]".length
    return "[Circular]"
  }

  if (depth > PREVIEW_MAX_DEPTH) {
    const placeholder = Array.isArray(object) ? "[…]" : "{…}"
    budget.remaining -= placeholder.length
    return placeholder
  }

  ancestors.add(object)
  try {
    if (Array.isArray(object)) {
      return arrayPreview(object, depth, budget, ancestors)
    }
    if (object instanceof Date) return datePreview(object)
    if (object instanceof RegExp) return regexpPreview(object)
    if (object instanceof Map)
      return mapPreview(object, depth, budget, ancestors)
    if (object instanceof Set)
      return setPreview(object, depth, budget, ancestors)
    return objectPreview(object, depth, budget, ancestors)
  } catch {
    return "[Unserializable value]"
  } finally {
    ancestors.delete(object)
  }
}

/**
 * Produces a compact, bounded display string for an arbitrary value.
 *
 * Formatting is observational: it reads own property descriptors instead of
 * properties, so getters, `toJSON`, `toString`, `valueOf`, and
 * `Symbol.toPrimitive` are never called. Circular references, throwing
 * accessors, and hostile values are reported rather than propagated.
 *
 * Proxies are the remaining exception: enumerating or describing a proxy runs
 * its traps, which is unavoidable for any inspection.
 */
export const previewValue = (
  value: unknown,
  maxLength = DEFAULT_MAX_PREVIEW_LENGTH,
): string => {
  try {
    return truncate(
      formatValue(value, 0, { remaining: maxLength }, new WeakSet()),
      maxLength,
    )
  } catch {
    return "[Unserializable value]"
  }
}

/**
 * A compact preview for objects the tree cannot expand.
 *
 * Unlike `formatValue`, this does not enumerate keys or run iterators. It only
 * reads tags and, for errors, the own `message` descriptor.
 */
const opaqueLeafPreview = (value: object): string => {
  try {
    if (value instanceof Date) return datePreview(value)
    if (value instanceof RegExp) return regexpPreview(value)

    const tag = objectTag(value)
    if (tag.endsWith("Error")) {
      const message = ownData(value, "message")
      if (Option.isSome(message) && typeof message.value === "string") {
        const summary = truncate(message.value, CAPTURE_MAX_LEAF_PREVIEW)
        return summary.length === 0 ? tag : `${tag}: ${summary}`
      }
    }
    return tag === "Object" ? "{…}" : `${tag} {…}`
  } catch {
    return "[Unserializable value]"
  }
}

interface CaptureState {
  nodes: number
  preview: number
}

const leafNode = (preview: string, truncated = false): AtomValueNode => ({
  kind: "leaf",
  preview,
  entries: [],
  omitted: 0,
  truncated,
})

const accessorLabel = (descriptor: PropertyDescriptor): string => {
  if (descriptor.get !== undefined && descriptor.set !== undefined) {
    return "[Getter/Setter]"
  }
  return descriptor.get !== undefined ? "[Getter]" : "[Setter]"
}

const captureLeafPreview = (value: object, state: CaptureState): string => {
  if (state.preview <= 0) return "…"
  const text = truncate(
    opaqueLeafPreview(value),
    Math.min(state.preview, CAPTURE_MAX_LEAF_PREVIEW),
  )
  state.preview -= text.length
  return text
}

const capturePrimitivePreview = (
  value: unknown,
  state: CaptureState,
): Option.Option<string> => {
  if (state.preview <= 0) return Option.none()
  const primitive = primitivePreview(
    value,
    Math.min(state.preview, CAPTURE_MAX_LEAF_PREVIEW),
  )
  if (Option.isNone(primitive)) return Option.none()
  const text = truncate(primitive.value, state.preview)
  state.preview -= text.length
  return Option.some(text)
}

const branchPreview = (kind: "array" | "object", total: number): string => {
  if (total === 0) return kind === "array" ? "[]" : "{}"
  return kind === "array" ? "[…]" : "{…}"
}

const captureValue = (
  value: unknown,
  depth: number,
  state: CaptureState,
  ancestors: WeakSet<object>,
): AtomValueNode => {
  if (state.nodes <= 0) return leafNode("…", true)
  state.nodes--

  if (value === null || typeof value !== "object") {
    const primitive = capturePrimitivePreview(value, state)
    return leafNode(Option.isSome(primitive) ? primitive.value : "…")
  }

  const object = value as object

  try {
    if (ancestors.has(object)) return leafNode("[Circular]")

    const isArray = Array.isArray(object)
    if (!isArray) {
      const prototype = Object.getPrototypeOf(object)
      if (prototype !== Object.prototype && prototype !== null) {
        return leafNode(captureLeafPreview(object, state))
      }
    }

    if (depth >= CAPTURE_MAX_DEPTH) {
      return leafNode(branchPreview(isArray ? "array" : "object", 1), true)
    }

    ancestors.add(object)
    try {
      if (isArray) {
        const length = ownData(object, "length")
        const total =
          Option.isSome(length) && typeof length.value === "number"
            ? length.value
            : 0
        const entries: Array<AtomValueEntry> = []
        const limit = Math.min(total, CAPTURE_MAX_ENTRIES)

        for (let index = 0; index < limit && state.nodes > 0; index++) {
          const descriptor = ownDescriptor(object, index)
          const node = Option.isNone(descriptor)
            ? leafNode("<empty>")
            : "value" in descriptor.value
              ? captureValue(
                  descriptor.value.value,
                  depth + 1,
                  state,
                  ancestors,
                )
              : leafNode(accessorLabel(descriptor.value))
          entries.push({ key: String(index), value: node })
        }

        const omitted = total - entries.length
        return {
          kind: "array",
          preview: branchPreview("array", total),
          entries,
          omitted,
          truncated: omitted > 0,
        }
      }

      // Own-key enumeration cannot be bounded: JavaScript has no API that
      // yields only the first N keys. The array is never retained, and only the
      // first `CAPTURE_MAX_ENTRIES` (and remaining node budget) are captured.
      const keys = Object.keys(object)
      const entries: Array<AtomValueEntry> = []
      const limit = Math.min(keys.length, CAPTURE_MAX_ENTRIES)

      for (let index = 0; index < limit && state.nodes > 0; index++) {
        const key = keys[index]!
        const descriptor = ownDescriptor(object, key)
        const node = Option.isNone(descriptor)
          ? leafNode("<empty>")
          : "value" in descriptor.value
            ? captureValue(descriptor.value.value, depth + 1, state, ancestors)
            : leafNode(accessorLabel(descriptor.value))
        entries.push({ key, value: node })
      }

      const omitted = keys.length - entries.length
      return {
        kind: "object",
        preview: branchPreview("object", keys.length),
        entries,
        omitted,
        truncated: omitted > 0,
      }
    } finally {
      ancestors.delete(object)
    }
  } catch {
    return leafNode("[Unserializable value]")
  }
}

const freezeNode = (node: AtomValueNode): AtomValueNode => {
  for (const entry of node.entries) {
    freezeNode(entry.value)
    Object.freeze(entry)
  }
  Object.freeze(node.entries)
  return Object.freeze(node)
}

/**
 * Captures a frozen, bounded display tree at sample time.
 *
 * The tree contains no references to the live value. Only plain objects and
 * arrays are expanded; accessors, class instances, built-ins, and proxies that
 * cannot be inspected become bounded leaf nodes.
 */
const captureSnapshotValue = (
  value: unknown,
  maxPreviewLength: number,
): AtomValueNode =>
  freezeNode(
    captureValue(
      value,
      0,
      {
        nodes: CAPTURE_MAX_NODES,
        preview: Math.max(
          200,
          Math.min(CAPTURE_MAX_PREVIEW_BUDGET, maxPreviewLength * 4),
        ),
      },
      new WeakSet(),
    ),
  )

const safeCausePreview = (cause: unknown, maxLength: number): string => {
  try {
    return truncate(Cause.pretty(cause as Cause.Cause<unknown>), maxLength)
  } catch {
    return previewValue(cause, maxLength)
  }
}

const isAsyncResult = (
  value: unknown,
): value is AsyncResult.AsyncResult<unknown, unknown> => {
  try {
    return AsyncResult.isAsyncResult(value)
  } catch {
    return false
  }
}

const safeIsSome = (value: unknown): boolean => {
  try {
    return Option.isSome(value as Option.Option<unknown>)
  } catch {
    return false
  }
}

const asyncResultSnapshot = (
  value: unknown,
  maxLength: number,
): AtomAsyncResultSnapshot | null => {
  if (!isAsyncResult(value)) return null

  try {
    const tag = ownData(value, "_tag")
    if (Option.isNone(tag)) return null

    const waiting = ownData(value, "waiting")
    const isWaiting = Option.isSome(waiting) && waiting.value === true

    switch (tag.value) {
      case "Initial":
        return {
          tag: "Initial",
          waiting: isWaiting,
          preview: isWaiting ? "Initial (waiting)" : "Initial",
        }
      case "Success": {
        const stored = ownData(value, "value")
        const successValue = Option.isSome(stored) ? stored.value : undefined
        return {
          tag: "Success",
          waiting: isWaiting,
          value: captureSnapshotValue(successValue, maxLength),
          preview: `Success${isWaiting ? " (waiting)" : ""}: ${previewValue(
            successValue,
            maxLength,
          )}`,
        }
      }
      case "Failure": {
        const stored = ownData(value, "cause")
        const cause = Option.isSome(stored) ? stored.value : undefined
        const previous = ownData(value, "previousSuccess")
        return {
          tag: "Failure",
          waiting: isWaiting,
          cause: captureSnapshotValue(cause, maxLength),
          hasPreviousSuccess:
            Option.isSome(previous) && safeIsSome(previous.value),
          preview: `Failure${isWaiting ? " (waiting)" : ""}: ${safeCausePreview(
            cause,
            maxLength,
          )}`,
        }
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

const serializableKeyOf = (atom: Atom.Atom<any>): string | null => {
  try {
    return Atom.isSerializable(atom) ? atom[Atom.SerializableTypeId].key : null
  } catch {
    return null
  }
}

/**
 * Introspects an `AtomRegistry` without subscribing to it.
 *
 * The inspector keeps stable ids for non-serializable atoms across snapshots
 * using weak references. It never calls `Node.value()`, never subscribes, and
 * never mounts an atom, so lazy atoms stay lazy and inspected nodes remain
 * eligible for registry cleanup.
 */
export class AtomInspector {
  readonly #ids = new WeakMap<Atom.Atom<any>, string>()
  readonly #maxNodes: number
  readonly #maxPreviewLength: number
  #nextId = 0

  constructor(options: AtomInspectorOptions = {}) {
    this.#maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
    this.#maxPreviewLength =
      options.maxPreviewLength ?? DEFAULT_MAX_PREVIEW_LENGTH
  }

  idOf(atom: Atom.Atom<any>): string {
    try {
      const key = serializableKeyOf(atom)
      if (key !== null) return `key:${key}`

      const existing = this.#ids.get(atom)
      if (existing !== undefined) return existing

      const id = `atom:${++this.#nextId}`
      this.#ids.set(atom, id)
      return id
    } catch {
      return "atom:uninspectable"
    }
  }

  snapshot(registry: AtomRegistry): AtomRegistrySnapshot {
    const counted: Record<AtomNodeState, number> = {
      valid: 0,
      stale: 0,
      uninitialized: 0,
      removed: 0,
    }
    const nodes: Array<AtomNodeSnapshot> = []
    const all = registry.getNodes()
    // Match Array.slice's handling of negative and fractional limits.
    const limit =
      this.#maxNodes < 0
        ? Math.max(all.size + Math.trunc(this.#maxNodes), 0)
        : Math.trunc(this.#maxNodes)
    for (const node of all.values()) {
      let state: AtomNodeState = "removed"
      try {
        state = node.currentState()
      } catch {
        // Keep the node countable and inspectable through the fallback path.
      }
      counted[state]++
      if (nodes.length < limit) nodes.push(this.#nodeSnapshot(node, state))
    }

    nodes.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    )

    return Object.freeze({
      sampledAt: Date.now(),
      nodes: Object.freeze(nodes),
      totalNodes: all.size,
      truncated: all.size > nodes.length,
      counts: Object.freeze(counted),
    })
  }

  #nodeSnapshot(node: Node<any>, state: AtomNodeState): AtomNodeSnapshot {
    try {
      const atom = node.atom
      const key = serializableKeyOf(atom)
      const id = key === null ? this.idOf(atom) : `key:${key}`

      // `valueOption` returns the last committed value without building the
      // atom. Uninitialized nodes have no value to read and are left alone.
      const cached =
        state === "valid" || state === "stale"
          ? node.valueOption()
          : Option.none()
      const cachedValue = Option.isSome(cached) ? cached.value : undefined
      const hasCachedValue = Option.isSome(cached)

      const value: AtomValueSnapshot =
        hasCachedValue && (state === "valid" || state === "stale")
          ? {
              status: state,
              value: captureSnapshotValue(cachedValue, this.#maxPreviewLength),
              preview: previewValue(cachedValue, this.#maxPreviewLength),
            }
          : { status: "uninitialized" }

      const asyncResult = hasCachedValue
        ? asyncResultSnapshot(cachedValue, this.#maxPreviewLength)
        : null

      return Object.freeze({
        id,
        name: atom.label?.[0] ?? key ?? id,
        key,
        state,
        keepAlive: atom.keepAlive,
        lazy: atom.lazy,
        idleTTL: atom.idleTTL ?? null,
        listeners: node.listeners.size,
        canBeRemoved: node.canBeRemoved,
        value: Object.freeze(value),
        asyncResult: asyncResult === null ? null : Object.freeze(asyncResult),
        parents: Object.freeze(
          Array.from(node.parents, (parent) => this.idOf(parent.atom)),
        ),
        children: Object.freeze(
          Array.from(node.children, (child) => this.idOf(child.atom)),
        ),
        error: null,
      })
    } catch (error) {
      return this.#failedNodeSnapshot(node, state, error)
    }
  }

  #failedNodeSnapshot(
    node: Node<any>,
    state: AtomNodeState,
    error: unknown,
  ): AtomNodeSnapshot {
    const id = (() => {
      try {
        return this.idOf(node.atom)
      } catch {
        return "atom:uninspectable"
      }
    })()

    return Object.freeze({
      id,
      name: id,
      key: null,
      state,
      keepAlive: false,
      lazy: false,
      idleTTL: null,
      listeners: 0,
      canBeRemoved: false,
      value: Object.freeze({ status: "uninitialized" as const }),
      asyncResult: null,
      parents: Object.freeze([] as Array<string>),
      children: Object.freeze([] as Array<string>),
      error: truncate(errorMessage(error), 200),
    })
  }
}

/**
 * Convenience wrapper around `AtomInspector.snapshot`.
 *
 * Ids for non-serializable atoms are only stable within the returned snapshot.
 * Reuse an `AtomInspector` instance when polling if stable ids matter.
 */
export const inspectRegistry = (
  registry: AtomRegistry,
  options?: AtomInspectorOptions,
): AtomRegistrySnapshot => new AtomInspector(options).snapshot(registry)
