import { resolve } from "path";
import { defineConfig } from "vite";

import typescript2 from "rollup-plugin-typescript2"

const rollupInput = {
  index: "src/index.ts",
  BitMatrix: "src/BitMatrix.ts",
  "locator/index": "src/locator/index.ts",
  "decoder/index": "src/decoder/index.ts",
  "decoder/version": "src/decoder/version.ts",
  "decoder/decodeData/index": "src/decoder/decodeData/index.ts",
  "decoder/decodeData/BitStream": "src/decoder/decodeData/BitStream.ts",
  "decoder/reedsolomon/index": "src/decoder/reedsolomon/index.ts",
};

export default defineConfig({
  esbuild: {
    target: ["chrome89", "safari15", "firefox89"],
  },
  build: {
    lib: {
      entry: Object.values(rollupInput).map((path) => resolve(__dirname, path)),
      name: "index",
      formats: ["es"],
    },
    target: ["chrome89", "safari15", "firefox89"],
    rollupOptions: {
      input: rollupInput,
      output: {
        dir: "dist",
        format: "esm",
        entryFileNames: "[name].js",
      },
    },
  },
});
