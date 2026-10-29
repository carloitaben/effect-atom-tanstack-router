import { transformAsync } from "@babel/core"
import solidPreset from "babel-preset-solid"
import { defineConfig } from "tsdown"

/**
 * Solid's JSX must be compiled by `babel-preset-solid`; the automatic JSX
 * runtime that Oxc emits evaluates props eagerly and is not reactive. The React
 * entry keeps the TypeScript-configured transform.
 */
const solidJsx = () => ({
  name: "solid-jsx",
  async transform(code: string, id: string) {
    if (!/[\\/]src[\\/]solid[\\/].*\.tsx$/.test(id)) return
    const result = await transformAsync(code, {
      filename: id,
      configFile: false,
      babelrc: false,
      sourceMaps: true,
      presets: [
        [solidPreset, { generate: "dom", hydratable: false }],
        ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
      ],
      parserOpts: { plugins: ["jsx", "typescript"] },
    })
    if (result?.code == null) return
    return { code: result.code, map: result.map ?? undefined }
  },
})

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.tsx",
    solid: "src/solid/index.tsx",
  },
  plugins: [solidJsx()],
  dts: true,
})
