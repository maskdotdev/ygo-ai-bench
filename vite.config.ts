import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/browserPlaytest.ts",
      formats: ["es"],
      fileName: () => "playtest-engine.js",
    },
    outDir: "dist",
    emptyOutDir: true,
  },
});
