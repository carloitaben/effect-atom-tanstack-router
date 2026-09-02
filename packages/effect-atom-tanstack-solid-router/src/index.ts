import { RegistryContext } from "@effect/atom-solid"
import { isServer } from "@tanstack/router-core/isServer"
import type { AnyRouter } from "@tanstack/solid-router"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry"
import { createComponent } from "solid-js"

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

export type RouterAtomIntegrationOptions<TRouter extends AnyRouter> = {
  readonly router: TRouter
  readonly registry: AtomRegistry
  readonly wrapRegistry?: boolean
}

const isSettled = (value: unknown): boolean =>
  !AsyncResult.isAsyncResult(value) || !AsyncResult.isInitial(value)

const encode = (
  atom: Atom.Atom<any> & Atom.Serializable<any>,
  value: unknown,
): unknown => atom[Atom.SerializableTypeId].encode(value)

const keyOf = (atom: Atom.Atom<any> & Atom.Serializable<any>): string =>
  atom[Atom.SerializableTypeId].key

export function setupRouterAtomIntegration<TRouter extends AnyRouter>(
  opts: RouterAtomIntegrationOptions<TRouter>,
) {
  const { router, registry } = opts

  if (opts.wrapRegistry !== false) {
    const originalWrap = router.options.Wrap
    router.options.Wrap = (props) =>
      createComponent(RegistryContext.Provider, {
        value: registry,
        get children() {
          return originalWrap ? originalWrap(props) : props.children
        },
      })
  }

  if (isServer || router.isServer) {
    const originalDehydrate = router.options.dehydrate

    router.options.dehydrate = async (): Promise<
      DehydratedRouterAtomState | undefined
    > => {
      const originalDehydrated = await originalDehydrate?.()

      const initial: Array<DehydratedAtomEntry> = []
      const sentKeys = new Set<string>()

      // Snapshot every serializable atom that's already settled
      for (const node of registry.getNodes().values()) {
        if (!Atom.isSerializable(node.atom)) continue
        const value = node.value()
        if (!isSettled(value)) continue
        const key = keyOf(node.atom)
        initial.push({ key, value: encode(node.atom, value) })
        sentKeys.add(key)
      }

      // Everything else streams
      let controller!: ReadableStreamDefaultController<
        Array<DehydratedAtomEntry>
      >
      const stream = new ReadableStream<Array<DehydratedAtomEntry>>({
        start(c) {
          controller = c
        },
      })

      let closed = false
      let pending: Map<string, DehydratedAtomEntry> | undefined
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
      const schedule = (entry: DehydratedAtomEntry) => {
        if (closed || sentKeys.has(entry.key)) return
        sentKeys.add(entry.key)
        if (!pending) {
          pending = new Map()
          queueMicrotask(flushPending)
        }
        pending.set(entry.key, entry)
      }

      const unsubscribes = new Set<() => void>()
      const watch = (atom: Atom.Atom<any>) => {
        if (!Atom.isSerializable(atom) || sentKeys.has(keyOf(atom))) return
        const unsubscribe = registry.subscribe(atom, (value) => {
          if (!isSettled(value)) return
          unsubscribe()
          unsubscribes.delete(unsubscribe)
          schedule({ key: keyOf(atom), value: encode(atom, value) })
        })
        unsubscribes.add(unsubscribe)
      }

      // Atoms that already exist but haven't settled yet
      for (const node of registry.getNodes().values()) {
        watch(node.atom)
      }

      // Atoms not created until later in the render
      const originalOnNodeAdded = registry.onNodeAdded
      registry.onNodeAdded = (node) => {
        originalOnNodeAdded?.(node)
        watch(node.atom)
      }

      const finalize = () => {
        if (closed) return
        closed = true
        flushPending()
        registry.onNodeAdded = originalOnNodeAdded
        for (const unsubscribe of unsubscribes) unsubscribe()
        unsubscribes.clear()
        try {
          controller.close()
        } catch {
          // Already closed/errored - fine.
        }
      }

      const serverSsr = Option.getOrThrowWith(
        Option.fromUndefinedOr(router.serverSsr),
        () =>
          new Error(
            "Router SSR is unavailable. Call setupRouterAtomIntegration only after TanStack Start initializes server SSR.",
          ),
      )

      // Covers the happy path (render completes normally).
      serverSsr.onRenderFinished(finalize)
      // Covers the request tearing down before that ever fires (an early
      // redirect/error mid-render) - without this the stream and its
      // subscriptions would leak for the life of the process.
      router.serverSsrLifecycle = {
        ...router.serverSsrLifecycle,
        onServerSsrAttach: [
          ...(router.serverSsrLifecycle?.onServerSsrAttach ?? []),
          (serverSsr) => serverSsr.onCleanup(finalize),
        ],
      }

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

  const originalHydrate = router.options.hydrate
  router.options.hydrate = async (dehydrated: DehydratedRouterAtomState) => {
    await originalHydrate?.(dehydrated as any)

    const atomState = dehydrated?.atom
    if (!atomState) return

    if (atomState.initial) {
      for (const entry of atomState.initial) {
        registry.setSerializable(entry.key, entry.value)
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
        registry.setSerializable(entry.key, entry.value)
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
      if (!AsyncResult.isInitial(value)) {
        resolve(value)
        unsubscribe()
      }
    })
  })
}
