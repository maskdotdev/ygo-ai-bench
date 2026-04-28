import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/browser-playtest.ts",
      formats: ["es"],
      fileName: () => "playtest-engine.js",
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
