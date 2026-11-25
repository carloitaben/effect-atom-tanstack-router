import { useAtomSuspense } from "@effect/atom-react"
import {
  ErrorComponent,
  Link,
  createFileRoute,
  notFound,
} from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { awaitAtomSettled } from "effect-atom-tanstack-react-router"
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { NotFound } from "~/components/NotFound"
import { PostNotFound, postAtom } from "../utils/posts"

export const Route = createFileRoute("/posts/$postId")({
  loader: async ({ params: { postId }, context }) => {
    const data = await awaitAtomSettled(context.registry, postAtom(postId))

    try {
      const post = await Effect.runPromise(AsyncResult.toExit(data))
      return { title: post.title }
    } catch (error) {
      if (error instanceof PostNotFound) throw notFound()
      throw error
    }
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: loaderData.title }] : undefined,
  }),
  errorComponent: PostErrorComponent,
  notFoundComponent: () => {
    return <NotFound>Post not found</NotFound>
  },
  component: PostComponent,
})

export function PostErrorComponent({ error }: ErrorComponentProps) {
  return <ErrorComponent error={error} />
}

function PostComponent() {
  const { postId } = Route.useParams()
  const post = useAtomSuspense(postAtom(postId)).value

  return (
    <div className="space-y-2">
      <h4 className="text-xl font-bold underline">{post.title}</h4>
      <div className="text-sm">{post.body}</div>
      <Link
        to="/posts/$postId/deep"
        params={{
          postId: String(post.id),
        }}
        activeProps={{ className: "text-black font-bold" }}
        className="inline-block py-1 text-blue-800 hover:text-blue-600"
      >
        Deep View
      </Link>
    </div>
  )
}
