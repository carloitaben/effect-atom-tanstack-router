# Effect Atom Devtools

[TanStack Devtools](https://tanstack.com/devtools) integration for [Effect Atom](https://effect.website).

![Effect Atom and TanStack Router devtools](https://raw.githubusercontent.com/carloitaben/effect-atom-tanstack-router/main/packages/effect-atom-tanstack-devtools/assets/devtools.jpg)

## Installation

```sh
pnpm add -D effect-atom-tanstack-devtools @tanstack/react-devtools
```

or, for SolidJS:

```sh
pnpm add -D effect-atom-tanstack-devtools @tanstack/solid-devtools
```

Requires Effect 4 and React 19 or Solid 1.9.

## Usage

Add the plugin to your existing TanStack Devtools shell and pass the registry you want to inspect.

### React

```tsx
import { TanStackDevtools } from "@tanstack/react-devtools"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { createAtomDevtoolsPlugin } from "effect-atom-tanstack-devtools/react"
import { useMemo } from "react"
import type { AtomRegistry } from "effect/reactivity/AtomRegistry"

function Devtools({ registry }: { registry: AtomRegistry }) {
  const plugins = useMemo(
    () => [
      { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
      createAtomDevtoolsPlugin({ registry }),
    ],
    [registry],
  )

  return <TanStackDevtools plugins={plugins} />
}
```

### Solid

```tsx
import { TanStackDevtools } from "@tanstack/solid-devtools"
import { TanStackRouterDevtoolsPanel } from "@tanstack/solid-router-devtools"
import { createAtomDevtoolsPlugin } from "effect-atom-tanstack-devtools/solid"
import type { AtomRegistry } from "effect/reactivity/AtomRegistry"

function Devtools(props: { readonly registry: AtomRegistry }) {
  return (
    <TanStackDevtools
      plugins={[
        {
          name: "TanStack Router",
          render: <TanStackRouterDevtoolsPanel />,
        },
        createAtomDevtoolsPlugin({ registry: props.registry }),
      ]}
    />
  )
}
```

The Router pane is optional. See the [React example](../../examples/react) or the [Solid example](../../examples/solid) for a complete setup.

If you don't already have a shell, `AtomDevtools` mounts one with the Effect Atom pane:

```tsx
import { AtomDevtools } from "effect-atom-tanstack-devtools/react"

;<AtomDevtools registry={registry} />
```

For Solid, import it from `effect-atom-tanstack-devtools/solid`.

The Solid entry also ships its source under the `solid` export condition so
Solid-aware bundlers can compile it for both SSR and the client. Vite with
`vite-plugin-solid` and TanStack Start do this automatically.

## Options

Pass these to `createAtomDevtoolsPlugin`, `AtomDevtools`, or `AtomDevtoolsPanel`:

| Option             | Default | Description                                             |
| ------------------ | ------- | ------------------------------------------------------- |
| `pollIntervalMs`   | `1000`  | Sampling interval in milliseconds; `0` disables polling |
| `maxNodes`         | `1000`  | Maximum atoms included in a sample                      |
| `maxPreviewLength` | `400`   | Maximum preview length                                  |

The plugin also accepts `id`, `name`, and `defaultOpen`. The standalone shell accepts TanStack Devtools `config` and an `enabled` toggle.

## How it works

Inspection is read-only. It samples cached registry values without computing, mounting, or subscribing to atoms. Samples are not a history: short-lived changes between polls can be missed. Status counts cover the sampled atoms and indicate when the sample is truncated.

The pane also exposes one write action, **Reset registry**. It calls the public `registry.reset()` only after an explicit confirmation that explains the scope. That removes every atom node in the registry, not just the selected or sampled ones, stops listeners and subscriptions, and interrupts in-flight work. Atoms read again start from scratch. Cancel leaves the registry untouched.

Values are captured as bounded display trees. Plain objects and arrays can be expanded; accessors are not evaluated, and other objects are shown as previews. Inspecting proxies can invoke traps, and enumerating large objects or formatting failure causes can still be expensive.

The React and Solid exports are no-ops outside development, provided your bundler replaces `process.env.NODE_ENV`. If you render a shared `<TanStackDevtools>` shell yourself, exclude that shell from production separately—for example, with `import.meta.env.DEV` in Vite.

## Inspection core

The framework-independent entry point can be used without React or Solid:

```ts
import { AtomInspector } from "effect-atom-tanstack-devtools"

const inspector = new AtomInspector()
const snapshot = inspector.snapshot(registry)
```

Reuse the inspector across samples to keep generated atom IDs stable. Captured values are display data, not live application objects.

## License

MIT
