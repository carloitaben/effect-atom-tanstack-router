import { useAtomSuspense } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { Suspense, useState } from "react"

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
  const [count, setCount] = useState(0)

  return (
    <div className="p-2">
      <Suspense fallback="Loading Middleman...">
        <DeferredQuery />
      </Suspense>
      <div>Count: {count}</div>
      <div>
        <button onClick={() => setCount(count + 1)}>Increment</button>
      </div>
    </div>
  )
}

function DeferredQuery() {
  const deferred = useAtomSuspense(deferredAtom).value

  return (
    <div>
      <h1>Deferred Query</h1>
      <div>Status: {deferred.status}</div>
      <div>Message: {deferred.message}</div>
      <div>Time: {deferred.time.toISOString()}</div>
    </div>
  )
}
