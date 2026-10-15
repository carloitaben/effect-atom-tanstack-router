import { createFileRoute } from "@tanstack/solid-router"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Schema from "effect/Schema"
import { UserSchema } from "../../utils/users"

export const Route = createFileRoute("/api/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        console.info("Fetching users... @", request.url)
        const list = await Effect.runPromise(
          HttpClient.get("https://jsonplaceholder.typicode.com/users").pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(Schema.Array(UserSchema)),
            ),
            Effect.provide(FetchHttpClient.layer),
          ),
        )
        return Response.json(list.slice(0, 10))
      },
    },
  },
})
