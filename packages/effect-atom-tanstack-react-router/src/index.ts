import { RegistryContext } from "@effect/atom-react"
import type { AnyRouter } from "@tanstack/react-router"
import { setupRouterAtomSsr } from "effect-atom-tanstack-router-core"
import type { AtomRegistry } from "effect/reactivity/AtomRegistry"
import { createElement, Fragment } from "react"
import type { ComponentType, ReactNode } from "react"

export { awaitAtomSettled } from "effect-atom-tanstack-router-core"
export type { DehydratedRouterAtomState } from "effect-atom-tanstack-router-core"

export type RouterAtomIntegrationOptions<TRouter extends AnyRouter> = {
  readonly router: TRouter
  readonly registry: AtomRegistry
  readonly wrapRegistry?: boolean
}

export function setupRouterAtomIntegration<TRouter extends AnyRouter>(
  opts: RouterAtomIntegrationOptions<TRouter>,
) {
  const { router, registry } = opts
  if (opts.wrapRegistry !== false) {
    const originalWrap = (router.options.Wrap ?? Fragment) as ComponentType<{
      children?: ReactNode
    }>
    router.options.Wrap = ({ children }) =>
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(originalWrap, null, children),
      )
  }
  setupRouterAtomSsr(router, registry)
}
