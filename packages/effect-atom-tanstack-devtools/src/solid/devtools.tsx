/** @jsxImportSource solid-js */
import type { TanStackDevtoolsSolidPlugin } from "@tanstack/solid-devtools"
import { TanStackDevtools } from "@tanstack/solid-devtools"
import type { AtomRegistry } from "effect/reactivity/AtomRegistry"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import type { ComponentProps, JSX } from "solid-js"
import { isServer } from "solid-js/web"
import { countFilters, matchesFilters, STATUS_FILTERS } from "../filters"
import type { AsyncFilter, NodeFilter } from "../filters"
import { AtomInspector } from "../index"
import type {
  AtomInspectorOptions,
  AtomNodeSnapshot,
  AtomRegistrySnapshot,
} from "../index"
import {
  asyncFilterLabel,
  asyncResultColor,
  asyncStatusLabel,
  formatTime,
  nodeFilterLabel,
  paletteFor,
  stateColor,
  stateLabel,
} from "../presentation"
import type { Palette } from "../presentation"
import { ValueTree } from "./value-tree"

/**
 * Options shared by the panel, the plugin, and the mount component.
 */
export interface AtomDevtoolsOptions extends AtomInspectorOptions {
  /**
   * Auto-refresh interval in milliseconds. Set to `0` to disable polling.
   * Defaults to `1000`.
   */
  readonly pollIntervalMs?: number
}

export interface AtomDevtoolsPanelProps extends AtomDevtoolsOptions {
  readonly registry: AtomRegistry
  readonly theme?: "light" | "dark"
  /**
   * Whether the pane is currently visible in its shell. Defaults to `true`.
   *
   * The TanStack Devtools plugin passes the shell's `devtoolsOpen` flag here.
   * When `false`, automatic polling is suspended and no sample is taken until
   * the pane becomes active again.
   */
  readonly active?: boolean
  /**
   * Document that owns the pane.
   *
   * TanStack Devtools can render a pane in a popout window. Visibility must be
   * read from that document rather than the global one; when omitted, the pane
   * uses the document of its own container element.
   */
  readonly ownerDocument?: Document
}

export interface AtomDevtoolsPluginOptions extends AtomDevtoolsOptions {
  readonly registry: AtomRegistry
  /** Tab title. Defaults to `"Effect Atom"`. */
  readonly name?: string
  /** Stable plugin id. Defaults to `"effect-atom"`. */
  readonly id?: string
  /** Open the pane automatically on first load. */
  readonly defaultOpen?: boolean
}

type AtomDevtoolsShellConfig = NonNullable<
  ComponentProps<typeof TanStackDevtools>["config"]
>

export interface AtomDevtoolsProps extends AtomDevtoolsOptions {
  readonly registry: AtomRegistry
  /**
   * Toggle the devtools without changing your render tree. Defaults to `true`.
   *
   * The public export is a no-op outside development, so this is only needed
   * for runtime toggles in development.
   */
  readonly enabled?: boolean
  /** Shell settings forwarded to `TanStackDevtools`. */
  readonly config?: AtomDevtoolsShellConfig
}

const sans: JSX.CSSProperties = {
  "font-family": "ui-sans-serif, Inter, system-ui, sans-serif",
  "font-size": "12px",
  "line-height": "1.5",
}

const mono: JSX.CSSProperties = {
  "font-family":
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  "font-size": "12px",
}

const badge = (color: string): JSX.CSSProperties => ({
  "font-family": sans["font-family"],
  "font-size": "11px",
  "font-weight": "500",
  "line-height": "16px",
  color,
  background: `${color}1a`,
  border: `1px solid ${color}55`,
  "border-radius": "4px",
  padding: "0 5px",
  "white-space": "nowrap",
  "flex-shrink": 0,
})

const buttonStyle = (palette: Palette): JSX.CSSProperties => ({
  "font-family": sans["font-family"],
  "font-size": "12px",
  "font-weight": "500",
  "line-height": "18px",
  cursor: "pointer",
  color: palette.text,
  background: palette.surfaceStrong,
  border: `1px solid ${palette.border}`,
  "border-radius": "4px",
  padding: "2px 8px",
})

const dangerButtonStyle = (palette: Palette): JSX.CSSProperties => ({
  ...buttonStyle(palette),
  color: palette.danger,
  background: `${palette.danger}14`,
  "border-color": `${palette.danger}66`,
})

const filterButtonStyle = (
  palette: Palette,
  active: boolean,
  color?: string,
): JSX.CSSProperties => {
  const tone = color ?? palette.accent
  return {
    ...buttonStyle(palette),
    ...(color !== undefined && {
      color,
      background: `${color}14`,
      "border-color": `${color}55`,
    }),
    ...(active && {
      background: `${tone}26`,
      "border-color": tone,
      "box-shadow": `inset 0 0 0 1px ${tone}`,
    }),
  }
}

const resetErrorMessage = (error: unknown): string => {
  try {
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message
        : "Unknown error"
    return message.length > 200 ? `${message.slice(0, 200)}…` : message
  } catch {
    return "Unknown error"
  }
}

const resetScope = (snapshot: AtomRegistrySnapshot | null): string => {
  const hidden =
    snapshot === null ? 0 : snapshot.totalNodes - snapshot.nodes.length
  const hiddenNote =
    snapshot?.truncated === true
      ? `, including the ${hidden} not shown in this sample`
      : ""
  return `Every atom node in this registry${hiddenNote} will be removed, not just the selected atom.`
}

/**
 * Effect Atom inspector for TanStack Devtools.
 *
 * Sampling never subscribes, mounts, or forces a read of an atom, so it does
 * not keep lazy atoms alive or compute values the application has not already
 * computed. The only write action is the explicit, confirmed registry reset.
 */
const createPanelState = (options: AtomInspectorOptions) => {
  const [snapshot, setSnapshot] = createSignal<AtomRegistrySnapshot | null>(
    null,
  )
  const [query, setQuery] = createSignal("")
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [paused, setPaused] = createSignal(false)
  const [nodeFilter, setNodeFilter] = createSignal<NodeFilter>("all")
  const [asyncFilter, setAsyncFilter] = createSignal<AsyncFilter>("all")
  return {
    inspector: new AtomInspector(options),
    maxNodes: options.maxNodes,
    maxPreviewLength: options.maxPreviewLength,
    snapshot: [snapshot, setSnapshot] as const,
    query: [query, setQuery] as const,
    selectedId: [selectedId, setSelectedId] as const,
    paused: [paused, setPaused] as const,
    nodeFilter: [nodeFilter, setNodeFilter] as const,
    asyncFilter: [asyncFilter, setAsyncFilter] as const,
  }
}

export function AtomDevtoolsPanel(props: AtomDevtoolsPanelProps): JSX.Element {
  return renderPanel(props, createPanelState(props))
}

function renderPanel(
  props: AtomDevtoolsPanelProps,
  state: ReturnType<typeof createPanelState>,
): JSX.Element {
  const palette = createMemo(() => paletteFor(props.theme ?? "dark"))
  const [container, setContainer] = createSignal<HTMLDivElement>()
  const [snapshot, setSnapshot] = state.snapshot
  const [query, setQuery] = state.query
  const [selectedId, setSelectedId] = state.selectedId
  const [paused, setPaused] = state.paused
  const [nodeFilter, setNodeFilter] = state.nodeFilter
  const [asyncFilter, setAsyncFilter] = state.asyncFilter
  const [confirmingReset, setConfirmingReset] = createSignal(false)
  const [resetError, setResetError] = createSignal<string | null>(null)
  let cancelResetButton: HTMLButtonElement | undefined

  const active = () => props.active ?? true
  const pollIntervalMs = () => props.pollIntervalMs ?? 1000

  const counts = createMemo(() => countFilters(snapshot()?.nodes ?? []))

  const sample = () => {
    if (
      state.maxNodes !== props.maxNodes ||
      state.maxPreviewLength !== props.maxPreviewLength
    ) {
      state.maxNodes = props.maxNodes
      state.maxPreviewLength = props.maxPreviewLength
      state.inspector = new AtomInspector(props)
    }
    setSnapshot(state.inspector.snapshot(props.registry))
  }

  const cancelReset = () => {
    setConfirmingReset(false)
    setResetError(null)
  }

  // Never keep a destructive confirmation armed for a different registry, or
  // while the pane is not visible.
  createEffect(() => {
    void props.registry
    void active()
    cancelReset()
  })

  // Focus the safe choice so a stray Enter cancels instead of resetting.
  createEffect(() => {
    if (confirmingReset()) cancelResetButton?.focus()
  })

  const confirmReset = () => {
    try {
      props.registry.reset()
    } catch (error) {
      setResetError(resetErrorMessage(error))
      return
    }
    setConfirmingReset(false)
    setResetError(null)
    setSelectedId(null)
    sample()
  }

  // Take a fresh sample when the pane first mounts, becomes active, or is
  // resumed. Polling does not run while the shell is closed or the user paused.
  createEffect(() => {
    if (!active() || paused()) return
    sample()
  })

  createEffect(() => {
    if (!active() || paused() || pollIntervalMs() <= 0) return
    const handle = setInterval(() => {
      const view = props.ownerDocument ?? container()?.ownerDocument
      if (view === undefined || view.visibilityState === "visible") sample()
    }, pollIntervalMs())
    onCleanup(() => clearInterval(handle))
  })

  const visibleNodes = createMemo(() => {
    const current = snapshot()
    if (current === null) return []
    const needle = query().trim().toLowerCase()
    return current.nodes.filter(
      (node) =>
        matchesFilters(node, nodeFilter(), asyncFilter()) &&
        (node.name.toLowerCase().includes(needle) ||
          node.id.toLowerCase().includes(needle) ||
          (node.key?.toLowerCase().includes(needle) ?? false)),
    )
  })

  const nodesById = createMemo(
    () => new Map(snapshot()?.nodes.map((node) => [node.id, node]) ?? []),
  )
  const selected = () => {
    const id = selectedId()
    return id === null ? null : (nodesById().get(id) ?? null)
  }

  return (
    <div
      ref={setContainer}
      style={{
        ...sans,
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "min-height": 0,
        background: palette().background,
        color: palette().text,
      }}
    >
      <header
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "flex-wrap": "wrap",
          gap: "12px",
          padding: "10px 12px",
          "border-bottom": `1px solid ${palette().border}`,
          background: palette().surface,
        }}
      >
        <strong style={{ "font-size": "13px", "font-weight": "600" }}>
          Effect Atom
        </strong>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "flex-wrap": "wrap",
            gap: "8px",
          }}
        >
          <span style={{ color: palette().muted, "font-size": "11px" }}>
            {snapshot() !== null &&
              `Sampled ${formatTime(snapshot()!.sampledAt)} · `}
            {!active()
              ? "Polling suspended (devtools closed)"
              : pollIntervalMs() === 0
                ? "Polling off"
                : `Polling ${pollIntervalMs()}ms`}
          </span>
          <button
            type="button"
            disabled={pollIntervalMs() === 0 || !active()}
            onClick={() => setPaused(!paused())}
            style={buttonStyle(palette())}
          >
            {paused() ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            disabled={!active()}
            onClick={sample}
            style={buttonStyle(palette())}
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={!active()}
            aria-haspopup="dialog"
            aria-expanded={confirmingReset()}
            title="Reset every atom node in this registry"
            onClick={() => {
              setResetError(null)
              setConfirmingReset(true)
            }}
            style={dangerButtonStyle(palette())}
          >
            Reset registry
          </button>
        </div>
      </header>

      <Show when={confirmingReset()}>
        <div
          role="alertdialog"
          aria-label="Reset registry confirmation"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            event.stopPropagation()
            cancelReset()
          }}
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "8px",
            padding: "10px 12px",
            "border-bottom": `1px solid ${palette().dangerBorder}`,
            background: palette().dangerSurface,
          }}
        >
          <div>
            <strong style={{ "font-size": "12px", color: palette().danger }}>
              Reset the whole registry?
            </strong>
            <p style={{ margin: "4px 0 0" }}>
              {resetScope(snapshot())} Listeners and subscriptions stop, and
              in-flight work is interrupted. Atoms read again start from
              scratch. This cannot be undone.
            </p>
          </div>
          <Show when={resetError() !== null}>
            <p role="alert" style={{ margin: 0, color: palette().danger }}>
              Could not reset registry: {resetError()}
            </p>
          </Show>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              ref={(element) => {
                cancelResetButton = element
              }}
              type="button"
              onClick={cancelReset}
              style={buttonStyle(palette())}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReset}
              style={{
                ...buttonStyle(palette()),
                color: palette().background,
                background: palette().danger,
                "border-color": palette().danger,
                "font-weight": "600",
              }}
            >
              Confirm reset
            </button>
          </div>
        </div>
      </Show>

      <div
        style={{
          padding: "8px 12px",
          "border-bottom": `1px solid ${palette().border}`,
          display: "flex",
          "align-items": "center",
          "flex-wrap": "wrap",
          gap: "6px",
        }}
        role="group"
        aria-label="Filter atoms by state"
      >
        <For each={STATUS_FILTERS}>
          {(filter) =>
            filter.kind === "node" ? (
              <button
                type="button"
                aria-pressed={
                  nodeFilter() === filter.state && asyncFilter() === "all"
                }
                onClick={() => {
                  setNodeFilter(
                    nodeFilter() === filter.state ? "all" : filter.state,
                  )
                  setAsyncFilter("all")
                }}
                style={filterButtonStyle(
                  palette(),
                  nodeFilter() === filter.state && asyncFilter() === "all",
                  stateColor(filter.state, palette()),
                )}
              >
                {nodeFilterLabel(filter.state)}
                <span
                  style={{
                    "margin-left": "6px",
                    color: palette().muted,
                    "font-variant-numeric": "tabular-nums",
                  }}
                >
                  {counts().node[filter.state]}
                </span>
              </button>
            ) : (
              (() => {
                const state = filter.state
                const color = () =>
                  state === "waiting"
                    ? palette().info
                    : asyncResultColor(state, palette())
                return (
                  <button
                    type="button"
                    aria-pressed={asyncFilter() === state}
                    onClick={() => {
                      setNodeFilter("all")
                      setAsyncFilter(asyncFilter() === state ? "all" : state)
                    }}
                    style={filterButtonStyle(
                      palette(),
                      asyncFilter() === state,
                      color(),
                    )}
                  >
                    {asyncFilterLabel(state)}
                    <span
                      style={{
                        "margin-left": "6px",
                        color: palette().muted,
                        "font-variant-numeric": "tabular-nums",
                      }}
                    >
                      {counts().async[state]}
                    </span>
                  </button>
                )
              })()
            )
          }
        </For>
      </div>

      <div
        style={{
          display: "grid",
          "grid-template-columns": "minmax(220px, 34%) 1fr",
          flex: 1,
          "min-height": 0,
        }}
      >
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            "min-height": 0,
            "border-right": `1px solid ${palette().border}`,
          }}
        >
          <div
            style={{
              padding: "8px",
              "border-bottom": `1px solid ${palette().border}`,
            }}
          >
            <input
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Filter atoms by name or key"
              style={{
                ...sans,
                "box-sizing": "border-box",
                width: "100%",
                color: palette().text,
                background: palette().background,
                border: `1px solid ${palette().border}`,
                "border-radius": "4px",
                padding: "4px 7px",
              }}
            />
          </div>
          <div style={{ overflow: "auto", flex: 1, "min-height": 0 }}>
            <Show
              when={visibleNodes().length > 0}
              fallback={
                <div style={{ padding: "12px", color: palette().muted }}>
                  {snapshot() === null ? "Sampling…" : "No matching atoms."}
                </div>
              }
            >
              <For each={visibleNodes()}>
                {(node) => (
                  <button
                    type="button"
                    title={node.name}
                    onClick={() => setSelectedId(node.id)}
                    style={{
                      ...sans,
                      display: "flex",
                      "align-items": "center",
                      gap: "6px",
                      width: "100%",
                      "min-height": "30px",
                      "text-align": "left",
                      cursor: "pointer",
                      color: palette().text,
                      background:
                        selectedId() === node.id
                          ? palette().surfaceStrong
                          : "transparent",
                      border: "none",
                      "border-bottom": `1px solid ${palette().border}`,
                      padding: "6px 10px",
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        "min-width": 0,
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {node.name}
                    </span>
                    <Show when={node.asyncResult !== null}>
                      <span
                        style={badge(
                          asyncResultColor(node.asyncResult!.tag, palette()),
                        )}
                      >
                        {asyncStatusLabel(node.asyncResult!)}
                      </span>
                    </Show>
                    <span style={badge(stateColor(node.state, palette()))}>
                      {stateLabel(node.state)}
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div style={{ overflow: "auto", "min-height": 0, padding: "12px" }}>
          <Show
            when={selected()}
            fallback={
              <div style={{ color: palette().muted }}>
                Select an atom to inspect its cached value and dependencies.
              </div>
            }
          >
            {(node) => (
              <NodeDetails
                node={node()}
                nodesById={nodesById()}
                palette={palette()}
                onSelect={setSelectedId}
              />
            )}
          </Show>
        </div>
      </div>

      <Show when={snapshot()?.truncated}>
        <div
          style={{
            padding: "5px 12px",
            color: palette().muted,
            "border-top": `1px solid ${palette().border}`,
          }}
        >
          Showing {snapshot()!.nodes.length} of {snapshot()!.totalNodes} atoms
          (maxNodes limit).
        </div>
      </Show>
    </div>
  )
}

function NodeDetails(props: {
  readonly node: AtomNodeSnapshot
  readonly nodesById: ReadonlyMap<string, AtomNodeSnapshot>
  readonly palette: Palette
  readonly onSelect: (id: string) => void
}) {
  const committedValue = () =>
    props.node.value.status === "uninitialized" ? null : props.node.value.value
  const successValue = () =>
    props.node.asyncResult?.tag === "Success"
      ? props.node.asyncResult.value
      : null

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "14px" }}>
      <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
        <h3 style={{ "font-size": "14px", "font-weight": "600", margin: 0 }}>
          {props.node.name}
        </h3>
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
          <span style={badge(stateColor(props.node.state, props.palette))}>
            {stateLabel(props.node.state)}
          </span>
          <Show when={props.node.asyncResult !== null}>
            <span
              style={badge(
                asyncResultColor(props.node.asyncResult!.tag, props.palette),
              )}
            >
              AsyncResult: {asyncStatusLabel(props.node.asyncResult!)}
            </span>
          </Show>
          <Show when={props.node.key !== null}>
            <span style={badge(props.palette.accent)}>
              key: {props.node.key}
            </span>
          </Show>
        </div>
        <code style={{ ...mono, color: props.palette.muted }}>
          {props.node.id}
        </code>
      </div>

      <Section title="Value" palette={props.palette}>
        <Show
          when={committedValue()}
          fallback={
            <p style={{ color: props.palette.muted, margin: 0 }}>
              Not initialized. The value was not read, so a lazy atom stays
              lazy.
            </p>
          }
        >
          {(value) => (
            <>
              <p style={{ color: props.palette.muted, margin: "0 0 6px" }}>
                {props.node.value.status === "stale"
                  ? "Last committed value (atom is stale; not rebuilt by the panel)."
                  : "Current committed value."}
              </p>
              <div style={preStyle(props.palette)}>
                <ValueTree value={value()} />
              </div>
            </>
          )}
        </Show>
      </Section>

      <Show when={props.node.asyncResult !== null}>
        <Section title="AsyncResult" palette={props.palette}>
          <pre style={preStyle(props.palette)}>
            {props.node.asyncResult!.preview}
          </pre>
          <Show when={successValue()}>
            {(value) => (
              <div style={preStyle(props.palette)}>
                <strong>Success data: </strong>
                <ValueTree value={value()} />
              </div>
            )}
          </Show>
          <Show when={props.node.asyncResult!.tag === "Failure"}>
            <p
              style={{
                color: props.palette.muted,
                margin: "6px 0 0",
              }}
            >
              Previous success available:{" "}
              {props.node.asyncResult!.tag === "Failure" &&
              props.node.asyncResult!.hasPreviousSuccess
                ? "yes"
                : "no"}
            </p>
          </Show>
        </Section>
      </Show>

      <Section title="Registry metadata" palette={props.palette}>
        <dl style={definitionListStyle}>
          <dt style={{ color: props.palette.muted }}>state</dt>
          <dd style={{ margin: 0 }}>{stateLabel(props.node.state)}</dd>
          <dt style={{ color: props.palette.muted }}>listeners</dt>
          <dd style={{ margin: 0 }}>{props.node.listeners}</dd>
          <dt style={{ color: props.palette.muted }}>keepAlive</dt>
          <dd style={{ margin: 0 }}>
            {props.node.keepAlive ? "true" : "false"}
          </dd>
          <dt style={{ color: props.palette.muted }}>lazy</dt>
          <dd style={{ margin: 0 }}>{props.node.lazy ? "true" : "false"}</dd>
          <dt style={{ color: props.palette.muted }}>idleTTL</dt>
          <dd style={{ margin: 0 }}>
            {props.node.idleTTL === null ? "—" : `${props.node.idleTTL}ms`}
          </dd>
          <dt style={{ color: props.palette.muted }}>canBeRemoved</dt>
          <dd style={{ margin: 0 }}>
            {props.node.canBeRemoved ? "true" : "false"}
          </dd>
        </dl>
      </Section>

      <Section
        title={`Depends on (${props.node.parents.length})`}
        palette={props.palette}
      >
        <DependencyList
          ids={props.node.parents}
          nodesById={props.nodesById}
          palette={props.palette}
          onSelect={props.onSelect}
          empty="No parent atoms."
        />
      </Section>

      <Section
        title={`Used by (${props.node.children.length})`}
        palette={props.palette}
      >
        <DependencyList
          ids={props.node.children}
          nodesById={props.nodesById}
          palette={props.palette}
          onSelect={props.onSelect}
          empty="No child atoms."
        />
      </Section>
    </div>
  )
}

function Section(props: {
  readonly title: string
  readonly palette: Palette
  readonly children: JSX.Element
}) {
  return (
    <section
      style={{
        border: `1px solid ${props.palette.border}`,
        "border-radius": "6px",
        padding: "10px",
        background: props.palette.surface,
      }}
    >
      <h4
        style={{
          "font-size": "11px",
          "font-weight": "600",
          margin: "0 0 8px",
          color: props.palette.muted,
          "text-transform": "uppercase",
          "letter-spacing": "0.04em",
        }}
      >
        {props.title}
      </h4>
      {props.children}
    </section>
  )
}

function DependencyList(props: {
  readonly ids: ReadonlyArray<string>
  readonly nodesById: ReadonlyMap<string, AtomNodeSnapshot>
  readonly palette: Palette
  readonly onSelect: (id: string) => void
  readonly empty: string
}) {
  return (
    <Show
      when={props.ids.length > 0}
      fallback={
        <p style={{ color: props.palette.muted, margin: 0 }}>{props.empty}</p>
      }
    >
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
        <For each={props.ids}>
          {(id) => {
            const known = () => props.nodesById.get(id)
            return (
              <button
                type="button"
                disabled={known() === undefined}
                onClick={() => props.onSelect(id)}
                title={id}
                style={{
                  ...mono,
                  cursor: known() === undefined ? "default" : "pointer",
                  color:
                    known() === undefined
                      ? props.palette.muted
                      : props.palette.accent,
                  background: props.palette.surfaceStrong,
                  border: `1px solid ${props.palette.border}`,
                  "border-radius": "4px",
                  padding: "3px 6px",
                }}
              >
                {known()?.name ?? id}
              </button>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

const preStyle = (palette: Palette): JSX.CSSProperties => ({
  ...mono,
  "line-height": "1.5",
  margin: 0,
  padding: "8px",
  "max-height": "220px",
  overflow: "auto",
  "white-space": "pre-wrap",
  "word-break": "break-word",
  color: palette.text,
  background: palette.background,
  border: `1px solid ${palette.border}`,
  "border-radius": "4px",
})

const definitionListStyle: JSX.CSSProperties = {
  ...mono,
  display: "grid",
  "grid-template-columns": "max-content 1fr",
  gap: "4px 12px",
  margin: 0,
}

/**
 * Builds a TanStack Devtools plugin for an Effect Atom registry.
 *
 * Use this when the application already renders a unified
 * `<TanStackDevtools>` shell: add the plugin to that shell's `plugins` array
 * instead of mounting a second shell with `AtomDevtools`.
 *
 * Inspection never subscribes to the registry. The only write is the pane's
 * explicit, confirmed Reset registry action. The public factory is a no-op
 * outside development: the plugin is still returned so the shell's plugin list
 * stays stable, but it renders nothing.
 *
 * ```tsx
 * const plugin = createAtomDevtoolsPlugin({ registry })
 *
 * <TanStackDevtools plugins={[routerPlugin, plugin]} />
 * ```
 */
export const createAtomDevtoolsPlugin = (
  options: AtomDevtoolsPluginOptions,
): TanStackDevtoolsSolidPlugin => {
  const state = createPanelState(options)
  return {
    id: options.id ?? "effect-atom",
    name: options.name ?? "Effect Atom",
    ...(options.defaultOpen !== undefined && {
      defaultOpen: options.defaultOpen,
    }),
    render: (el, props) =>
      renderPanel(
        {
          registry: options.registry,
          theme: props.theme,
          active: props.devtoolsOpen,
          ownerDocument: el.ownerDocument,
          ...(options.pollIntervalMs !== undefined && {
            pollIntervalMs: options.pollIntervalMs,
          }),
          ...(options.maxNodes !== undefined && { maxNodes: options.maxNodes }),
          ...(options.maxPreviewLength !== undefined && {
            maxPreviewLength: options.maxPreviewLength,
          }),
        },
        state,
      ),
  }
}

/**
 * Mounts the unified TanStack Devtools shell with only the Effect Atom pane.
 *
 * This is an optional entrypoint for applications that do not already render a
 * shell. Applications with a shell should add `createAtomDevtoolsPlugin` to
 * that shell instead of mounting a second one.
 *
 * It renders nothing on the server and nothing until hydration completes, so
 * it is safe to place in a root component. The public export is a no-op
 * outside development, matching TanStack's floating devtools components, so
 * no call-site guard is required.
 *
 * ```tsx
 * <AtomDevtools registry={registry} />
 * ```
 */
export function AtomDevtools(props: AtomDevtoolsProps): JSX.Element {
  const [mounted, setMounted] = createSignal(false)
  onMount(() => setMounted(true))

  const plugin = createMemo(() =>
    createAtomDevtoolsPlugin({
      registry: props.registry,
      ...(props.pollIntervalMs !== undefined && {
        pollIntervalMs: props.pollIntervalMs,
      }),
      ...(props.maxNodes !== undefined && { maxNodes: props.maxNodes }),
      ...(props.maxPreviewLength !== undefined && {
        maxPreviewLength: props.maxPreviewLength,
      }),
    }),
  )

  return (
    <Show when={!isServer && (props.enabled ?? true) && mounted()}>
      <TanStackDevtools
        plugins={[plugin()]}
        {...(props.config !== undefined && { config: props.config })}
      />
    </Show>
  )
}
