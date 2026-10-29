import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // Node resolves `solid-js` to its server runtime, which does not track
      // dependencies. Tests exercise the client runtime instead.
      {
        find: /^solid-js$/,
        replacement: fromHere("./node_modules/solid-js/dist/solid.js"),
      },
    ],
  },
  test: {
    server: {
      deps: {
        // Inline so the alias above applies to its `solid-js` import.
        inline: [/@effect\/atom-solid/],
      },
    },
  },
})
