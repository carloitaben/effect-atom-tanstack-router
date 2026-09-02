import { createRouter } from "@tanstack/solid-router"
import { setupRouterAtomIntegration } from "effect-atom-tanstack-solid-router"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { DefaultCatchBoundary } from "./components/DefaultCatchBoundary"
import { NotFound } from "./components/NotFound"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const registry = AtomRegistry.make()

  const router = createRouter({
    routeTree,
    context: { registry },
    defaultPreload: "intent",
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
  })

  setupRouterAtomIntegration({
    router,
    registry,
  })

  return router
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
