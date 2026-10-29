# TanStack Start - Basic Effect Atom Solid Example

A TanStack Start example demonstrating integration with Effect Atom.

- [TanStack Router Docs](https://tanstack.com/router)
- [Effect Atom API Reference](https://www.effect.website/docs/v4/api/effect/reactivity/Atom)
- [Effect Atom Solid API Reference](https://www.effect.website/docs/v4/api/atom-solid)

## Start a new project based on this example

To start a new project based on this example, run:

```sh
npx gitpick carloitaben/effect-atom-tanstack-router/tree/main/examples/solid start-basic-effect-atom-solid
```

## Getting Started

From your terminal:

```sh
pnpm install
pnpm dev
```

This starts your app in development mode, rebuilding assets on file changes.

## Effect Atom Devtools

In development, the root route mounts a single unified TanStack Devtools shell
with both the Router pane and an
[Effect Atom pane](../../packages/effect-atom-tanstack-devtools):

```tsx
import { TanStackDevtools } from "@tanstack/solid-devtools"
import { TanStackRouterDevtoolsPanel } from "@tanstack/solid-router-devtools"
import { createAtomDevtoolsPlugin } from "effect-atom-tanstack-devtools/solid"

const plugins = [
  { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
  createAtomDevtoolsPlugin({ registry }),
]

{
  import.meta.env.DEV && <TanStackDevtools plugins={plugins} />
}
```

Open the devtools trigger and choose **Effect Atom** to inspect the router's
atom registry, or **TanStack Router** for the router pane. There is no separate
Router or Atom floating shell.

The Atom pane and plugin are no-ops outside development on their own. The
`import.meta.env.DEV` branch only keeps the unified shell out of the production
bundle, because `@tanstack/solid-devtools` does not strip its own shell.

Sampling never initializes an atom or keeps one alive. The pane's only write is
an explicit, confirmed Reset registry action.

## Build

To build the app for production:

```sh
pnpm build
```
