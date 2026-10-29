import type { TanStackDevtoolsReactPlugin } from "@tanstack/react-devtools"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AtomDevtools,
  AtomDevtoolsPanel,
  createAtomDevtoolsPlugin,
} from "./devtools"

const renderPlugin = (plugin: TanStackDevtoolsReactPlugin): ReactElement => {
  const render = plugin.render
  if (typeof render !== "function") {
    throw new Error("expected the plugin to render a function")
  }
  return render({} as HTMLElement, { theme: "dark", devtoolsOpen: false })
}

describe("createAtomDevtoolsPlugin", () => {
  it("builds a TanStack Devtools plugin for a registry", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.make(1))

    const plugin = createAtomDevtoolsPlugin({ registry })

    expect(plugin.id).toBe("effect-atom")
    expect(plugin.name).toBe("Effect Atom")
    expect(typeof plugin.render).toBe("function")
  })

  it("forwards metadata and panel options", () => {
    const registry = AtomRegistry.make()
    const plugin = createAtomDevtoolsPlugin({
      registry,
      id: "atoms",
      name: "Atoms",
      defaultOpen: true,
      pollIntervalMs: 0,
      maxNodes: 10,
      maxPreviewLength: 50,
    })

    expect(plugin).toMatchObject({
      id: "atoms",
      name: "Atoms",
      defaultOpen: true,
    })

    const element = renderPlugin(plugin)

    expect(element.type).toBe(AtomDevtoolsPanel)
    expect(element.props).toMatchObject({
      registry,
      theme: "dark",
      pollIntervalMs: 0,
      maxNodes: 10,
      maxPreviewLength: 50,
    })
  })
})

describe("AtomDevtools", () => {
  it("renders nothing during server rendering or when disabled", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.make(1))

    expect(renderToStaticMarkup(<AtomDevtools registry={registry} />)).toBe("")
    expect(
      renderToStaticMarkup(
        <AtomDevtools registry={registry} enabled={false} />,
      ),
    ).toBe("")
  })
})

describe("public exports", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("replace the pane and plugin with no-ops outside development", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    const devtools = await import("./react")
    const registry = AtomRegistry.make()
    registry.get(Atom.make(1))

    expect(
      renderToStaticMarkup(<devtools.AtomDevtoolsPanel registry={registry} />),
    ).toBe("")
    expect(
      renderToStaticMarkup(<devtools.AtomDevtools registry={registry} />),
    ).toBe("")

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
    expect(renderToStaticMarkup(renderPlugin(plugin))).toBe("")

    expect(devtools.createAtomDevtoolsPlugin({ registry })).toMatchObject({
      id: "effect-atom",
      name: "Effect Atom",
    })
  })

  it("expose the real pane and plugin in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.resetModules()
    const devtools = await import("./react")
    const registry = AtomRegistry.make()
    registry.get(Atom.make(1))

    expect(
      renderToStaticMarkup(<devtools.AtomDevtoolsPanel registry={registry} />),
    ).toContain("Effect Atom")

    const plugin = devtools.createAtomDevtoolsPlugin({
      registry,
      pollIntervalMs: 0,
    })

    expect(renderToStaticMarkup(renderPlugin(plugin))).toContain("Effect Atom")
  })
})
