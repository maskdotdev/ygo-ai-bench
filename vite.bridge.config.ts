import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "#cards": "/src/cards",
      "#duel": "/src/engine/duel",
      "#engine": "/src/engine",
      "#lua": "/src/engine/lua",
      "#playtest": "/src/playtest",
    },
  },
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
