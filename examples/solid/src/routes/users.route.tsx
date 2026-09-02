import { useAtomValue } from "@effect/atom-solid"
import { Link, Outlet, createFileRoute } from "@tanstack/solid-router"
import { awaitAtomSettled } from "effect-atom-tanstack-solid-router"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { usersAtom } from "../utils/users"

export const Route = createFileRoute("/users")({
  loader: async ({ context }) => {
    await awaitAtomSettled(context.registry, usersAtom)
  },
  component: UsersComponent,
})

function UsersComponent() {
  const usersResult = useAtomValue(() => usersAtom)
  const users = () => AsyncResult.getOrThrow(usersResult())

  return (
    <div class="p-2 flex gap-2">
      <ul class="list-disc pl-4">
        {[
          ...users(),
          { id: "i-do-not-exist", name: "Non-existent User", email: "" },
        ].map((user) => {
          return (
            <li class="whitespace-nowrap">
              <Link
                to="/users/$userId"
                params={{
                  userId: String(user.id),
                }}
                class="block py-1 text-blue-800 hover:text-blue-600"
                activeProps={{ class: "text-black font-bold" }}
              >
                <div>{user.name}</div>
              </Link>
            </li>
          )
        })}
      </ul>
      <hr />
      <Outlet />
    </div>
  )
}
