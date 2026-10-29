import { RegistryContext, useAtomValue } from "@effect/atom-solid"
import {
  BaseRootRoute,
  BaseRoute,
  RouterCore,
  createNonReactiveMutableStore,
  createNonReactiveReadonlyStore,
} from "@tanstack/router-core"
import { attachRouterServerSsrUtils } from "@tanstack/router-core/ssr/server"
import type { AnyRouter } from "@tanstack/solid-router"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import { createComponent, createRoot } from "solid-js"
import type { Accessor } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  awaitAtomSettled,
  setupRouterAtomIntegration,
  type DehydratedRouterAtomState,
} from "../src/index"

type Registry = AtomRegistry.AtomRegistry

const resultSchema = AsyncResult.Schema({
  success: Schema.String,
  error: Schema.Never,
})

/**
 * An atom whose server read stays pending until `settle()` returns true, then
 * resolves to `value`. Lets a test keep the client-side read pending so the
 * only way a value reaches it is through hydration.
 */
const makeAsyncAtom = (options: {
  readonly key: string
  readonly value: string
  readonly settle: () => boolean
  readonly delayMillis?: number
}) =>
  Atom.make(
    Effect.gen(function* () {
      if (!options.settle()) return yield* Effect.never
      yield* Effect.sleep(Duration.millis(options.delayMillis ?? 10))
      return options.value
    }),
  ).pipe(
    Atom.keepAlive,
    Atom.serializable({ key: options.key, schema: resultSchema }),
  )

/**
 * The router pieces below are `@tanstack/router-core` primitives, the same
 * ones `@tanstack/solid-router` builds on. Its package entry renders Solid
 * components at module scope, which cannot be loaded outside a DOM, so the
 * tests drive the shared SSR lifecycle directly and render only the atom
 * hooks, which need no DOM.
 */
const storeFactory = () => ({
  createMutableStore: createNonReactiveMutableStore,
  createReadonlyStore: createNonReactiveReadonlyStore,
  batch: (fn: () => void) => fn(),
})

const makeHistory = () => ({
  location: { href: "/", pathname: "/", search: "", hash: "", state: {} },
  subscribers: new Set(),
  subscribe: () => () => {},
  push: () => {},
  replace: () => {},
  go: () => {},
  canGoBack: () => false,
  createHref: (href: string) => href,
  block: () => () => {},
  flush: () => {},
  destroy: () => {},
})

const makeRouter = (
  registry: Registry,
  options: {
    readonly isServer: boolean
    readonly read?: Atom.Atom<any>
  },
) => {
  const root = new BaseRootRoute({})
  const read = options.read
  const index = new BaseRoute({
    getParentRoute: () => root,
    path: "/",
    ...(read === undefined
      ? {}
      : {
          loader: () => {
            registry.get(read)
          },
        }),
  } as any)
  const router = new RouterCore(
    {
      routeTree: root.addChildren([index] as any),
      // Always constructed as a server router: building the client store
      // factory needs Solid's reactive runtime. `isServer` is only read when
      // the integration is installed below.
      isServer: true,
      context: { registry },
      history: makeHistory(),
    } as any,
    storeFactory,
  ) as unknown as AnyRouter
  router.isServer = options.isServer
  return router
}

type TestRouter = ReturnType<typeof makeRouter>

/**
 * Runs the real TanStack server sequence: the integration is installed, the
 * request attaches its SSR state, the render starts (`load`), and only then
 * dehydrate runs.
 */
const startServerRequest = async (
  registry: Registry,
  read: Atom.Atom<any>,
): Promise<TestRouter> => {
  const router = makeRouter(registry, { isServer: true, read })
  setupRouterAtomIntegration({ router, registry })
  attachRouterServerSsrUtils({ router, manifest: undefined })
  await router.load()
  return router
}

const dehydrate = async (router: TestRouter) => {
  const dehydrateHook = router.options.dehydrate
  if (dehydrateHook === undefined)
    throw new Error("dehydrate was not installed")
  return (await dehydrateHook()) as DehydratedRouterAtomState
}

const hydrate = async (
  router: TestRouter,
  state: DehydratedRouterAtomState,
) => {
  const hydrateHook = router.options.hydrate
  if (hydrateHook === undefined) throw new Error("hydrate was not installed")
  await hydrateHook(state)
}

const makeClientRouter = (registry: Registry) => {
  const router = makeRouter(registry, { isServer: false })
  setupRouterAtomIntegration({ router, registry })
  return router
}

const nodeFor = (registry: Registry, key: string) => {
  const node = registry.getNodes().get(key)
  if (node === undefined) throw new Error(`no node for ${key}`)
  return node
}

type EntryStream = ReadableStream<Array<{ key: string; value: unknown }>>

/** Reads until the stream closes, releasing the reader lock afterwards. */
const readEntries = async (stream: EntryStream) => {
  const reader = stream.getReader()
  const entries: Array<{ key: string; value: unknown }> = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return entries
      entries.push(...value)
    }
  } finally {
    reader.releaseLock()
  }
}

/** Reads exactly one batch, so an open stream does not block the test. */
const readBatch = async (stream: EntryStream) => {
  const reader = stream.getReader()
  try {
    const { done, value } = await reader.read()
    if (done) throw new Error("stream closed before sending a batch")
    return value
  } finally {
    reader.releaseLock()
  }
}

const expectClosed = async (stream: EntryStream) => {
  const reader = stream.getReader()
  try {
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    })
  } finally {
    reader.releaseLock()
  }
}

const disposals: Array<() => void> = []
const makeRegistry = () => {
  const registry = AtomRegistry.make()
  disposals.push(() => registry.dispose())
  return registry
}

afterEach(() => {
  while (disposals.length > 0) disposals.pop()!()
})

describe("setupRouterAtomIntegration dehydrate", () => {
  it("streams a value to a node the client already read and subscribed to", async () => {
    let settleOnServer = true
    const atom = makeAsyncAtom({
      key: "subscription",
      value: "from-server",
      settle: () => settleOnServer,
    })

    const serverRegistry = makeRegistry()
    const serverRouter = await startServerRequest(serverRegistry, atom)
    const state = await dehydrate(serverRouter)
    expect(state.atom.initial).toBeUndefined()

    // The client renders before the server value is streamed: it has read the
    // atom (suspending on `Initial`) and subscribed for updates.
    settleOnServer = false
    const clientRegistry = makeRegistry()
    const clientRouter = makeClientRouter(clientRegistry)
    expect(AsyncResult.isInitial(clientRegistry.get(atom))).toBe(true)
    const received: Array<AsyncResult.AsyncResult<string, string>> = []
    clientRegistry.subscribe(atom, (result) => {
      received.push(result as AsyncResult.AsyncResult<string, string>)
    })

    await hydrate(clientRouter, state)

    // No further registry.get: the stream itself has to wake the subscriber.
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0))
    expect(received[0]!._tag).toBe("Success")
    expect(AsyncResult.getOrThrow(received[0]!)).toBe("from-server")
    expect(AsyncResult.getOrThrow(clientRegistry.get(atom))).toBe("from-server")
  })

  it("wakes a subscribed Solid atom accessor with a streamed value", async () => {
    let settleOnServer = true
    const atom = makeAsyncAtom({
      key: "solid-accessor",
      value: "streamed-into-signal",
      settle: () => settleOnServer,
    })

    const serverRegistry = makeRegistry()
    const serverRouter = await startServerRequest(serverRegistry, atom)
    const state = await dehydrate(serverRouter)

    settleOnServer = false
    const clientRegistry = makeRegistry()
    const clientRouter = makeClientRouter(clientRegistry)

    // What `useAtomValue` does once a component has rendered: it reads the
    // pending atom and subscribes the Solid signal to registry updates.
    let value!: Accessor<AsyncResult.AsyncResult<string, string>>
    const dispose = createRoot((dispose) => {
      createComponent(RegistryContext.Provider, {
        value: clientRegistry,
        get children() {
          value = useAtomValue(() => atom)
          return null
        },
      })
      return dispose
    })

    expect(AsyncResult.isInitial(value())).toBe(true)

    await hydrate(clientRouter, state)

    await vi.waitFor(() => expect(value()._tag).toBe("Success"))
    expect(AsyncResult.getOrThrow(value())).toBe("streamed-into-signal")
    dispose()
  })

  it("resolves a suspense-style wait on the streamed value", async () => {
    let settleOnServer = true
    const atom = makeAsyncAtom({
      key: "suspense",
      value: "suspended-value",
      settle: () => settleOnServer,
      delayMillis: 20,
    })

    const serverRegistry = makeRegistry()
    const serverRouter = await startServerRequest(serverRegistry, atom)
    const state = await dehydrate(serverRouter)

    settleOnServer = false
    const clientRegistry = makeRegistry()
    const clientRouter = makeClientRouter(clientRegistry)
    expect(AsyncResult.isInitial(clientRegistry.get(atom))).toBe(true)
    // What a route loader awaits while the result is initial.
    const suspended = awaitAtomSettled(clientRegistry, atom)

    await hydrate(clientRouter, state)

    const settled = await suspended
    expect(settled._tag).toBe("Success")
    expect(AsyncResult.getOrThrow(settled)).toBe("suspended-value")
  })

  it("keeps a waiting initial value and still streams its completion", async () => {
    const atom = Atom.make(
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(20))
        return "fresh"
      }),
      { initialValue: "cached" },
    ).pipe(
      Atom.keepAlive,
      Atom.serializable({ key: "waiting-success", schema: resultSchema }),
    )

    const serverRegistry = makeRegistry()
    const serverRouter = await startServerRequest(serverRegistry, atom)
    const state = await dehydrate(serverRouter)

    // The rendered value is sent, so the client HTML matches the server even
    // though the atom is still waiting for the real value.
    const initial = state.atom.initial ?? []
    expect(initial).toHaveLength(1)
    expect(initial[0]!.key).toBe("waiting-success")
    expect((initial[0]!.value as { waiting: boolean }).waiting).toBe(true)

    // The completion must not be dropped because the key was already sent.
    const streamed = await readBatch(state.atom.stream)
    expect(streamed).toHaveLength(1)
    expect(streamed[0]!.key).toBe("waiting-success")
    expect(streamed[0]!.value).toMatchObject({
      _tag: "Success",
      value: "fresh",
      waiting: false,
    })
  })

  it("applies an initial wait and its streamed completion to a client node", async () => {
    let settleOnServer = true
    const atom = Atom.make(
      Effect.gen(function* () {
        if (!settleOnServer) return yield* Effect.never
        yield* Effect.sleep(Duration.millis(50))
        return "fresh"
      }),
      { initialValue: "cached" },
    ).pipe(
      Atom.keepAlive,
      Atom.serializable({ key: "waiting-client", schema: resultSchema }),
    )

    const serverRegistry = makeRegistry()
    const serverRouter = await startServerRequest(serverRegistry, atom)
    const state = await dehydrate(serverRouter)

    settleOnServer = false
    const clientRegistry = makeRegistry()
    const clientRouter = makeClientRouter(clientRegistry)
    await hydrate(clientRouter, state)

    // The client renders the value the server rendered and keeps waiting.
    const rendered = clientRegistry.get(atom)
    expect(rendered._tag).toBe("Success")
    expect(AsyncResult.getOrThrow(rendered)).toBe("cached")
    expect(rendered.waiting).toBe(true)

    const received: Array<unknown> = []
    clientRegistry.subscribe(atom, (result) => {
      received.push(result)
    })

    await vi.waitFor(() => {
      expect(AsyncResult.getOrThrow(clientRegistry.get(atom))).toBe("fresh")
    })
    expect(
      received.some(
        (result) =>
          AsyncResult.isAsyncResult(result) &&
          result._tag === "Success" &&
          result.value === "fresh" &&
          !result.waiting,
      ),
    ).toBe(true)
    expect(clientRegistry.get(atom).waiting).toBe(false)
  })

  it("applies an initial snapshot to a node the client already read", async () => {
    let settleOnServer = true
    // Completes synchronously, so it lands in the initial snapshot.
    const atom = Atom.make(
      Effect.suspend(() =>
        settleOnServer ? Effect.succeed("from-server") : Effect.never,
      ),
    ).pipe(
      Atom.keepAlive,
      Atom.serializable({ key: "initial-existing-node", schema: resultSchema }),
    )

    const serverRegistry = makeRegistry()
    const serverRouter = await startServerRequest(serverRegistry, atom)
    const state = await dehydrate(serverRouter)
    expect(state.atom.initial).toHaveLength(1)
    expect(state.atom.initial![0]!.value).toMatchObject({ waiting: false })

    settleOnServer = false
    const clientRegistry = makeRegistry()
    const clientRouter = makeClientRouter(clientRegistry)
    expect(AsyncResult.isInitial(clientRegistry.get(atom))).toBe(true)
    const received: Array<unknown> = []
    clientRegistry.subscribe(atom, (result) => {
      received.push(result)
    })

    await hydrate(clientRouter, state)

    expect(received).toHaveLength(1)
    expect(AsyncResult.getOrThrow(clientRegistry.get(atom))).toBe("from-server")
  })

  it("does not watch atoms whose final value is already in the snapshot", async () => {
    const atom = Atom.make(Effect.succeed("done")).pipe(
      Atom.keepAlive,
      Atom.serializable({ key: "already-final", schema: resultSchema }),
    )

    const registry = makeRegistry()
    const router = await startServerRequest(registry, atom)
    const state = await dehydrate(router)

    expect(state.atom.initial).toHaveLength(1)
    expect(nodeFor(registry, "already-final").listeners.size).toBe(0)
    router.serverSsr!.setRenderFinished()
    expect(await readEntries(state.atom.stream)).toEqual([])
  })
})

describe("setupRouterAtomIntegration teardown", () => {
  it("closes and releases the stream when the request is cleaned up", async () => {
    const atom = makeAsyncAtom({
      key: "aborted",
      value: "never-sent",
      settle: () => true,
      delayMillis: 50,
    })

    const registry = makeRegistry()
    const router = await startServerRequest(registry, atom)
    const state = await dehydrate(router)
    const node = nodeFor(registry, "aborted")
    expect(node.listeners.size).toBe(1)

    // The request tears down before the render finishes (redirect, error, or
    // the client going away).
    router.serverSsr!.cleanup()

    expect(node.listeners.size).toBe(0)
    expect(registry.onNodeAdded).toBeUndefined()
    await expectClosed(state.atom.stream)
  })

  it("streams until the render finishes and then closes", async () => {
    const atom = makeAsyncAtom({
      key: "render-finished",
      value: "eventual",
      settle: () => true,
      delayMillis: 10,
    })

    const registry = makeRegistry()
    const router = await startServerRequest(registry, atom)
    const state = await dehydrate(router)

    const streamed = await readBatch(state.atom.stream)
    expect(streamed).toHaveLength(1)
    expect(streamed[0]!.value).toMatchObject({
      _tag: "Success",
      value: "eventual",
      waiting: false,
    })

    router.serverSsr!.setRenderFinished()
    expect(nodeFor(registry, "render-finished").listeners.size).toBe(0)
    expect(registry.onNodeAdded).toBeUndefined()
    await expectClosed(state.atom.stream)
  })

  it("releases watchers when the consumer cancels the stream", async () => {
    const atom = makeAsyncAtom({
      key: "cancelled",
      value: "never-read",
      settle: () => true,
      delayMillis: 50,
    })

    const registry = makeRegistry()
    const router = await startServerRequest(registry, atom)
    const state = await dehydrate(router)
    expect(nodeFor(registry, "cancelled").listeners.size).toBe(1)

    await state.atom.stream.cancel()

    expect(nodeFor(registry, "cancelled").listeners.size).toBe(0)
    expect(registry.onNodeAdded).toBeUndefined()
  })

  it("fails before installing anything when SSR state is unavailable", async () => {
    const atom = makeAsyncAtom({
      key: "no-ssr",
      value: "unused",
      settle: () => true,
    })
    const registry = makeRegistry()
    const router = makeRouter(registry, { isServer: true })
    setupRouterAtomIntegration({ router, registry })
    registry.get(atom)

    await expect(dehydrate(router)).rejects.toThrow(/Router SSR is unavailable/)

    expect(nodeFor(registry, "no-ssr").listeners.size).toBe(0)
    expect(registry.onNodeAdded).toBeUndefined()
  })

  it("survives render-finished and cleanup in either order", async () => {
    const atom = makeAsyncAtom({
      key: "both-teardowns",
      value: "unused",
      settle: () => true,
      delayMillis: 50,
    })

    const registry = makeRegistry()
    const router = await startServerRequest(registry, atom)
    const state = await dehydrate(router)

    router.serverSsr!.setRenderFinished()
    router.serverSsr!.cleanup()

    expect(nodeFor(registry, "both-teardowns").listeners.size).toBe(0)
    await expectClosed(state.atom.stream)
  })
})

describe("awaitAtomSettled", () => {
  it("resolves when the atom settles between the read and the subscription", async () => {
    const atom = Atom.make<AsyncResult.AsyncResult<string, never>>(
      AsyncResult.initial(),
    )
    const registry = makeRegistry()
    expect(AsyncResult.isInitial(registry.get(atom))).toBe(true)

    // Simulate the settlement landing in the gap between the helper's read and
    // its subscription, where no change notification can reach the listener.
    const registryWithGap: Registry = {
      ...registry,
      get: registry.get.bind(registry),
      subscribe: (target, listener, options) => {
        registry.set(atom, AsyncResult.success("late"))
        return registry.subscribe(target, listener, options)
      },
    }

    await expect(
      awaitAtomSettled(registryWithGap, atom),
    ).resolves.toMatchObject({ _tag: "Success", value: "late" })
  })
})
