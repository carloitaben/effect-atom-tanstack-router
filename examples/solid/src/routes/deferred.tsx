import { useAtomResource } from "@effect/atom-solid"
import { createFileRoute } from "@tanstack/solid-router"
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as Schema from "effect/Schema"
import { Show, Suspense, createSignal } from "solid-js"

const deferredAtom = Atom.make(
  Effect.tryPromise({
    try: async () => {
      await new Promise((r) => setTimeout(r, 3000))
      return {
        message: `Hello deferred from the server!`,
        status: "success",
        time: new Date(),
      }
    },
    catch: (error) => (error instanceof Error ? error.message : String(error)),
  }),
).pipe(
  Atom.keepAlive,
  Atom.serializable({
    key: "deferred",
    schema: AsyncResult.Schema({
      success: Schema.Struct({
        message: Schema.String,
        status: Schema.String,
        time: Schema.DateFromString,
      }),
      error: Schema.String,
    }),
  }),
)

export const Route = createFileRoute("/deferred")({
  loader: ({ context }) => {
    // Kick off loading as early as possible!
    context.registry.get(deferredAtom)
  },
  component: Deferred,
})

function Deferred() {
  const [count, setCount] = createSignal(0)

  return (
    <div class="p-2">
      <Suspense fallback="Loading Middleman...">
        <DeferredQuery />
      </Suspense>
      <div>Count: {count()}</div>
      <div>
        <button onClick={() => setCount(count() + 1)}>Increment</button>
      </div>
    </div>
  )
}

function DeferredQuery() {
  const [deferred] = useAtomResource(() => deferredAtom)

  return (
    <Show when={deferred()}>
      {(data) => (
        <div>
          <h1>Deferred Query</h1>
          <div>Status: {data().status}</div>
          <div>Message: {data().message}</div>
          <div>Time: {data().time.toISOString()}</div>
        </div>
      )}
    </Show>
  )
}
