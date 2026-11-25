# effect-atom-tanstack-solid-router

[TanStack Router](https://tanstack.com/router) SSR hydration integration for [Effect Atom](https://effect.website).

## Usage

First, add `AtomRegistry` to your root route context.

```ts
// src/routes/__root.tsx
import { createRootRouteWithContext } from "@tanstack/solid-router";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";

export const Route = createRootRouteWithContext<{
  registry: AtomRegistry;
}>()({
  // ...
});
```

Then, setup the atom registry and the integration.

```ts
// src/router.tsx
import { createRouter } from "@tanstack/solid-router";
import { setupRouterAtomIntegration } from "effect-atom-tanstack-solid-router";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

export function getRouter() {
  const registry = AtomRegistry.make({ scheduleTask });

  const router = createRouter({
    context: { registry },
    // ...
  });

  setupRouterAtomIntegration({
    router,
    registry,
  });

  return router;
}
```

There are two ways to interact with an atom, depending on whether the loader needs the data.

### Streaming

Kick off loading without waiting. The atom starts fetching on the server, then streams to the client while the component suspends on it. Use this when the loader itself doesn't need the value.

```ts
loader: ({ context }) => {
  context.registry.get(postsAtom);
};
```

### Blocking

Await the atom and return data from the loader. Use this when the loader needs the value.

```ts
import { awaitAtomSettled } from "effect-atom-tanstack-solid-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";

loader: async ({ params: { postId }, context }) => {
  const data = await awaitAtomSettled(context.registry, postAtom(postId));

  return {
    title: AsyncResult.getOrThrow(data).title,
  };
};
```

> [!WARNING]
> Atoms must be serializable and retained in the registry during SSR to be picked up by the integration.

### Avoiding a duplicate request after hydration

For `AtomRpc` non-streaming queries and `AtomHttpApi` queries, set `serializationKey` and `staleTime` to reuse a fresh server result instead of immediately requesting it again in the browser:

```ts
const postsAtom = PostsClient.query("ListPosts", undefined, {
  serializationKey: "all",
  staleTime: "1 minute",
  timeToLive: "5 minutes",
});
```

The query handles serialization. A stale result remains visible while it revalidates; `timeToLive` separately controls how long an unused result is retained. See the [Solid RPC example](../../examples/solid/src/utils/posts.tsx).

## License

MIT
