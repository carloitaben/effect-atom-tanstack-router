/** @jsxImportSource solid-js */
// @vitest-environment jsdom
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { createSignal } from "solid-js"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AtomDevtools,
  AtomDevtoolsPanel,
  createAtomDevtoolsPlugin,
} from "./devtools"

interface PluginProps {
  readonly theme: "light" | "dark"
  readonly devtoolsOpen: boolean
}

const mounted: Array<{ dispose: () => void; container: HTMLDivElement }> = []

const mount = (component: () => JSX.Element): HTMLDivElement => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(component, container)
  mounted.push({ dispose, container })
  return container
}

const findButton = (
  root: ParentNode,
  label: string,
): HTMLButtonElement | undefined => {
  const target = label.replace(/\s+/g, "")
  return Array.from(root.querySelectorAll("button")).find(
    (item) => item.textContent?.replace(/\s+/g, "") === target,
  )
}

const renderPlugin = (
  plugin: ReturnType<typeof createAtomDevtoolsPlugin>,
  el: HTMLDivElement | HTMLHeadingElement,
  props: PluginProps,
): JSX.Element => {
  const render = plugin.render
  if (typeof render !== "function") {
    throw new Error("expected the plugin to render a function")
  }
  return render(el, props)
}

afterEach(() => {
  for (const { dispose, container } of mounted.splice(0)) {
    dispose()
    container.remove()
  }
  vi.useRealTimers()
})

describe("AtomDevtoolsPanel polling", () => {
  it("suspends polling while inactive and samples freshly when reopened", () => {
    vi.useFakeTimers()
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))
    const [active, setActive] = createSignal(false)

    const container = mount(() => (
      <AtomDevtoolsPanel
        registry={registry}
        active={active()}
        pollIntervalMs={100}
      />
    ))

    expect(container.textContent).toContain("Sampling…")
    vi.advanceTimersByTime(500)
    expect(container.textContent).toContain("Sampling…")

    setActive(true)
    expect(findButton(container, "Valid 1")).toBeDefined()
    expect(container.textContent).toContain("Polling 100ms")

    registry.get(Atom.keepAlive(Atom.make(2)))
    vi.advanceTimersByTime(100)
    expect(findButton(container, "Valid 2")).toBeDefined()

    setActive(false)
    expect(container.textContent).toContain("Polling suspended")

    registry.get(Atom.keepAlive(Atom.make(3)))
    vi.advanceTimersByTime(500)
    expect(findButton(container, "Valid 2")).toBeDefined()

    setActive(true)
    expect(findButton(container, "Valid 3")).toBeDefined()
  })

  it("reads visibility from the owning document", () => {
    vi.useFakeTimers()
    const offscreen = document.implementation.createHTMLDocument("popout")
    let visibility: "hidden" | "visible" = "hidden"
    Object.defineProperty(offscreen, "visibilityState", {
      configurable: true,
      get: () => visibility,
    })

    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))

    const container = mount(() => (
      <AtomDevtoolsPanel
        registry={registry}
        pollIntervalMs={100}
        ownerDocument={offscreen}
      />
    ))
    expect(findButton(container, "Valid 1")).toBeDefined()

    registry.get(Atom.keepAlive(Atom.make(2)))
    vi.advanceTimersByTime(500)
    expect(findButton(container, "Valid 1")).toBeDefined()

    visibility = "visible"
    vi.advanceTimersByTime(100)
    expect(findButton(container, "Valid 2")).toBeDefined()
  })
})

describe("createAtomDevtoolsPlugin shell state", () => {
  it("preserves search, selection, filters and pause when shell props change", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.withLabel(Atom.keepAlive(Atom.make(1)), "counter"))
    const plugin = createAtomDevtoolsPlugin({ registry, pollIntervalMs: 1000 })
    const el = document.createElement("div")
    const [theme, setTheme] = createSignal<"dark" | "light">("dark")
    const [open, setOpen] = createSignal(true)
    const container = mount(() => (
      <>{renderPlugin(plugin, el, { theme: theme(), devtoolsOpen: open() })}</>
    ))
    const input = container.querySelector("input")!
    input.value = "counter"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    const button = (label: string) => findButton(container, label)!
    container
      .querySelector<HTMLButtonElement>('button[title="counter"]')!
      .click()
    button("Valid 1").click()
    button("Pause").click()
    setOpen(false)
    setOpen(true)
    setTheme("light")
    expect(container.querySelector("input")?.value).toBe("counter")
    expect(container.textContent).toContain("Registry metadata")
    expect(button("Valid 1").getAttribute("aria-pressed")).toBe("true")
    expect(button("Resume")).toBeDefined()
  })
  it("builds a TanStack Devtools plugin with stable metadata", () => {
    const registry = AtomRegistry.make()

    expect(createAtomDevtoolsPlugin({ registry })).toMatchObject({
      id: "effect-atom",
      name: "Effect Atom",
    })

    expect(
      createAtomDevtoolsPlugin({
        registry,
        id: "atoms",
        name: "Atoms",
        defaultOpen: true,
      }),
    ).toMatchObject({
      id: "atoms",
      name: "Atoms",
      defaultOpen: true,
    })
  })

  it("forwards devtoolsOpen and the pane's owning document", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))
    const plugin = createAtomDevtoolsPlugin({ registry, pollIntervalMs: 0 })
    const el = document.createElement("div") as HTMLDivElement

    const closed = mount(() =>
      renderPlugin(plugin, el, { theme: "dark", devtoolsOpen: false }),
    )
    expect(closed.textContent).toContain("Effect Atom")
    expect(closed.textContent).toContain("Polling suspended (devtools closed)")
    expect(closed.textContent).toContain("Sampling…")

    const open = mount(() =>
      renderPlugin(plugin, el, { theme: "dark", devtoolsOpen: true }),
    )
    expect(findButton(open, "Valid 1")).toBeDefined()
    expect(open.textContent).toContain("Polling off")
  })

  it("keeps the standalone panel polling by default", () => {
    vi.useFakeTimers()
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))

    const container = mount(() => (
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={100} />
    ))
    expect(findButton(container, "Valid 1")).toBeDefined()

    registry.get(Atom.keepAlive(Atom.make(2)))
    vi.advanceTimersByTime(100)
    expect(findButton(container, "Valid 2")).toBeDefined()
  })

  it("clears its polling interval when the panel unmounts", () => {
    vi.useFakeTimers()
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))

    const container = document.createElement("div")
    document.body.appendChild(container)
    const dispose = render(
      () => <AtomDevtoolsPanel registry={registry} pollIntervalMs={100} />,
      container,
    )
    expect(findButton(container, "Valid 1")).toBeDefined()

    dispose()
    container.remove()

    registry.get(Atom.keepAlive(Atom.make(2)))
    vi.advanceTimersByTime(500)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not mount the unified shell when disabled", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))

    const container = mount(() => (
      <AtomDevtools registry={registry} enabled={false} />
    ))
    expect(container.textContent).toBe("")
  })
})

describe("panel labels and atom rows", () => {
  it("drops the instructional copy and keeps sampled counts and truncation explicit", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))
    registry.get(Atom.keepAlive(Atom.make(2)))

    const container = mount(() => (
      <AtomDevtoolsPanel registry={registry} maxNodes={1} pollIntervalMs={0} />
    ))

    expect(container.textContent).toContain(
      "Showing 1 of 2 atoms (maxNodes limit).",
    )
    expect(container.textContent).not.toContain("Read-only sampled snapshot")
    expect(container.textContent).not.toContain("Counts cover sampled nodes")
    expect(container.textContent).not.toContain("states can overlap")
    expect(
      container.querySelector('[aria-label="Filter atoms by state"]'),
    ).not.toBeNull()
    expect(container.textContent).not.toContain("Node state")
    expect(container.textContent).not.toContain("Async state")

    const filters = container.querySelector(
      '[aria-label="Filter atoms by state"]',
    )!
    expect(
      Array.from(filters.querySelectorAll("button"), (button) =>
        button.textContent?.replace(/\d+$/, "").trim(),
      ),
    ).toEqual([
      "Valid",
      "Success",
      "Failure",
      "Stale",
      "Waiting",
      "Initial",
      "Uninitialized",
      "Removed",
    ])
    expect(findButton(filters, "All 1")).toBeUndefined()
    expect(findButton(filters, "Uninitialized 0")).toBeDefined()
    expect(findButton(filters, "Waiting 0")).toBeDefined()
    findButton(filters, "Valid 1")!.click()
    findButton(filters, "Waiting 0")!.click()
    expect(findButton(filters, "Valid 1")?.getAttribute("aria-pressed")).toBe(
      "false",
    )
    expect(findButton(filters, "Waiting 0")?.getAttribute("aria-pressed")).toBe(
      "true",
    )
    findButton(filters, "Waiting 0")!.click()
    expect(findButton(filters, "Waiting 0")?.getAttribute("aria-pressed")).toBe(
      "false",
    )
    expect(container.textContent).toContain("Valid")

    findButton(container, "Reset registry")!.click()
    expect(container.textContent).toContain(
      "including the 1 not shown in this sample",
    )
  })

  it("shows async and node status on one atom row and keeps dependency counts in details", () => {
    const registry = AtomRegistry.make()
    registry.get(
      Atom.withLabel(
        Atom.keepAlive(Atom.make(AsyncResult.success(1))),
        "query",
      ),
    )

    const container = mount(() => (
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />
    ))
    const row = container.querySelector<HTMLButtonElement>(
      'button[title="query"]',
    )!

    expect(row.textContent).toContain("query")
    expect(row.textContent).toContain("Success")
    expect(row.textContent).toContain("Valid")
    expect(row.textContent).not.toContain("deps")
    expect(row.textContent).not.toContain("used by")
    expect(row.style.flexDirection).not.toBe("column")

    row.click()
    expect(container.textContent).toContain("Depends on (0)")
    expect(container.textContent).toContain("Used by (0)")
  })
})

describe("registry reset", () => {
  it("does not reset on render or when the confirmation is cancelled", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.withLabel(Atom.make(1), "counter")))
    registry.get(Atom.keepAlive(Atom.withLabel(Atom.make(2), "total")))
    const reset = vi.spyOn(registry, "reset")

    const container = mount(() => (
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />
    ))

    expect(reset).not.toHaveBeenCalled()
    expect(findButton(container, "Valid 2")).toBeDefined()

    const trigger = findButton(container, "Reset registry")!
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    trigger.click()

    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(container.textContent).toContain("Reset the whole registry?")
    expect(container.textContent).toContain("Listeners and subscriptions stop")
    expect(container.textContent).toContain(
      "Every atom node in this registry will be removed",
    )
    expect(reset).not.toHaveBeenCalled()
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel")

    findButton(container, "Cancel")!.click()
    expect(container.textContent).not.toContain("Reset the whole registry?")
    expect(reset).not.toHaveBeenCalled()
    expect(findButton(container, "Valid 2")).toBeDefined()
  })

  it("resets the whole registry only after confirmation and stops listeners", () => {
    const registry = AtomRegistry.make()
    const atom = Atom.keepAlive(Atom.withLabel(Atom.make(0), "counter"))
    registry.get(atom)
    let notifications = 0
    const unsubscribe = registry.subscribe(atom, () => {
      notifications++
    })
    const reset = vi.spyOn(registry, "reset")

    const container = mount(() => (
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />
    ))
    findButton(container, "Reset registry")!.click()
    findButton(container, "Confirm reset")!.click()

    expect(reset).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain("Reset the whole registry?")
    expect(findButton(container, "Valid 0")).toBeDefined()

    registry.set(atom, 1)
    expect(notifications).toBe(0)
    unsubscribe()
  })

  it("reports reset errors and keeps the confirmation open", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.withLabel(Atom.make(1), "counter")))
    vi.spyOn(registry, "reset").mockImplementation(() => {
      throw new Error("registry busy")
    })

    const container = mount(() => (
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />
    ))
    findButton(container, "Reset registry")!.click()
    findButton(container, "Confirm reset")!.click()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "registry busy",
    )
    expect(container.textContent).toContain("Reset the whole registry?")
    expect(findButton(container, "Valid 1")).toBeDefined()
  })

  it("resets while paused without resuming polling", () => {
    vi.useFakeTimers()
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))

    const container = mount(() => (
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={100} />
    ))
    findButton(container, "Pause")!.click()
    findButton(container, "Reset registry")!.click()
    findButton(container, "Confirm reset")!.click()

    expect(findButton(container, "Valid 0")).toBeDefined()
    expect(findButton(container, "Resume")).toBeDefined()

    registry.get(Atom.keepAlive(Atom.make(2)))
    vi.advanceTimersByTime(500)
    expect(findButton(container, "Valid 0")).toBeDefined()
  })

  it("cancels an open confirmation when the pane becomes inactive", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))
    const [active, setActive] = createSignal(true)

    const container = mount(() => (
      <AtomDevtoolsPanel
        registry={registry}
        active={active()}
        pollIntervalMs={0}
      />
    ))
    findButton(container, "Reset registry")!.click()
    expect(container.textContent).toContain("Reset the whole registry?")

    setActive(false)
    expect(container.textContent).not.toContain("Reset the whole registry?")
    expect(findButton(container, "Reset registry")).toMatchObject({
      disabled: true,
    })
  })
})
