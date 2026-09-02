import { createFileRoute } from "@tanstack/react-router"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { UserSchema } from "../../utils/users"

export const Route = createFileRoute("/api/users/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        console.info(`Fetching users by id=${params.id}... @`, request.url)
        try {
          const user = await Effect.runPromise(
            HttpClient.get(
              "https://jsonplaceholder.typicode.com/users/" + params.id,
            ).pipe(
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.flatMap(HttpClientResponse.schemaBodyJson(UserSchema)),
              Effect.provide(FetchHttpClient.layer),
            ),
          )
          return Response.json(user)
        } catch (e) {
          console.error(e)
          return Response.json({ error: "User not found" }, { status: 404 })
        }
      },
    },
  },
})
