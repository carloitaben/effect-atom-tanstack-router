import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { describe, expect, it } from "vitest"
import { matchesFilters } from "./filters"
import { AtomInspector } from "./index"

describe("atom filters", () => {
  it("treats async status and waiting as overlapping dimensions", () => {
    const registry = AtomRegistry.make()
    registry.get(Atom.make(AsyncResult.success(42, { waiting: true })))
    const node = new AtomInspector().snapshot(registry).nodes[0]!
    expect(matchesFilters(node, "valid", "Success")).toBe(true)
    expect(matchesFilters(node, "valid", "waiting")).toBe(true)
    expect(matchesFilters(node, "stale", "waiting")).toBe(false)
    expect(matchesFilters(node, "valid", "Failure")).toBe(false)
  })
})
