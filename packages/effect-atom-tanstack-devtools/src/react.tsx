"use client"

import type { TanStackDevtoolsReactPlugin } from "@tanstack/react-devtools"
import * as Devtools from "./devtools"
import type { AtomDevtoolsPluginOptions } from "./devtools"

export type {
  AtomAsyncResultSnapshot,
  AtomNodeSnapshot,
  AtomNodeState,
  AtomRegistrySnapshot,
  AtomValueEntry,
  AtomValueNode,
  AtomValueSnapshot,
} from "./index"
export type {
  AtomDevtoolsOptions,
  AtomDevtoolsPanelProps,
  AtomDevtoolsPluginOptions,
  AtomDevtoolsProps,
} from "./devtools"

/**
 * Plugin returned outside development.
 *
 * The shell still receives a plugin with a stable id and name so its plugin
 * list does not change between environments, but the pane renders nothing.
 */
const createNoopPlugin = (
  options: AtomDevtoolsPluginOptions,
): TanStackDevtoolsReactPlugin => ({
  id: options.id ?? "effect-atom",
  name: options.name ?? "Effect Atom",
  ...(options.defaultOpen !== undefined && {
    defaultOpen: options.defaultOpen,
  }),
  render: () => <></>,
})

const noop = () => null

/**
 * Effect Atom pane for a unified TanStack Devtools shell.
 *
 * A no-op outside development, matching `@tanstack/react-query-devtools` and
 * `@tanstack/react-router-devtools`.
 */
export const AtomDevtoolsPanel: typeof Devtools.AtomDevtoolsPanel =
  process.env.NODE_ENV !== "development" ? noop : Devtools.AtomDevtoolsPanel

/**
 * Builds a TanStack Devtools plugin for an Effect Atom registry.
 *
 * A no-op outside development; the returned plugin renders nothing but keeps
 * its id and name.
 */
export const createAtomDevtoolsPlugin: typeof Devtools.createAtomDevtoolsPlugin =
  process.env.NODE_ENV !== "development"
    ? createNoopPlugin
    : Devtools.createAtomDevtoolsPlugin

/**
 * Mounts a dedicated TanStack Devtools shell with only the Effect Atom pane.
 *
 * A no-op outside development. Prefer adding `createAtomDevtoolsPlugin` to an
 * existing unified shell.
 */
export const AtomDevtools: typeof Devtools.AtomDevtools =
  process.env.NODE_ENV !== "development" ? noop : Devtools.AtomDevtools
