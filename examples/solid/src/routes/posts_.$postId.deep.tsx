import { useAtomValue } from "@effect/atom-solid"
import { Link, createFileRoute } from "@tanstack/solid-router"
import { awaitAtomSettled } from "effect-atom-tanstack-solid-router"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { postAtom } from "../utils/posts"
import { PostErrorComponent } from "./posts.$postId"

export const Route = createFileRoute("/posts_/$postId/deep")({
  loader: async ({ params: { postId }, context }) => {
    const data = await awaitAtomSettled(context.registry, postAtom(postId))

    return {
      title: AsyncResult.getOrThrow(data).title,
    }
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: loaderData.title }] : undefined,
  }),
  errorComponent: PostErrorComponent,
  component: PostDeepComponent,
})

function PostDeepComponent() {
  const params = Route.useParams()
  const postResult = useAtomValue(() => postAtom(params().postId))
  const post = () => AsyncResult.getOrThrow(postResult())

  return (
    <div class="p-2 space-y-2">
      <Link to="/posts" class="block py-1 text-blue-800 hover:text-blue-600">
        ← All Posts
      </Link>
      <h4 class="text-xl font-bold underline">{post().title}</h4>
      <div class="text-sm">{post().body}</div>
    </div>
  )
}
