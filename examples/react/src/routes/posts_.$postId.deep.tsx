import { useAtomSuspense } from "@effect/atom-react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { awaitAtomSettled } from "effect-atom-tanstack-react-router"
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
  const { postId } = Route.useParams()
  const post = useAtomSuspense(postAtom(postId)).value

  return (
    <div className="p-2 space-y-2">
      <Link
        to="/posts"
        className="block py-1 text-blue-800 hover:text-blue-600"
      >
        ← All Posts
      </Link>
      <h4 className="text-xl font-bold underline">{post.title}</h4>
      <div className="text-sm">{post.body}</div>
    </div>
  )
}
