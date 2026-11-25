import { createFileRoute } from "@tanstack/solid-router"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as HttpRouter from "effect/http/HttpRouter"
import * as Layer from "effect/Layer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import * as Schema from "effect/Schema"
import {
  PostNotFound,
  PostSchema,
  PostsError,
  PostsRpcs,
} from "../../utils/posts"

const handlers = PostsRpcs.toLayer({
  ListPosts: () =>
    HttpClient.get("https://jsonplaceholder.typicode.com/posts").pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(Schema.Array(PostSchema)),
      ),
      Effect.map((posts) => posts.slice(0, 10)),
      Effect.mapError((error) => new PostsError({ message: String(error) })),
    ),
  GetPost: ({ id }) =>
    HttpClient.get(
      `https://jsonplaceholder.typicode.com/posts/${encodeURIComponent(id)}`,
    ).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(PostSchema)),
      Effect.mapError((error) =>
        HttpClientError.isHttpClientError(error) &&
        error.response?.status === 404
          ? new PostNotFound({ id })
          : new PostsError({ message: String(error) }),
      ),
    ),
})

const { handler } = HttpRouter.toWebHandler(
  RpcServer.layerHttp({
    group: PostsRpcs,
    path: "/api/posts-rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(handlers),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(RpcSerialization.layerJson),
  ),
)

export const Route = createFileRoute("/api/posts-rpc")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
    },
  },
})
