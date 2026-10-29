import type { AtomNodeSnapshot } from "./index"

export type NodeFilter = "all" | AtomNodeSnapshot["state"]
export type AsyncFilter = "all" | "Initial" | "Success" | "Failure" | "waiting"

export const STATUS_FILTERS = [
  { kind: "node", state: "valid" },
  { kind: "async", state: "Success" },
  { kind: "async", state: "Failure" },
  { kind: "node", state: "stale" },
  { kind: "async", state: "waiting" },
  { kind: "async", state: "Initial" },
  { kind: "node", state: "uninitialized" },
  { kind: "node", state: "removed" },
] as const

export function countFilters(nodes: ReadonlyArray<AtomNodeSnapshot>) {
  const node = { all: 0, valid: 0, stale: 0, uninitialized: 0, removed: 0 }
  const async = { all: 0, Initial: 0, Success: 0, Failure: 0, waiting: 0 }
  for (const item of nodes) {
    node.all++
    node[item.state]++
    async.all++
    if (item.asyncResult) {
      async[item.asyncResult.tag]++
      if (item.asyncResult.waiting) async.waiting++
    }
  }
  return { node, async }
}

export function matchesFilters(
  node: AtomNodeSnapshot,
  state: NodeFilter,
  asyncState: AsyncFilter,
): boolean {
  return (
    (state === "all" || node.state === state) &&
    (asyncState === "all" ||
      (asyncState === "waiting"
        ? node.asyncResult?.waiting === true
        : node.asyncResult?.tag === asyncState))
  )
}
