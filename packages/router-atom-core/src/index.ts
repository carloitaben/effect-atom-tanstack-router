import type { AnyRouter } from "@tanstack/router-core"
import { isServer } from "@tanstack/router-core/isServer"
import * as Equal from "effect/Equal"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import type {
  AtomRegistry,
  Node as AtomRegistryNode,
} from "effect/reactivity/AtomRegistry"

type DehydratedAtomEntry = {
  readonly key: string
  readonly value: unknown
}

export type DehydratedRouterAtomState = {
  atom: {
    readonly initial?: Array<DehydratedAtomEntry>
    readonly stream: ReadableStream<Array<DehydratedAtomEntry>>
  }
}

/**
 * Whether the value carries something the server rendered and the client can
 * hydrate with. `Initial` carries no value, but a waiting result still holds
 * the value the server last rendered.
 */
const hasHydratableValue = (value: unknown): boolean =>
  !AsyncResult.isAsyncResult(value) || !AsyncResult.isInitial(value)

/**
 * Whether the value is the last one the atom will produce on its own. A
 * waiting result still has work in flight, so a newer value must stay
 * streamable.
 */
const isFinalValue = (value: unknown): boolean =>
  !AsyncResult.isAsyncResult(value) ||
  (!AsyncResult.isInitial(value) && !value.waiting)

const encode = (
  atom: Atom.Atom<any> & Atom.Serializable<any>,
  value: unknown,
): unknown => atom[Atom.SerializableTypeId].encode(value)

const decode = (
  atom: Atom.Atom<any> & Atom.Serializable<any>,
  value: unknown,
): unknown => atom[Atom.SerializableTypeId].decode(value)

const keyOf = (atom: Atom.Atom<any> & Atom.Serializable<any>): string =>
  atom[Atom.SerializableTypeId].key

export function setupRouterAtomSsr(router: AnyRouter, registry: AtomRegistry) {
  if (isServer || router.isServer) {
    const originalDehydrate = router.options.dehydrate

    router.options.dehydrate = async (): Promise<
      DehydratedRouterAtomState | undefined
    > => {
      const originalDehydrated = await originalDehydrate?.()

      // Validate before installing hooks or subscriptions: throwing partway
      // through would leave them attached to a request that never renders.
      const serverSsr = Option.getOrThrowWith(
        Option.fromUndefinedOr(router.serverSsr),
        () =>
          new Error(
            "Router SSR is unavailable. Call setupRouterAtomIntegration only after TanStack Start initializes server SSR.",
          ),
      )

      const initial: Array<DehydratedAtomEntry> = []
      /**
       * Keys whose final value has been sent. A key only stops streaming once
       * the atom produced a value that will not be replaced by newer work.
       */
      const finalized = new Set<string>()
      /** Last value sent per key, so a re-read of the same value is not resent. */
      const sentValues = new Map<string, unknown>()

      // Snapshot every serializable atom that rendered a value
      for (const node of registry.getNodes().values()) {
        if (!Atom.isSerializable(node.atom)) continue
        const value = node.value()
        if (!hasHydratableValue(value)) continue
        const key = keyOf(node.atom)
        initial.push({ key, value: encode(node.atom, value) })
        if (isFinalValue(value)) finalized.add(key)
        else sentValues.set(key, value)
      }

      // Everything else streams
      let controller!: ReadableStreamDefaultController<
        Array<DehydratedAtomEntry>
      >
      const stream = new ReadableStream<Array<DehydratedAtomEntry>>({
        start(c) {
          controller = c
        },
        // The consumer going away is another teardown path: release the
        // subscriptions instead of keeping the atoms observed for the life of
        // the process.
        cancel() {
          finalize()
        },
      })

      let closed = false
      let pending: Map<string, DehydratedAtomEntry> | undefined
      const unsubscribes = new Map<string, () => void>()
      const flushPending = () => {
        const batch = pending
        pending = undefined
        if (!batch || batch.size === 0) return
        try {
          controller.enqueue(Array.from(batch.values()))
        } catch {
          // Consumer already cancelled the stream
        }
      }
      const send = (
        key: string,
        atom: Atom.Atom<any> & Atom.Serializable<any>,
        value: unknown,
      ) => {
        if (closed || finalized.has(key)) return
        const previous = sentValues.get(key)
        if (sentValues.has(key) && Equal.equals(previous, value)) return
        if (isFinalValue(value)) {
          sentValues.delete(key)
          // The final value is the last thing this atom will stream.
          finalized.add(key)
          const unsubscribe = unsubscribes.get(key)
          if (unsubscribe !== undefined) {
            unsubscribe()
            unsubscribes.delete(key)
          }
        } else sentValues.set(key, value)
        if (!pending) {
          pending = new Map()
          queueMicrotask(flushPending)
        }
        pending.set(key, { key, value: encode(atom, value) })
      }

      const watch = (atom: Atom.Atom<any>) => {
        if (!Atom.isSerializable(atom)) return
        const key = keyOf(atom)
        if (finalized.has(key) || unsubscribes.has(key)) return
        const unsubscribe = registry.subscribe(atom, (value) => {
          if (!hasHydratableValue(value)) return
          send(key, atom, value)
        })
        unsubscribes.set(key, unsubscribe)
        // The atom may have produced its value between the snapshot and this
        // subscription, so no notification would follow to send it.
        const current = registry.getNodes().get(key)?.valueOption()
        if (
          current !== undefined &&
          Option.isSome(current) &&
          hasHydratableValue(current.value)
        ) {
          send(key, atom, current.value)
        }
      }

      // Atoms that already exist but haven't produced a final value yet
      for (const node of registry.getNodes().values()) {
        watch(node.atom)
      }

      // Atoms not created until later in the render
      const originalOnNodeAdded = registry.onNodeAdded
      const onNodeAdded = (node: AtomRegistryNode<any>) => {
        originalOnNodeAdded?.(node)
        watch(node.atom)
      }
      registry.onNodeAdded = onNodeAdded

      const finalize = () => {
        if (closed) return
        closed = true
        flushPending()
        // Only take back the hook we installed; another integration may have
        // replaced it since.
        if (registry.onNodeAdded === onNodeAdded) {
          registry.onNodeAdded = originalOnNodeAdded
        }
        for (const unsubscribe of unsubscribes.values()) unsubscribe()
        unsubscribes.clear()
        sentValues.clear()
        try {
          controller.close()
        } catch {
          // Already closed/errored/cancelled - fine.
        }
      }

      // Covers the happy path (render completes normally).
      serverSsr.onRenderFinished(finalize)
      // Covers the request tearing down before that ever fires (an early
      // redirect/error mid-render, or the client disconnecting) - without this
      // the stream and its subscriptions would leak for the life of the
      // process. Registered on the attached instance directly: attach already
      // happened by the time dehydrate runs, so `onServerSsrAttach` would
      // never fire for it.
      serverSsr.onCleanup(finalize)

      // The request can be torn down while the previous dehydrate hook is
      // awaited. Both listeners ignore registration after cleanup started, so
      // close here rather than leak.
      if (router.serverSsr !== serverSsr) finalize()

      return {
        ...originalDehydrated,
        atom: {
          ...(initial.length > 0 && { initial }),
          stream,
        },
      }
    }
    return
  }

  const applyEntry = (entry: DehydratedAtomEntry) => {
    // `setSerializable` only buffers the value until the atom is next read, so
    // a node that already holds a value (a component read and subscribed
    // before this entry arrived) would never hear about it.
    const node = registry.getNodes().get(entry.key)
    if (
      node !== undefined &&
      Atom.isSerializable(node.atom) &&
      Option.isSome(node.valueOption())
    ) {
      node.setInitialValue(decode(node.atom, entry.value))
      return
    }
    // No node yet: preload it so the first read already sees this value.
    registry.setSerializable(entry.key, entry.value)
  }

  const originalHydrate = router.options.hydrate
  router.options.hydrate = async (dehydrated: DehydratedRouterAtomState) => {
    await originalHydrate?.(dehydrated as any)

    const atomState = dehydrated?.atom
    if (!atomState) return

    if (atomState.initial) {
      for (const entry of atomState.initial) {
        applyEntry(entry)
      }
    }

    const reader = atomState.stream.getReader()
    const pump = ({
      done,
      value,
    }: ReadableStreamReadResult<
      Array<DehydratedAtomEntry>
    >): void | Promise<void> => {
      if (done) return
      for (const entry of value) {
        applyEntry(entry)
      }
      return reader.read().then(pump)
    }
    reader
      .read()
      .then(pump)
      .catch((error) => {
        console.error("[atom-start-ssr] error reading atom stream:", error)
      })
  }
}

/**
 * Waits for an atom to leave `AsyncResult.Initial` before resolving.
 */
export const awaitAtomSettled = <A, E>(
  registry: AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<AsyncResult.AsyncResult<A, E>> => {
  const current = registry.get(atom)
  if (!AsyncResult.isInitial(current)) return Promise.resolve(current)
  return new Promise((resolve) => {
    const unsubscribe = registry.subscribe(atom, (value) => {
      if (AsyncResult.isInitial(value)) return
      unsubscribe()
      resolve(value)
    })
    // The value may have settled between the read above and the subscription,
    // in which case no change notification would follow.
    const latest = registry.get(atom)
    if (!AsyncResult.isInitial(latest)) {
      unsubscribe()
      resolve(latest)
    }
  })
}
