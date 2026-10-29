/** @jsxImportSource solid-js */
// @vitest-environment jsdom
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it } from "vitest"
import { AtomInspector } from "../index"
import type { AtomValueNode } from "../index"
import { ValueTree } from "./value-tree"

const treeOf = (value: unknown): AtomValueNode => {
  const registry = AtomRegistry.make()
  registry.get(Atom.make(value))
  const snapshot = new AtomInspector().snapshot(registry)
  const node = snapshot.nodes[0]!
  if (node.value.status === "uninitialized") {
    throw new Error("expected an initialized value")
  }
  return node.value.value
}

const mounted: Array<{ dispose: () => void; container: HTMLDivElement }> = []

const mount = (value: AtomValueNode) => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(() => <ValueTree value={value} />, container)
  mounted.push({ dispose, container })
  return container
}

const expandAll = (container: HTMLElement) => {
  for (const details of container.querySelectorAll("details")) {
    if (details.open) continue
    details.open = true
    details.dispatchEvent(new Event("toggle", { bubbles: true }))
  }
}

afterEach(() => {
  for (const { dispose, container } of mounted.splice(0)) {
    dispose()
    container.remove()
  }
})

describe("ValueTree", () => {
  it("does not invoke getters while rendering a collapsed object", () => {
    let reads = 0
    const tree = treeOf({
      get data() {
        reads++
        return 42
      },
    })

    const container = mount(tree)

    expect(container.textContent).toContain("Object (1 keys)")
    expect(container.textContent).not.toContain("42")
    expect(reads).toBe(0)
  })

  it("renders unsupported built-ins as bounded leaf previews", () => {
    const container = mount(treeOf(new Date(0)))

    expect(container.textContent).toContain("1970-01-01T00:00:00.000Z")
    expect(container.querySelector("details")).toBeNull()
  })

  it("expands the captured entries instead of the live value", () => {
    let reads = 0
    const live = {
      name: "before",
      get secret() {
        reads++
        return "leaked"
      },
    }
    const tree = treeOf(live)
    live.name = "after"

    const container = mount(tree)
    expandAll(container)

    expect(container.textContent).toContain("name: ")
    expect(container.textContent).toContain('"before"')
    expect(container.textContent).not.toContain('"after"')
    expect(container.textContent).toContain("secret: [Getter]")
    expect(container.textContent).not.toContain("leaked")
    expect(reads).toBe(0)
  })

  it("shows omitted entries without traversing the live value", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`key${index}`, index]),
    )
    const container = mount(treeOf(wide))

    expandAll(container)

    const items = container.querySelectorAll("li")
    expect(items).toHaveLength(51)
    expect(container.textContent).toContain("… 10 more entries omitted")
  })
})
