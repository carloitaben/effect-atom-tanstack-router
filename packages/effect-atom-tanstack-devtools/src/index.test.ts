import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { AtomInspector, previewValue } from "./index"

describe("AtomInspector", () => {
  it("reports labels, serializable keys, and current values", () => {
    const registry = AtomRegistry.make()
    const plain = Atom.make(1)
    const keyed = Atom.serializable(Atom.make(2), {
      key: "counter",
      schema: Schema.Number,
    })
    const labeled = Atom.withLabel(Atom.make({ ok: true }), "settings")

    registry.get(plain)
    registry.get(keyed)
    registry.get(labeled)

    const snapshot = new AtomInspector().snapshot(registry)

    expect(snapshot.totalNodes).toBe(3)
    expect(snapshot.truncated).toBe(false)
    expect(snapshot.counts.valid).toBe(3)

    const keyedNode = snapshot.nodes.find((node) => node.key === "counter")
    expect(keyedNode).toMatchObject({
      id: "key:counter",
      name: "counter",
      state: "valid",
      value: { status: "valid", preview: "2" },
      error: null,
    })
    expect(keyedNode?.value.status).toBe("valid")
    if (keyedNode?.value.status === "valid") {
      expect(keyedNode.value.value).toMatchObject({
        kind: "leaf",
        preview: "2",
        entries: [],
      })
    }

    const labeledNode = snapshot.nodes.find((node) => node.name === "settings")
    expect(labeledNode?.value).toMatchObject({
      status: "valid",
      preview: '{ "ok": true }',
    })
    if (labeledNode?.value.status === "valid") {
      expect(labeledNode.value.value).toMatchObject({
        kind: "object",
        entries: [{ key: "ok", value: { kind: "leaf", preview: "true" } }],
      })
    }
  })

  it("does not initialize uninitialized atoms", () => {
    const registry = AtomRegistry.make()
    let reads = 0
    const atom = Atom.readable(() => {
      reads++
      return 42
    })

    registry.ensureNode(atom)
    const snapshot = new AtomInspector().snapshot(registry)
    const node = snapshot.nodes[0]!

    expect(reads).toBe(0)
    expect(node.state).toBe("uninitialized")
    expect(node.value).toEqual({ status: "uninitialized" })
    expect(node.asyncResult).toBeNull()
  })

  it("does not subscribe to or pin inspected nodes", () => {
    const registry = AtomRegistry.make()
    let reads = 0
    const atom = Atom.readable(() => {
      reads++
      return "value"
    })
    registry.get(atom)

    const node = registry.ensureNode(atom)
    expect(node.listeners.size).toBe(0)
    expect(node.canBeRemoved).toBe(true)

    const snapshot = new AtomInspector().snapshot(registry)

    expect(reads).toBe(1)
    expect(node.listeners.size).toBe(0)
    expect(node.canBeRemoved).toBe(true)
    expect(snapshot.nodes[0]?.listeners).toBe(0)
  })

  it("shows stale values without rebuilding the atom", () => {
    const registry = AtomRegistry.make()
    let reads = 0
    const atom = Atom.readable(() => {
      reads++
      return reads
    })
    registry.get(atom)
    registry.refresh(atom)

    const snapshot = new AtomInspector().snapshot(registry)
    const node = snapshot.nodes[0]!

    expect(node.state).toBe("stale")
    expect(node.value).toMatchObject({ status: "stale", preview: "1" })
    expect(reads).toBe(1)
  })

  it("reports parent and child relationships with stable ids", () => {
    const registry = AtomRegistry.make()
    const base = Atom.make(2)
    const doubled = Atom.withLabel(
      Atom.readable((get) => get(base) * 2),
      "doubled",
    )
    registry.get(doubled)

    const inspector = new AtomInspector()
    const first = inspector.snapshot(registry)
    const second = inspector.snapshot(registry)

    const baseNode = first.nodes.find((node) => node.name !== "doubled")!
    const doubledNode = first.nodes.find((node) => node.name === "doubled")!

    expect(doubledNode.parents).toEqual([baseNode.id])
    expect(baseNode.children).toEqual([doubledNode.id])
    expect(first.nodes.map((node) => node.id).sort()).toEqual(
      second.nodes.map((node) => node.id).sort(),
    )
  })

  it("summarizes AsyncResult values", () => {
    const registry = AtomRegistry.make()
    const success = Atom.make(AsyncResult.success(7))
    const failure = Atom.make(
      AsyncResult.failure(Cause.fail(new Error("boom"))),
    )
    const initial = Atom.make(AsyncResult.initial(true))

    registry.get(success)
    registry.get(failure)
    registry.get(initial)

    const snapshot = new AtomInspector().snapshot(registry)

    expect(
      snapshot.nodes.find((node) => node.asyncResult?.tag === "Success")
        ?.asyncResult,
    ).toMatchObject({
      tag: "Success",
      waiting: false,
      preview: "Success: 7",
      value: { kind: "leaf", preview: "7" },
    })
    expect(
      snapshot.nodes.find((node) => node.asyncResult?.tag === "Initial")
        ?.asyncResult,
    ).toMatchObject({
      tag: "Initial",
      waiting: true,
    })

    const failureNode = snapshot.nodes.find(
      (node) => node.asyncResult?.tag === "Failure",
    )
    expect(failureNode?.asyncResult).toMatchObject({
      tag: "Failure",
      hasPreviousSuccess: false,
    })
    expect(failureNode?.asyncResult?.preview).toContain("boom")
  })

  it("limits snapshots and reports truncation", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.make(1))
    registry.get(Atom.make(2))

    const snapshot = new AtomInspector({ maxNodes: 1 }).snapshot(registry)

    expect(snapshot.nodes).toHaveLength(1)
    expect(snapshot.totalNodes).toBe(2)
    expect(snapshot.truncated).toBe(true)
  })

  it("honors maxPreviewLength", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.make({ text: "x".repeat(100) }))

    const snapshot = new AtomInspector({ maxPreviewLength: 20 }).snapshot(
      registry,
    )
    const preview = snapshot.nodes[0]?.value

    expect(preview?.status).toBe("valid")
    if (preview?.status === "valid") {
      expect(preview.preview.endsWith("…")).toBe(true)
      expect(preview.preview.length).toBeLessThanOrEqual(21)
    }
  })

  it("does not execute accessors while building previews", () => {
    const registry = AtomRegistry.make()
    let calls = 0
    const value = Object.defineProperty({ safe: 1 }, "secret", {
      enumerable: true,
      get() {
        calls++
        return 42
      },
    })

    registry.get(Atom.make(value))
    const snapshot = new AtomInspector().snapshot(registry)
    const preview = snapshot.nodes[0]?.value

    expect(calls).toBe(0)
    if (preview?.status === "valid") {
      expect(preview.preview).toContain("secret")
      expect(preview.preview).toContain("[Getter]")
      expect(JSON.stringify(preview.value)).toContain("[Getter]")
    }
    expect(calls).toBe(0)
  })

  it("captures a frozen tree instead of retaining live references", () => {
    const registry = AtomRegistry.make()
    const live = { count: 1, nested: { label: "before" } }
    registry.get(Atom.make(live))

    const snapshot = new AtomInspector().snapshot(registry)
    live.count = 2
    live.nested.label = "after"

    const value = snapshot.nodes[0]!.value
    expect(value.status).toBe("valid")
    if (value.status !== "valid") return

    expect(value.preview).toContain('"count": 1')
    expect(value.value).toMatchObject({
      kind: "object",
      entries: [
        { key: "count", value: { kind: "leaf", preview: "1" } },
        {
          key: "nested",
          value: {
            kind: "object",
            entries: [
              { key: "label", value: { kind: "leaf", preview: '"before"' } },
            ],
          },
        },
      ],
    })
    expect(Object.isFrozen(value.value)).toBe(true)
    expect(Object.isFrozen(value.value.entries)).toBe(true)
    expect(Object.isFrozen(value.value.entries[0])).toBe(true)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.nodes)).toBe(true)
    expect(Object.isFrozen(snapshot.nodes[0])).toBe(true)
  })

  it("contains revoked proxies and throwing traps", () => {
    const revoked = Proxy.revocable({ ok: true }, {})
    revoked.revoke()
    const throwingHas = new Proxy(
      { ok: true },
      {
        has() {
          throw new Error("has trap")
        },
      },
    )
    const healthy = Atom.withLabel(Atom.make("healthy"), "healthy")

    // Write the hostile values through a writable atom: `Atom.make` itself
    // probes the value, which would throw before the inspector ever sees it.
    const revokedAtom = Atom.make<unknown>(undefined)
    const throwingAtom = Atom.make<unknown>(undefined)
    const registry = AtomRegistry.make()
    registry.set(revokedAtom, revoked.proxy)
    registry.set(throwingAtom, throwingHas)
    registry.get(healthy)

    const snapshot = new AtomInspector().snapshot(registry)

    expect(snapshot.nodes).toHaveLength(3)
    const healthyNode = snapshot.nodes.find((node) => node.name === "healthy")
    expect(healthyNode?.value).toMatchObject({
      status: "valid",
      preview: '"healthy"',
    })
    expect(healthyNode?.error).toBeNull()

    const broken = snapshot.nodes.filter((node) => node.name !== "healthy")
    expect(broken).toHaveLength(2)
    for (const node of broken) {
      expect(node.error).toBeNull()
      expect(node.asyncResult).toBeNull()
      expect(node.value.status).toBe("valid")
    }

    const revokedNode = broken.find(
      (node) =>
        node.value.status === "valid" &&
        node.value.preview === "[Unserializable value]",
    )
    expect(revokedNode).toBeDefined()
    if (revokedNode?.value.status === "valid") {
      expect(revokedNode.value.value).toMatchObject({
        kind: "leaf",
        preview: "[Unserializable value]",
      })
    }

    const proxyNode = broken.find(
      (node) =>
        node.value.status === "valid" &&
        node.value.preview === '{ "ok": true }',
    )
    expect(proxyNode).toBeDefined()
    if (proxyNode?.value.status === "valid") {
      expect(proxyNode.value.value).toMatchObject({
        kind: "object",
        entries: [{ key: "ok", value: { kind: "leaf", preview: "true" } }],
      })
    }
  })

  it("contains node-level inspection failures", () => {
    const healthyAtom = Atom.withLabel(Atom.make(1), "healthy")
    const brokenAtom = Atom.make(2)
    const base = {
      currentState: () => "valid" as const,
      listeners: new Set(),
      parents: new Set(),
      children: new Set(),
      canBeRemoved: true,
    }
    const nodes = new Map<unknown, unknown>([
      [
        healthyAtom,
        {
          ...base,
          atom: healthyAtom,
          valueOption: () => Option.some(1),
        },
      ],
      [
        brokenAtom,
        {
          ...base,
          atom: brokenAtom,
          valueOption: () => {
            throw new Error("value failed")
          },
        },
      ],
    ])
    const registry = {
      getNodes: () => nodes,
    } as unknown as AtomRegistry.AtomRegistry

    const snapshot = new AtomInspector().snapshot(registry)

    expect(snapshot.nodes).toHaveLength(2)
    const healthy = snapshot.nodes.find((node) => node.name === "healthy")
    expect(healthy?.error).toBeNull()
    expect(healthy?.value).toMatchObject({ status: "valid", preview: "1" })

    const broken = snapshot.nodes.find((node) => node.name !== "healthy")
    expect(broken?.error).toBe("value failed")
    expect(broken?.value).toEqual({ status: "uninitialized" })
    expect(broken?.asyncResult).toBeNull()
  })

  it("contains Cause.pretty failures and still inspects healthy nodes", () => {
    const registry = AtomRegistry.make()
    const error = Object.defineProperty(new Error("base"), "message", {
      enumerable: true,
      get() {
        throw new Error("throwing message")
      },
    })
    registry.get(Atom.make(AsyncResult.failure(Cause.fail(error))))
    registry.get(Atom.make(3))

    const snapshot = new AtomInspector().snapshot(registry)

    expect(snapshot.nodes).toHaveLength(2)
    const failure = snapshot.nodes.find(
      (node) => node.asyncResult?.tag === "Failure",
    )
    expect(failure?.asyncResult).toMatchObject({
      tag: "Failure",
      hasPreviousSuccess: false,
    })
    expect(failure?.asyncResult?.preview).toContain("Failure")
    expect(failure?.error).toBeNull()

    expect(
      snapshot.nodes.find(
        (node) => node.value.status === "valid" && node.value.preview === "3",
      ),
    ).toBeDefined()
  })

  it("captures circular references without following them", () => {
    const registry = AtomRegistry.make()
    const circular: Record<string, unknown> = { name: "root" }
    circular.self = circular
    registry.get(Atom.make(circular))

    const value = new AtomInspector().snapshot(registry).nodes[0]!.value
    expect(value.status).toBe("valid")
    if (value.status !== "valid") return

    expect(value.value.entries[1]).toMatchObject({
      key: "self",
      value: { kind: "leaf", preview: "[Circular]" },
    })
  })

  it("bounds captured trees by entries and depth", () => {
    const registry = AtomRegistry.make()
    const wide = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`key${index}`, index]),
    )
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }

    registry.get(Atom.make(wide))
    registry.get(Atom.make(deep))
    const snapshot = new AtomInspector().snapshot(registry)

    const wideTree = snapshot.nodes.find(
      (node) =>
        node.value.status === "valid" && node.value.preview.includes('"key0"'),
    )?.value
    expect(wideTree?.status).toBe("valid")
    if (wideTree?.status === "valid") {
      expect(wideTree.value.kind).toBe("object")
      expect(wideTree.value.entries).toHaveLength(50)
      expect(wideTree.value.omitted).toBe(50)
      expect(wideTree.value.truncated).toBe(true)
    }

    const deepTree = snapshot.nodes.find(
      (node) =>
        node.value.status === "valid" && node.value.preview.includes('"a"'),
    )?.value
    expect(deepTree?.status).toBe("valid")
    if (deepTree?.status === "valid") {
      let node = deepTree.value
      for (const key of ["a", "b", "c", "d", "e"]) {
        const entry = node.entries.find((item) => item.key === key)
        expect(entry).toBeDefined()
        node = entry!.value
      }
      expect(node.kind).toBe("leaf")
      expect(node.truncated).toBe(true)
    }
  })
})

describe("previewValue", () => {
  it("formats primitives", () => {
    expect(previewValue("hello")).toBe('"hello"')
    expect(previewValue(1)).toBe("1")
    expect(previewValue(true)).toBe("true")
    expect(previewValue(null)).toBe("null")
    expect(previewValue(undefined)).toBe("undefined")
    expect(previewValue(2n)).toBe("2n")
    expect(previewValue(Symbol("token"))).toBe("Symbol(token)")

    function named() {}
    expect(previewValue(named)).toBe("[Function named]")
    expect(previewValue(() => 1)).toBe("[Function anonymous]")
  })

  it("formats nested values without JSON serialization", () => {
    class Point {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    }

    expect(previewValue({ a: 1, b: [2, 3] })).toBe('{ "a": 1, "b": [2, 3] }')
    expect(previewValue(new Point(1, 2))).toBe('Point { "x": 1, "y": 2 }')
    expect(previewValue(new Date(0))).toBe("1970-01-01T00:00:00.000Z")
    expect(previewValue(/ab+c/gi)).toBe("/ab+c/gi")
    expect(previewValue(new Map([["a", 1]]))).toBe('Map(1) { "a" => 1 }')
    expect(previewValue(new Set([1, 2]))).toBe("Set(2) { 1, 2 }")
    expect(previewValue(new TypeError("boom"))).toBe("TypeError: boom")
    expect(
      previewValue(Object.assign(new TypeError("boom"), { code: 42 })),
    ).toBe('TypeError: boom { "code": 42 }')
  })

  it("never runs user coercion or serialization hooks", () => {
    let calls = 0
    const hostile = {
      get secret() {
        calls++
        return "leaked"
      },
      toJSON() {
        calls++
        return { leaked: true }
      },
      toString() {
        calls++
        return "leaked"
      },
      valueOf() {
        calls++
        return 1
      },
      [Symbol.toPrimitive]() {
        calls++
        return "leaked"
      },
    }

    const preview = previewValue(hostile)

    expect(calls).toBe(0)
    expect(preview).toContain('"secret": [Getter]')
    expect(preview).toContain('"toJSON": [Function toJSON]')
    expect(preview).not.toContain("leaked")
  })

  it("ignores shadowed built-in formatters", () => {
    let calls = 0

    const hostileDate = new Date(0)
    Object.defineProperty(hostileDate, "toISOString", {
      value: () => {
        calls++
        return "leaked"
      },
    })

    const hostileMap = new Map([["a", 1]])
    Object.defineProperty(hostileMap, "entries", {
      value: () => {
        calls++
        throw new Error("leaked")
      },
    })

    const hostileRegExp = /ab/gi
    Object.defineProperty(hostileRegExp, "global", {
      get: () => {
        calls++
        return false
      },
    })

    expect(previewValue(hostileDate)).toBe("1970-01-01T00:00:00.000Z")
    expect(previewValue(hostileMap)).toBe('Map(1) { "a" => 1 }')
    expect(previewValue(hostileRegExp)).toBe("/ab/gi")
    expect(calls).toBe(0)
  })

  it("handles circular values and throwing getters", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const throwing = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        throw new Error("nope")
      },
    })

    const nested = { outer: throwing }

    expect(previewValue(circular)).toBe('{ "self": [Circular] }')
    expect(() => previewValue(throwing)).not.toThrow()
    expect(() => previewValue(nested)).not.toThrow()
    expect(previewValue(nested)).toContain("[Getter]")
  })

  it("bounds depth, width, and length", () => {
    const deep = { a: { b: { c: { d: 1 } } } }
    expect(previewValue(deep)).toBe('{ "a": { "b": { "c": {…} } } }')

    const wide = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`key${index}`, index]),
    )
    expect(previewValue(wide)).toContain("…")

    expect(previewValue("abcdefghij", 5)).toBe('"abcd…')
    expect(previewValue("x".repeat(100), 10).length).toBeLessThanOrEqual(11)
  })

  it("does not format the whole input string", () => {
    const preview = previewValue("x".repeat(5_000_000), 20)
    expect(preview.length).toBeLessThanOrEqual(21)
    expect(preview.endsWith("…")).toBe(true)
  })
})
