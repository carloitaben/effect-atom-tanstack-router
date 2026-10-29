import type { AsyncFilter, NodeFilter } from "./filters"
import type { AtomAsyncResultSnapshot, AtomNodeSnapshot } from "./index"

/**
 * Colors follow the neutral ramps used by the TanStack Query and Router
 * devtools, so the pane sits comfortably next to their tabs.
 */
const palettes = {
  light: {
    background: "#f9fafb",
    surface: "#f2f4f7",
    surfaceStrong: "#eaecf0",
    border: "#d0d5dd",
    text: "#344054",
    muted: "#667085",
    accent: "#1570ef",
    success: "#039855",
    valid: "#087e8b",
    initial: "#344054",
    warning: "#b54708",
    neutral: "#475467",
    danger: "#b42318",
    info: "#1570ef",
    dangerSurface: "#fef2f2",
    dangerBorder: "#fecdca",
  },
  dark: {
    background: "#191c24",
    surface: "#212530",
    surfaceStrong: "#292e3d",
    border: "#313749",
    text: "#d0d5dd",
    muted: "#98a2b3",
    accent: "#53b1fd",
    success: "#6ce9a6",
    valid: "#5eead4",
    initial: "#f9fafb",
    warning: "#fec84b",
    neutral: "#98a2b3",
    danger: "#fca5a5",
    info: "#84caff",
    dangerSurface: "#2a1215",
    dangerBorder: "#7a271a",
  },
}

export type Palette = (typeof palettes)["light"]
export const paletteFor = (theme: "light" | "dark"): Palette => palettes[theme]

const stateLabels: Record<AtomNodeSnapshot["state"], string> = {
  valid: "Valid",
  stale: "Stale",
  uninitialized: "Uninitialized",
  removed: "Removed",
}

/** Display label for a node state, using one capitalization everywhere. */
export const stateLabel = (state: AtomNodeSnapshot["state"]): string =>
  stateLabels[state]

/** Display label for a node-state filter. */
export const nodeFilterLabel = (filter: NodeFilter): string =>
  filter === "all" ? "All" : stateLabel(filter)

/** Display label for an async-state filter. */
export const asyncFilterLabel = (filter: AsyncFilter): string =>
  filter === "all" ? "All" : filter === "waiting" ? "Waiting" : filter

/** Display label for an `AsyncResult` tag, including its waiting flag. */
export const asyncStatusLabel = (result: {
  readonly tag: AtomAsyncResultSnapshot["tag"]
  readonly waiting: boolean
}): string => (result.waiting ? `${result.tag} · Waiting` : result.tag)

export const stateColor = (
  state: AtomNodeSnapshot["state"],
  palette: Palette,
): string => {
  switch (state) {
    case "valid":
      return palette.valid
    case "stale":
      return palette.warning
    case "uninitialized":
      return palette.neutral
    case "removed":
      return palette.neutral
  }
}

export const asyncResultColor = (
  tag: AtomAsyncResultSnapshot["tag"],
  palette: Palette,
): string => {
  switch (tag) {
    case "Success":
      return palette.success
    case "Failure":
      return palette.danger
    case "Initial":
      return palette.initial
  }
}

export const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
