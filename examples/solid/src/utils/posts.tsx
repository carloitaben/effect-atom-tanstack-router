import { createIsomorphicFn } from "@tanstack/solid-start"
import { getRequestUrl } from "@tanstack/solid-start/server"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Layer from "effect/Layer"
import * as AtomRpc from "effect/reactivity/AtomRpc"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Schema from "effect/Schema"

export const PostSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  body: Schema.String,
})

export type PostType = typeof PostSchema.Type

export class PostNotFound extends Schema.TaggedError<PostNotFound>()(
  "PostNotFound",
  { id: Schema.String },
) {}

export class PostsError extends Schema.TaggedError<PostsError>()("PostsError", {
  message: Schema.String,
}) {}

export const PostsRpcs = RpcGroup.make(
  Rpc.make("ListPosts", {
    success: Schema.Array(PostSchema),
    error: PostsError,
  }),
  Rpc.make("GetPost", {
    payload: { id: Schema.String },
    success: PostSchema,
    error: Schema.Union([PostNotFound, PostsError]),
  }),
)

const getOrigin = createIsomorphicFn()
  .server(() => getRequestUrl().origin)
  .client(() => window.location.origin)

export class PostsClient extends AtomRpc.Service<PostsClient>()("PostsClient", {
  group: PostsRpcs,
  protocol: () =>
    RpcClient.layerProtocolHttp({ url: `${getOrigin()}/api/posts-rpc` }).pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer),
    ),
}) {}

export const postsAtom = PostsClient.query("ListPosts", undefined, {
  serializationKey: "all",
  staleTime: "1 minute",
  timeToLive: "5 minutes",
})

export const postAtom = (id: string) =>
  PostsClient.query(
    "GetPost",
    { id },
    {
      serializationKey: id,
      staleTime: "1 minute",
      timeToLive: "5 minutes",
    },
  )
