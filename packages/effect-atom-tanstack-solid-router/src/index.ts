import { RegistryContext } from "@effect/atom-solid"
import type { AnyRouter } from "@tanstack/solid-router"
import { setupRouterAtomSsr } from "effect-atom-tanstack-router-core"
import type { AtomRegistry } from "effect/reactivity/AtomRegistry"
import { createComponent } from "solid-js"

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
    const originalWrap = router.options.Wrap
    router.options.Wrap = (props) =>
      createComponent(RegistryContext.Provider, {
        value: registry,
        get children() {
          return originalWrap ? originalWrap(props) : props.children
        },
      })
  }
  setupRouterAtomSsr(router, registry)
}
