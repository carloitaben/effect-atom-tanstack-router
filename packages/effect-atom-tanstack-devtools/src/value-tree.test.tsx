// @vitest-environment jsdom
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { act } from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { AtomInspector } from "./index"
import type { AtomValueNode } from "./index"
import { ValueTree } from "./value-tree"

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

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

const mounted: Array<{
  root: ReturnType<typeof createRoot>
  container: HTMLDivElement
}> = []

const mount = (element: ReactElement) => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  mounted.push({ root, container })
  return container
}

const expandAll = (container: HTMLElement) => {
  act(() => {
    for (const details of container.querySelectorAll("details")) {
      if (details.open) continue
      details.open = true
      details.dispatchEvent(new Event("toggle", { bubbles: true }))
    }
  })
}

afterEach(() => {
  act(() => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount()
      container.remove()
    }
  })
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

    expect(renderToStaticMarkup(<ValueTree value={tree} />)).toContain(
      "Object (1 keys)",
    )
    expect(reads).toBe(0)
  })

  it("renders unsupported built-ins as bounded leaf previews", () => {
    const markup = renderToStaticMarkup(
      <ValueTree value={treeOf(new Date(0))} />,
    )

    expect(markup).toContain("1970-01-01T00:00:00.000Z")
    expect(markup).not.toContain("<details>")
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

    const container = mount(<ValueTree value={tree} />)
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
    const container = mount(<ValueTree value={treeOf(wide)} />)

    expandAll(container)

    const items = container.querySelectorAll("li")
    expect(items).toHaveLength(51)
    expect(container.textContent).toContain("… 10 more entries omitted")
  })
})
