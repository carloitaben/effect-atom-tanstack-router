import { useAtomValue } from "@effect/atom-solid"
import { ErrorComponent, Link, createFileRoute } from "@tanstack/solid-router"
import type { ErrorComponentProps } from "@tanstack/solid-router"
import { awaitAtomSettled } from "effect-atom-tanstack-solid-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { NotFound } from "~/components/NotFound"
import { postAtom } from "../utils/posts"

export function PostErrorComponent(props: ErrorComponentProps) {
  return <ErrorComponent error={props.error} />
}

export const Route = createFileRoute("/posts/$postId")({
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
  notFoundComponent: () => {
    return <NotFound>Post not found</NotFound>
  },
  component: PostComponent,
})

function PostComponent() {
  const params = Route.useParams()
  const postResult = useAtomValue(() => postAtom(params().postId))
  const post = () => AsyncResult.getOrThrow(postResult())

  return (
    <div class="space-y-2">
      <h4 class="text-xl font-bold underline">{post().title}</h4>
      <div class="text-sm">{post().body}</div>
      <Link
        to="/posts/$postId/deep"
        params={{
          postId: String(post().id),
        }}
        activeProps={{ class: "text-black font-bold" }}
        class="inline-block py-1 text-blue-800 hover:text-blue-600"
      >
        Deep View
      </Link>
    </div>
  )
}
