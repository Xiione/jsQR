import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    target: ["chrome89", "safari15", "firefox89"],
  },
  build: {
    target: ["chrome89", "safari15", "firefox89"],
    rollupOptions: {
      input: {
        index: "src/index.ts",
        BitMatrix: "src/BitMatrix.ts",
        "locator/index": "src/locator/index.ts",
        "decoder/index": "src/decoder/index.ts",
        "decoder/version": "src/decoder/version.ts",
        "decoder/decodeData/index": "src/decoder/decodeData/index.ts",
        "decoder/decodeData/BitStream": "src/decoder/decodeData/BitStream.ts",
        "decoder/reedsolomon/index": "src/decoder/reedsolomon/index.ts",
      },
      output: {
        dir: "dist",
        format: "esm",
        entryFileNames: "[name].js",
      },
    },
  },
});
