import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    solid({
      // Only this package's Solid sources use the Solid JSX transform; the
      // React pane and its tests keep the React JSX transform.
      include: [/[\\/]src[\\/]solid[\\/]/],
      // Vitest's module runner treats `/@solid-refresh` as `file:///@solid-refresh`
      // and throws. HMR is not used in tests.
      hot: false,
    }),
  ],
})
