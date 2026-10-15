import { scheduleTask } from "@effect/atom-react"
import { createRouter } from "@tanstack/react-router"
import { setupRouterAtomIntegration } from "effect-atom-tanstack-react-router"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { DefaultCatchBoundary } from "./components/DefaultCatchBoundary"
import { NotFound } from "./components/NotFound"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const registry = AtomRegistry.make({ scheduleTask })

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

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
