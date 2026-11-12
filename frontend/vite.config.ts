import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    outDir: "../custom_components/factorio/www",
    emptyOutDir: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "factorio-cards.js",
    },
    minify: true,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
