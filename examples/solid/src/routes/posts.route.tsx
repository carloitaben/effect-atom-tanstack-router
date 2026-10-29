import { useAtomValue } from "@effect/atom-solid"
import { Link, Outlet, createFileRoute } from "@tanstack/solid-router"
import { awaitAtomSettled } from "effect-atom-tanstack-solid-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { For } from "solid-js"
import { postsAtom } from "../utils/posts"

export const Route = createFileRoute("/posts")({
  loader: async ({ context }) => {
    await awaitAtomSettled(context.registry, postsAtom)
  },
  head: () => ({
    meta: [{ title: "Posts" }],
  }),
  component: PostsComponent,
})

function PostsComponent() {
  const postsResult = useAtomValue(() => postsAtom)
  const posts = () => AsyncResult.getOrThrow(postsResult())

  return (
    <div class="p-2 flex gap-2">
      <ul class="list-disc pl-4">
        <For
          each={[
            ...posts(),
            { id: "i-do-not-exist", title: "Non-existent Post" },
          ]}
        >
          {(post) => {
            return (
              <li class="whitespace-nowrap">
                <Link
                  to="/posts/$postId"
                  params={{
                    postId: String(post.id),
                  }}
                  class="block py-1 text-blue-800 hover:text-blue-600"
                  activeProps={{ class: "text-black font-bold" }}
                >
                  <div>{post.title.substring(0, 20)}</div>
                </Link>
              </li>
            )
          }}
        </For>
      </ul>
      <hr />
      <Outlet />
    </div>
  )
}
