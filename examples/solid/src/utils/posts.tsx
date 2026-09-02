import { notFound } from "@tanstack/solid-router"
import { createServerFn } from "@tanstack/solid-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"

const PostSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  body: Schema.String,
})

export type PostType = Schema.Schema.Type<typeof PostSchema>

const getJson = <A,>(url: string, schema: Schema.ConstraintDecoder<A>) =>
  Effect.runPromise(
    HttpClient.get(url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.provide(FetchHttpClient.layer),
    ),
  )

export const fetchPosts = createServerFn({ method: "GET" }).handler(
  async () => {
    console.info("Fetching posts...")
    return (
      await getJson(
        "https://jsonplaceholder.typicode.com/posts",
        Schema.Array(PostSchema),
      )
    ).slice(0, 10)
  },
)

const postResultSchema = AsyncResult.Schema({
  success: PostSchema,
  error: Schema.String,
})

export const postsAtom = Atom.make(
  Effect.tryPromise({
    try: () => fetchPosts(),
    catch: (error) => (error instanceof Error ? error.message : String(error)),
  }),
).pipe(
  Atom.keepAlive,
  Atom.serializable({
    key: "posts",
    schema: AsyncResult.Schema({
      success: Schema.mutable(Schema.Array(PostSchema)),
      error: Schema.String,
    }),
  }),
)

export const fetchPost = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data }) => {
    console.info(`Fetching post with id ${data}...`)
    try {
      return await getJson(
        `https://jsonplaceholder.typicode.com/posts/${data}`,
        PostSchema,
      )
    } catch (error) {
      console.error(error)
      if (
        HttpClientError.isHttpClientError(error) &&
        error.response?.status === 404
      ) {
        throw notFound()
      }
      throw error
    }
  })

export const postAtom = Atom.family((postId: string) =>
  Atom.make(
    Effect.tryPromise({
      try: () => fetchPost({ data: postId }),
      catch: (error) =>
        error instanceof Error ? error.message : String(error),
    }),
  ).pipe(
    Atom.keepAlive,
    Atom.serializable({
      key: `post:${postId}`,
      schema: postResultSchema,
    }),
  ),
)
