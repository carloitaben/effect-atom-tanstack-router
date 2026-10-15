import { useAtomValue } from "@effect/atom-solid"
import { ErrorComponent, createFileRoute } from "@tanstack/solid-router"
import type { ErrorComponentProps } from "@tanstack/solid-router"
import { awaitAtomSettled } from "effect-atom-tanstack-solid-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { NotFound } from "~/components/NotFound"
import { userAtom } from "~/utils/users"

export function UserErrorComponent({ error }: ErrorComponentProps) {
  return <ErrorComponent error={error} />
}

export const Route = createFileRoute("/users/$userId")({
  loader: async ({ context, params: { userId } }) => {
    await awaitAtomSettled(context.registry, userAtom(userId))
  },
  errorComponent: UserErrorComponent,
  component: UserComponent,
  notFoundComponent: () => {
    return <NotFound>User not found</NotFound>
  },
})

function UserComponent() {
  const params = Route.useParams()
  const userResult = useAtomValue(() => userAtom(params().userId))
  const user = () => AsyncResult.getOrThrow(userResult())

  return (
    <div class="space-y-2">
      <h4 class="text-xl font-bold underline">{user().name}</h4>
      <div class="text-sm">{user().email}</div>
    </div>
  )
}
