import type {
  TanStackDevtoolsReactInit,
  TanStackDevtoolsReactPlugin,
} from "@tanstack/react-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import type { AtomRegistry } from "effect/reactivity/AtomRegistry"
import type { CSSProperties, ReactElement, ReactNode } from "react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { countFilters, matchesFilters, STATUS_FILTERS } from "./filters"
import type { AsyncFilter, NodeFilter } from "./filters"
import { AtomInspector } from "./index"
import type {
  AtomInspectorOptions,
  AtomNodeSnapshot,
  AtomRegistrySnapshot,
} from "./index"
import {
  asyncFilterLabel,
  asyncResultColor,
  asyncStatusLabel,
  formatTime,
  nodeFilterLabel,
  paletteFor,
  stateColor,
  stateLabel,
} from "./presentation"
import type { Palette } from "./presentation"
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

type AtomDevtoolsShellConfig = NonNullable<TanStackDevtoolsReactInit["config"]>

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

const subscribeToNothing = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

/**
 * `true` after hydration, `false` during server rendering.
 *
 * Rendering the devtools shell on the server is pointless and would make the
 * first client render disagree with the server markup.
 */
const useIsClient = (): boolean =>
  useSyncExternalStore(subscribeToNothing, getClientSnapshot, getServerSnapshot)

const sans: CSSProperties = {
  fontFamily: "ui-sans-serif, Inter, system-ui, sans-serif",
  fontSize: 12,
  lineHeight: 1.5,
}

const mono: CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: 12,
}

const badge = (color: string): CSSProperties => ({
  fontFamily: sans.fontFamily,
  fontSize: 11,
  fontWeight: 500,
  lineHeight: "16px",
  color,
  background: `${color}1a`,
  border: `1px solid ${color}55`,
  borderRadius: 4,
  padding: "0 5px",
  whiteSpace: "nowrap",
  flexShrink: 0,
})

const buttonStyle = (palette: Palette): CSSProperties => ({
  fontFamily: sans.fontFamily,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
  cursor: "pointer",
  color: palette.text,
  background: palette.surfaceStrong,
  border: `1px solid ${palette.border}`,
  borderRadius: 4,
  padding: "2px 8px",
})

const dangerButtonStyle = (palette: Palette): CSSProperties => ({
  ...buttonStyle(palette),
  color: palette.danger,
  background: `${palette.danger}14`,
  borderColor: `${palette.danger}66`,
})

const filterButtonStyle = (
  palette: Palette,
  active: boolean,
  color?: string,
): CSSProperties => {
  const tone = color ?? palette.accent
  return {
    ...buttonStyle(palette),
    ...(color !== undefined && {
      color,
      background: `${color}14`,
      borderColor: `${color}55`,
    }),
    ...(active && {
      background: `${tone}26`,
      borderColor: tone,
      boxShadow: `inset 0 0 0 1px ${tone}`,
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
export function AtomDevtoolsPanel({
  registry,
  pollIntervalMs = 1000,
  maxNodes,
  maxPreviewLength,
  theme = "dark",
  active = true,
  ownerDocument,
}: AtomDevtoolsPanelProps): ReactElement | null {
  const palette = paletteFor(theme)
  const container = useRef<HTMLDivElement>(null)
  const inspector = useMemo(
    () =>
      new AtomInspector({
        ...(maxNodes !== undefined && { maxNodes }),
        ...(maxPreviewLength !== undefined && { maxPreviewLength }),
      }),
    [maxNodes, maxPreviewLength],
  )
  const [snapshot, setSnapshot] = useState<AtomRegistrySnapshot | null>(null)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all")
  const [asyncFilter, setAsyncFilter] = useState<AsyncFilter>("all")
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const cancelResetButton = useRef<HTMLButtonElement>(null)

  const counts = useMemo(() => countFilters(snapshot?.nodes ?? []), [snapshot])

  const sample = useCallback(() => {
    setSnapshot(inspector.snapshot(registry))
  }, [inspector, registry])

  const cancelReset = useCallback(() => {
    setConfirmingReset(false)
    setResetError(null)
  }, [])

  // Never keep a destructive confirmation armed for a different registry, or
  // while the pane is not visible.
  useEffect(() => {
    cancelReset()
  }, [active, registry, cancelReset])

  // Focus the safe choice so a stray Enter cancels instead of resetting.
  useEffect(() => {
    if (confirmingReset) cancelResetButton.current?.focus()
  }, [confirmingReset])

  const confirmReset = useCallback(() => {
    try {
      registry.reset()
    } catch (error) {
      setResetError(resetErrorMessage(error))
      return
    }
    setConfirmingReset(false)
    setResetError(null)
    setSelectedId(null)
    sample()
  }, [registry, sample])

  // Take a fresh sample when the pane first mounts, becomes active, or is
  // resumed. Polling does not run while the shell is closed or the user paused.
  useEffect(() => {
    if (!active || paused) return
    sample()
  }, [active, paused, sample])

  useEffect(() => {
    if (!active || paused || pollIntervalMs <= 0) return
    const handle = setInterval(() => {
      const view = ownerDocument ?? container.current?.ownerDocument
      if (view === undefined || view.visibilityState === "visible") sample()
    }, pollIntervalMs)
    return () => clearInterval(handle)
  }, [active, paused, pollIntervalMs, sample, ownerDocument])

  const visibleNodes = useMemo(() => {
    if (!snapshot) return []
    const needle = query.trim().toLowerCase()
    return snapshot.nodes.filter(
      (node) =>
        matchesFilters(node, nodeFilter, asyncFilter) &&
        (node.name.toLowerCase().includes(needle) ||
          node.id.toLowerCase().includes(needle) ||
          (node.key?.toLowerCase().includes(needle) ?? false)),
    )
  }, [snapshot, query, nodeFilter, asyncFilter])

  const nodesById = useMemo(
    () => new Map(snapshot?.nodes.map((node) => [node.id, node]) ?? []),
    [snapshot],
  )
  const selected =
    selectedId === null ? null : (nodesById.get(selectedId) ?? null)

  return (
    <div
      ref={container}
      style={{
        ...sans,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: palette.background,
        color: palette.text,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "10px 12px",
          borderBottom: `1px solid ${palette.border}`,
          background: palette.surface,
        }}
      >
        <strong style={{ fontSize: 13, fontWeight: 600 }}>Effect Atom</strong>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span style={{ color: palette.muted, fontSize: 11 }}>
            {snapshot !== null &&
              `Sampled ${formatTime(snapshot.sampledAt)} · `}
            {!active
              ? "Polling suspended (devtools closed)"
              : pollIntervalMs === 0
                ? "Polling off"
                : `Polling ${pollIntervalMs}ms`}
          </span>
          <button
            type="button"
            disabled={pollIntervalMs === 0 || !active}
            onClick={() => setPaused(!paused)}
            style={buttonStyle(palette)}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            disabled={!active}
            onClick={sample}
            style={buttonStyle(palette)}
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={!active}
            aria-haspopup="dialog"
            aria-expanded={confirmingReset}
            title="Reset every atom node in this registry"
            onClick={() => {
              setResetError(null)
              setConfirmingReset(true)
            }}
            style={dangerButtonStyle(palette)}
          >
            Reset registry
          </button>
        </div>
      </header>

      {confirmingReset ? (
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
            flexDirection: "column",
            gap: 8,
            padding: "10px 12px",
            borderBottom: `1px solid ${palette.dangerBorder}`,
            background: palette.dangerSurface,
          }}
        >
          <div>
            <strong style={{ fontSize: 12, color: palette.danger }}>
              Reset the whole registry?
            </strong>
            <p style={{ margin: "4px 0 0" }}>
              {resetScope(snapshot)} Listeners and subscriptions stop, and
              in-flight work is interrupted. Atoms read again start from
              scratch. This cannot be undone.
            </p>
          </div>
          {resetError !== null && (
            <p role="alert" style={{ margin: 0, color: palette.danger }}>
              Could not reset registry: {resetError}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              ref={cancelResetButton}
              type="button"
              onClick={cancelReset}
              style={buttonStyle(palette)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReset}
              style={{
                ...buttonStyle(palette),
                color: palette.background,
                background: palette.danger,
                borderColor: palette.danger,
                fontWeight: 600,
              }}
            >
              Confirm reset
            </button>
          </div>
        </div>
      ) : null}

      <div
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
        }}
        role="group"
        aria-label="Filter atoms by state"
      >
        {STATUS_FILTERS.map((filter) =>
          filter.kind === "node" ? (
            <button
              key={filter.state}
              type="button"
              aria-pressed={
                nodeFilter === filter.state && asyncFilter === "all"
              }
              onClick={() => {
                setNodeFilter(
                  nodeFilter === filter.state ? "all" : filter.state,
                )
                setAsyncFilter("all")
              }}
              style={filterButtonStyle(
                palette,
                nodeFilter === filter.state && asyncFilter === "all",
                stateColor(filter.state, palette),
              )}
            >
              {nodeFilterLabel(filter.state)}
              <span
                style={{
                  marginLeft: 6,
                  color: palette.muted,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {counts.node[filter.state]}
              </span>
            </button>
          ) : (
            (() => {
              const state = filter.state
              const color =
                state === "waiting"
                  ? palette.info
                  : asyncResultColor(state, palette)
              return (
                <button
                  key={state}
                  type="button"
                  aria-pressed={asyncFilter === state}
                  onClick={() => {
                    setNodeFilter("all")
                    setAsyncFilter(asyncFilter === state ? "all" : state)
                  }}
                  style={filterButtonStyle(
                    palette,
                    asyncFilter === state,
                    color,
                  )}
                >
                  {asyncFilterLabel(state)}
                  <span
                    style={{
                      marginLeft: 6,
                      color: palette.muted,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {counts.async[state]}
                  </span>
                </button>
              )
            })()
          ),
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 34%) 1fr",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRight: `1px solid ${palette.border}`,
          }}
        >
          <div
            style={{ padding: 8, borderBottom: `1px solid ${palette.border}` }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Filter atoms by name or key"
              style={{
                ...sans,
                boxSizing: "border-box",
                width: "100%",
                color: palette.text,
                background: palette.background,
                border: `1px solid ${palette.border}`,
                borderRadius: 4,
                padding: "4px 7px",
              }}
            />
          </div>
          <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
            {visibleNodes.length === 0 ? (
              <div style={{ padding: 12, color: palette.muted }}>
                {snapshot === null ? "Sampling…" : "No matching atoms."}
              </div>
            ) : (
              visibleNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  title={node.name}
                  onClick={() => setSelectedId(node.id)}
                  style={{
                    ...sans,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    minHeight: 30,
                    textAlign: "left",
                    cursor: "pointer",
                    color: palette.text,
                    background:
                      selectedId === node.id
                        ? palette.surfaceStrong
                        : "transparent",
                    border: "none",
                    borderBottom: `1px solid ${palette.border}`,
                    padding: "6px 10px",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {node.name}
                  </span>
                  {node.asyncResult !== null && (
                    <span
                      style={badge(
                        asyncResultColor(node.asyncResult.tag, palette),
                      )}
                    >
                      {asyncStatusLabel(node.asyncResult)}
                    </span>
                  )}
                  <span style={badge(stateColor(node.state, palette))}>
                    {stateLabel(node.state)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div style={{ overflow: "auto", minHeight: 0, padding: 12 }}>
          {selected === null ? (
            <div style={{ color: palette.muted }}>
              Select an atom to inspect its cached value and dependencies.
            </div>
          ) : (
            <NodeDetails
              node={selected}
              nodesById={nodesById}
              palette={palette}
              onSelect={setSelectedId}
            />
          )}
        </div>
      </div>

      {snapshot?.truncated ? (
        <div
          style={{
            padding: "5px 12px",
            color: palette.muted,
            borderTop: `1px solid ${palette.border}`,
          }}
        >
          Showing {snapshot.nodes.length} of {snapshot.totalNodes} atoms
          (maxNodes limit).
        </div>
      ) : null}
    </div>
  )
}

function NodeDetails({
  node,
  nodesById,
  palette,
  onSelect,
}: {
  readonly node: AtomNodeSnapshot
  readonly nodesById: ReadonlyMap<string, AtomNodeSnapshot>
  readonly palette: Palette
  readonly onSelect: (id: string) => void
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          {node.name}
        </h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <span style={badge(stateColor(node.state, palette))}>
            {stateLabel(node.state)}
          </span>
          {node.asyncResult !== null && (
            <span
              style={badge(asyncResultColor(node.asyncResult.tag, palette))}
            >
              AsyncResult: {asyncStatusLabel(node.asyncResult)}
            </span>
          )}
          {node.key !== null && (
            <span style={badge(palette.accent)}>key: {node.key}</span>
          )}
        </div>
        <code style={{ ...mono, color: palette.muted }}>{node.id}</code>
      </div>

      <Section title="Value" palette={palette}>
        {node.value.status === "uninitialized" ? (
          <p style={{ color: palette.muted, margin: 0 }}>
            Not initialized. The value was not read, so a lazy atom stays lazy.
          </p>
        ) : (
          <>
            <p style={{ color: palette.muted, margin: "0 0 6px" }}>
              {node.value.status === "stale"
                ? "Last committed value (atom is stale; not rebuilt by the panel)."
                : "Current committed value."}
            </p>
            <div style={preStyle(palette)}>
              <ValueTree value={node.value.value} />
            </div>
          </>
        )}
      </Section>

      {node.asyncResult !== null && (
        <Section title="AsyncResult" palette={palette}>
          <pre style={preStyle(palette)}>{node.asyncResult.preview}</pre>
          {node.asyncResult.tag === "Success" && (
            <div style={preStyle(palette)}>
              <strong>Success data: </strong>
              <ValueTree value={node.asyncResult.value} />
            </div>
          )}
          {node.asyncResult.tag === "Failure" && (
            <p style={{ color: palette.muted, margin: "6px 0 0" }}>
              Previous success available:{" "}
              {node.asyncResult.hasPreviousSuccess ? "yes" : "no"}
            </p>
          )}
        </Section>
      )}

      <Section title="Registry metadata" palette={palette}>
        <dl style={definitionListStyle}>
          <dt style={{ color: palette.muted }}>state</dt>
          <dd style={{ margin: 0 }}>{stateLabel(node.state)}</dd>
          <dt style={{ color: palette.muted }}>listeners</dt>
          <dd style={{ margin: 0 }}>{node.listeners}</dd>
          <dt style={{ color: palette.muted }}>keepAlive</dt>
          <dd style={{ margin: 0 }}>{node.keepAlive ? "true" : "false"}</dd>
          <dt style={{ color: palette.muted }}>lazy</dt>
          <dd style={{ margin: 0 }}>{node.lazy ? "true" : "false"}</dd>
          <dt style={{ color: palette.muted }}>idleTTL</dt>
          <dd style={{ margin: 0 }}>
            {node.idleTTL === null ? "—" : `${node.idleTTL}ms`}
          </dd>
          <dt style={{ color: palette.muted }}>canBeRemoved</dt>
          <dd style={{ margin: 0 }}>{node.canBeRemoved ? "true" : "false"}</dd>
        </dl>
      </Section>

      <Section title={`Depends on (${node.parents.length})`} palette={palette}>
        <DependencyList
          ids={node.parents}
          nodesById={nodesById}
          palette={palette}
          onSelect={onSelect}
          empty="No parent atoms."
        />
      </Section>

      <Section title={`Used by (${node.children.length})`} palette={palette}>
        <DependencyList
          ids={node.children}
          nodesById={nodesById}
          palette={palette}
          onSelect={onSelect}
          empty="No child atoms."
        />
      </Section>
    </div>
  )
}

function Section({
  title,
  palette,
  children,
}: {
  readonly title: string
  readonly palette: Palette
  readonly children: ReactNode
}) {
  return (
    <section
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 6,
        padding: 10,
        background: palette.surface,
      }}
    >
      <h4
        style={{
          fontSize: 11,
          fontWeight: 600,
          margin: "0 0 8px",
          color: palette.muted,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {title}
      </h4>
      {children}
    </section>
  )
}

function DependencyList({
  ids,
  nodesById,
  palette,
  onSelect,
  empty,
}: {
  readonly ids: ReadonlyArray<string>
  readonly nodesById: ReadonlyMap<string, AtomNodeSnapshot>
  readonly palette: Palette
  readonly onSelect: (id: string) => void
  readonly empty: string
}) {
  if (ids.length === 0) {
    return <p style={{ color: palette.muted, margin: 0 }}>{empty}</p>
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {ids.map((id) => {
        const known = nodesById.get(id)
        return (
          <button
            key={id}
            type="button"
            disabled={known === undefined}
            onClick={() => onSelect(id)}
            title={id}
            style={{
              ...mono,
              cursor: known === undefined ? "default" : "pointer",
              color: known === undefined ? palette.muted : palette.accent,
              background: palette.surfaceStrong,
              border: `1px solid ${palette.border}`,
              borderRadius: 4,
              padding: "3px 6px",
            }}
          >
            {known?.name ?? id}
          </button>
        )
      })}
    </div>
  )
}

const preStyle = (palette: Palette): CSSProperties => ({
  ...mono,
  lineHeight: 1.5,
  margin: 0,
  padding: 8,
  maxHeight: 220,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: palette.text,
  background: palette.background,
  border: `1px solid ${palette.border}`,
  borderRadius: 4,
})

const definitionListStyle: CSSProperties = {
  ...mono,
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
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
): TanStackDevtoolsReactPlugin => ({
  id: options.id ?? "effect-atom",
  name: options.name ?? "Effect Atom",
  ...(options.defaultOpen !== undefined && {
    defaultOpen: options.defaultOpen,
  }),
  render: (el, props) => (
    <AtomDevtoolsPanel
      registry={options.registry}
      theme={props.theme}
      active={props.devtoolsOpen}
      {...(el.ownerDocument !== undefined && {
        ownerDocument: el.ownerDocument,
      })}
      {...(options.pollIntervalMs !== undefined && {
        pollIntervalMs: options.pollIntervalMs,
      })}
      {...(options.maxNodes !== undefined && { maxNodes: options.maxNodes })}
      {...(options.maxPreviewLength !== undefined && {
        maxPreviewLength: options.maxPreviewLength,
      })}
    />
  ),
})

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
export function AtomDevtools({
  registry,
  enabled = true,
  config,
  pollIntervalMs,
  maxNodes,
  maxPreviewLength,
}: AtomDevtoolsProps) {
  const isClient = useIsClient()

  const plugin = useMemo(
    () =>
      createAtomDevtoolsPlugin({
        registry,
        ...(pollIntervalMs !== undefined && { pollIntervalMs }),
        ...(maxNodes !== undefined && { maxNodes }),
        ...(maxPreviewLength !== undefined && { maxPreviewLength }),
      }),
    [registry, pollIntervalMs, maxNodes, maxPreviewLength],
  )

  if (!enabled || !isClient) return null

  return (
    <TanStackDevtools
      plugins={[plugin]}
      {...(config !== undefined && { config })}
    />
  )
}
