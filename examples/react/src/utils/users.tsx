import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as Schema from "effect/Schema"

export type User = {
  id: number
  name: string
  email: string
}

export const DEPLOY_URL = "http://localhost:3000"

export const UserSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String,
})

const userResultSchema = AsyncResult.Schema({
  success: UserSchema,
  error: Schema.String,
})

function getJson<A>(url: string, schema: Schema.ConstraintDecoder<A>) {
  return Effect.runPromise(
    HttpClient.get(url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.provide(FetchHttpClient.layer),
    ),
  )
}

export const usersAtom = Atom.make(
  Effect.tryPromise({
    try: () => getJson(DEPLOY_URL + "/api/users", Schema.Array(UserSchema)),
    catch: (error) => (error instanceof Error ? error.message : String(error)),
  }),
).pipe(
  Atom.keepAlive,
  Atom.serializable({
    key: "users",
    schema: AsyncResult.Schema({
      success: Schema.mutable(Schema.Array(UserSchema)),
      error: Schema.String,
    }),
  }),
)

export const userAtom = Atom.family((id: string) =>
  Atom.make(
    Effect.tryPromise({
      try: () => getJson(DEPLOY_URL + "/api/users/" + id, UserSchema),
      catch: (error) =>
        error instanceof Error ? error.message : String(error),
    }),
  ).pipe(
    Atom.keepAlive,
    Atom.serializable({
      key: `user:${id}`,
      schema: userResultSchema,
    }),
  ),
)
