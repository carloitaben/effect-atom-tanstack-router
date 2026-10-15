# effect-atom-tanstack-solid-router

TanStack Router SSR hydration integration for Effect Atom, mirroring `@tanstack/router-ssr-query-core`.

## Usage

First, add `AtomRegistry` to your root route context.

```ts
// src/routes/__root.tsx
import { createRootRouteWithContext } from "@tanstack/solid-router"
import type { AtomRegistry } from "effect/reactivity/AtomRegistry"

export const Route = createRootRouteWithContext<{
  registry: AtomRegistry
}>()({
  // ...
})
```

Then, setup the atom registry and the integration.

```ts
// src/router.tsx
import { createRouter } from "@tanstack/solid-router"
import { setupRouterAtomIntegration } from "effect-atom-tanstack-solid-router"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"

export function getRouter() {
  const registry = AtomRegistry.make({ scheduleTask })

  const router = createRouter({
    context: { registry },
    // ...
  })

  setupRouterAtomIntegration({
    router,
    registry,
  })

  return router
}
```

There are two ways to interact with an atom, depending on whether the loader needs the data.

### Streaming

Kick off loading without waiting. The atom starts fetching on the server, then streams to the client while the component suspends on it. Use this when the loader itself doesn't need the value.

```ts
loader: ({ context }) => {
  context.registry.get(postsAtom)
}
```

### Blocking

Await the atom and return data from the loader. Use this when the loader needs the value.

```ts
import { awaitAtomSettled } from "effect-atom-tanstack-solid-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"

loader: async ({ params: { postId }, context }) => {
  const data = await awaitAtomSettled(context.registry, postAtom(postId))

  return {
    title: AsyncResult.getOrThrow(data).title,
  }
}
```

> [!WARNING]
> Atoms must be marked `Atom.serializable()` and require `Atom.keepAlive` for them to be picked up by the integration.
