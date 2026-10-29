// @vitest-environment jsdom
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { act } from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AtomDevtoolsPanel, createAtomDevtoolsPlugin } from "./devtools"

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{
  root: ReturnType<typeof createRoot>
  container: HTMLDivElement
}> = []

const mount = (element: ReactElement): HTMLDivElement => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  mounted.push({ root, container })
  return container
}

const rerender = (index: number, element: ReactElement) => {
  act(() => {
    mounted[index]!.root.render(element)
  })
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

const click = (button: HTMLButtonElement | undefined) => {
  if (button === undefined) throw new Error("expected a button")
  act(() => {
    button.click()
  })
}

afterEach(() => {
  act(() => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount()
      container.remove()
    }
  })
  vi.useRealTimers()
})

describe("AtomDevtoolsPanel polling", () => {
  it("suspends polling while inactive and samples freshly when reopened", () => {
    vi.useFakeTimers()
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))

    const container = mount(
      <AtomDevtoolsPanel
        registry={registry}
        active={false}
        pollIntervalMs={100}
      />,
    )

    expect(container.textContent).toContain("Sampling…")
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(container.textContent).toContain("Sampling…")

    rerender(
      0,
      <AtomDevtoolsPanel registry={registry} active pollIntervalMs={100} />,
    )
    expect(findButton(container, "Valid 1")).toBeDefined()
    expect(container.textContent).toContain("Polling 100ms")

    registry.get(Atom.keepAlive(Atom.make(2)))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(findButton(container, "Valid 2")).toBeDefined()

    rerender(
      0,
      <AtomDevtoolsPanel
        registry={registry}
        active={false}
        pollIntervalMs={100}
      />,
    )
    expect(container.textContent).toContain("Polling suspended")

    registry.get(Atom.keepAlive(Atom.make(3)))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(findButton(container, "Valid 2")).toBeDefined()

    rerender(
      0,
      <AtomDevtoolsPanel registry={registry} active pollIntervalMs={100} />,
    )
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

    const container = mount(
      <AtomDevtoolsPanel
        registry={registry}
        pollIntervalMs={100}
        ownerDocument={offscreen}
      />,
    )
    expect(findButton(container, "Valid 1")).toBeDefined()

    registry.get(Atom.keepAlive(Atom.make(2)))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(findButton(container, "Valid 1")).toBeDefined()

    visibility = "visible"
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(findButton(container, "Valid 2")).toBeDefined()
  })
})

describe("createAtomDevtoolsPlugin shell state", () => {
  it("forwards devtoolsOpen and the pane's owning document", () => {
    const registry = AtomRegistry.make()
    const plugin = createAtomDevtoolsPlugin({ registry })
    const element = document.createElement("div")
    const render = plugin.render as (
      el: HTMLElement,
      props: { theme: "dark"; devtoolsOpen: boolean },
    ) => ReactElement

    const closed = render(element, { theme: "dark", devtoolsOpen: false })
    expect(closed.props).toMatchObject({
      registry,
      theme: "dark",
      active: false,
      ownerDocument: document,
    })

    const open = render(element, { theme: "dark", devtoolsOpen: true })
    expect(open.props).toMatchObject({ active: true })
  })

  it("keeps the standalone panel polling by default", () => {
    vi.useFakeTimers()
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))

    const container = mount(
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={100} />,
    )
    expect(findButton(container, "Valid 1")).toBeDefined()

    registry.get(Atom.keepAlive(Atom.make(2)))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(findButton(container, "Valid 2")).toBeDefined()
  })
})

describe("panel labels and atom rows", () => {
  it("drops the instructional copy and keeps sampled counts and truncation explicit", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))
    registry.get(Atom.keepAlive(Atom.make(2)))

    const container = mount(
      <AtomDevtoolsPanel registry={registry} maxNodes={1} pollIntervalMs={0} />,
    )

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
    click(findButton(filters, "Valid 1"))
    click(findButton(filters, "Waiting 0"))
    expect(findButton(filters, "Valid 1")?.getAttribute("aria-pressed")).toBe(
      "false",
    )
    expect(findButton(filters, "Waiting 0")?.getAttribute("aria-pressed")).toBe(
      "true",
    )
    click(findButton(filters, "Waiting 0"))
    expect(findButton(filters, "Waiting 0")?.getAttribute("aria-pressed")).toBe(
      "false",
    )
    expect(container.textContent).toContain("Valid")

    click(findButton(container, "Reset registry"))
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

    const container = mount(
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />,
    )
    const row = container.querySelector<HTMLButtonElement>(
      'button[title="query"]',
    )!

    expect(row.textContent).toContain("query")
    expect(row.textContent).toContain("Success")
    expect(row.textContent).toContain("Valid")
    expect(row.textContent).not.toContain("deps")
    expect(row.textContent).not.toContain("used by")
    expect(row.style.flexDirection).not.toBe("column")

    click(row)
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

    const container = mount(
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />,
    )

    expect(reset).not.toHaveBeenCalled()
    expect(findButton(container, "Valid 2")).toBeDefined()

    const trigger = findButton(container, "Reset registry")!
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    click(trigger)

    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(container.textContent).toContain("Reset the whole registry?")
    expect(container.textContent).toContain("Listeners and subscriptions stop")
    expect(container.textContent).toContain(
      "Every atom node in this registry will be removed",
    )
    expect(reset).not.toHaveBeenCalled()
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel")

    click(findButton(container, "Cancel"))
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

    const container = mount(
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />,
    )
    click(findButton(container, "Reset registry"))
    click(findButton(container, "Confirm reset"))

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

    const container = mount(
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />,
    )
    click(findButton(container, "Reset registry"))
    click(findButton(container, "Confirm reset"))

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

    const container = mount(
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={100} />,
    )
    click(findButton(container, "Pause"))
    click(findButton(container, "Reset registry"))
    click(findButton(container, "Confirm reset"))

    expect(findButton(container, "Valid 0")).toBeDefined()
    expect(findButton(container, "Resume")).toBeDefined()

    registry.get(Atom.keepAlive(Atom.make(2)))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(findButton(container, "Valid 0")).toBeDefined()
  })

  it("cancels an open confirmation when the pane becomes inactive", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.keepAlive(Atom.make(1)))

    const container = mount(
      <AtomDevtoolsPanel registry={registry} pollIntervalMs={0} />,
    )
    click(findButton(container, "Reset registry"))
    expect(container.textContent).toContain("Reset the whole registry?")

    rerender(
      0,
      <AtomDevtoolsPanel
        registry={registry}
        active={false}
        pollIntervalMs={0}
      />,
    )
    expect(container.textContent).not.toContain("Reset the whole registry?")
    expect(findButton(container, "Reset registry")).toMatchObject({
      disabled: true,
    })
  })
})
