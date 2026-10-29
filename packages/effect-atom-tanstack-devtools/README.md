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
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createAtomDevtoolsPlugin } from "effect-atom-tanstack-devtools/react";
import { useMemo } from "react";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";

function Devtools({ registry }: { registry: AtomRegistry }) {
  const plugins = useMemo(
    () => [
      { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
      createAtomDevtoolsPlugin({ registry }),
    ],
    [registry],
  );

  return <TanStackDevtools plugins={plugins} />;
}
```

### Solid

```tsx
import { TanStackDevtools } from "@tanstack/solid-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/solid-router-devtools";
import { createAtomDevtoolsPlugin } from "effect-atom-tanstack-devtools/solid";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";

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
  );
}
```

The Router pane is optional. See the [React example](../../examples/react) or the [Solid example](../../examples/solid) for a complete setup.

If you don't already have a shell, `AtomDevtools` mounts one with the Effect Atom pane:

```tsx
import { AtomDevtools } from "effect-atom-tanstack-devtools/react";
import { AtomDevtools } from "effect-atom-tanstack-devtools/solid";
```

## Options

Pass these to `createAtomDevtoolsPlugin`, `AtomDevtools`, or `AtomDevtoolsPanel`:

| Option             | Default | Description                                             |
| ------------------ | ------- | ------------------------------------------------------- |
| `pollIntervalMs`   | `1000`  | Sampling interval in milliseconds; `0` disables polling |
| `maxNodes`         | `1000`  | Maximum atoms included in a sample                      |
| `maxPreviewLength` | `400`   | Maximum preview length                                  |

## Inspection core

The framework-independent entry point can be used without React or Solid:

```ts
import { AtomInspector } from "effect-atom-tanstack-devtools";

const inspector = new AtomInspector();
const snapshot = inspector.snapshot(registry);
```

## License

[MIT](/LICENSE)
