/** @jsxImportSource solid-js */
// @vitest-environment jsdom
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type { JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

interface PluginProps {
  readonly theme: "light" | "dark"
  readonly devtoolsOpen: boolean
}

const renderPlugin = (
  plugin: { readonly render: unknown },
  props: PluginProps,
): JSX.Element => {
  const render = plugin.render
  if (typeof render !== "function") {
    throw new Error("expected the plugin to render a function")
  }
  return render(document.createElement("div"), props) as JSX.Element
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("public exports", () => {
  it("replace the pane and plugin with no-ops outside development", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    const [{ render }, devtools] = await Promise.all([
      import("solid-js/web"),
      import("./index"),
    ])
    const registry = AtomRegistry.make()
    registry.get(Atom.make(1))

    const panelContainer = document.createElement("div")
    document.body.appendChild(panelContainer)
    const disposePanel = render(
      () => <devtools.AtomDevtoolsPanel registry={registry} />,
      panelContainer,
    )
    expect(panelContainer.textContent).toBe("")
    disposePanel()
    panelContainer.remove()

    const plugin = devtools.createAtomDevtoolsPlugin({
      registry,
      id: "atoms",
      name: "Atoms",
      defaultOpen: true,
    })

    expect(plugin).toMatchObject({
      id: "atoms",
      name: "Atoms",
      defaultOpen: true,
    })

    const pluginContainer = document.createElement("div")
    document.body.appendChild(pluginContainer)
    const disposePlugin = render(
      () => renderPlugin(plugin, { theme: "dark", devtoolsOpen: true }),
      pluginContainer,
    )
    expect(pluginContainer.textContent).toBe("")
    disposePlugin()
    pluginContainer.remove()

    expect(devtools.createAtomDevtoolsPlugin({ registry })).toMatchObject({
      id: "effect-atom",
      name: "Effect Atom",
    })
  })

  it("expose the real pane and plugin in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.resetModules()
    const [{ render }, devtools] = await Promise.all([
      import("solid-js/web"),
      import("./index"),
    ])
    const registry = AtomRegistry.make()
    registry.get(Atom.make(1))

    const panelContainer = document.createElement("div")
    document.body.appendChild(panelContainer)
    const disposePanel = render(
      () => (
        <devtools.AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />
      ),
      panelContainer,
    )
    expect(panelContainer.textContent).toContain("Effect Atom")
    expect(panelContainer.textContent).toContain("Valid1")
    disposePanel()
    panelContainer.remove()

    const plugin = devtools.createAtomDevtoolsPlugin({
      registry,
      pollIntervalMs: 0,
    })

    const pluginContainer = document.createElement("div")
    document.body.appendChild(pluginContainer)
    const disposePlugin = render(
      () => renderPlugin(plugin, { theme: "dark", devtoolsOpen: true }),
      pluginContainer,
    )
    expect(pluginContainer.textContent).toContain("Effect Atom")
    disposePlugin()
    pluginContainer.remove()
  })
})
