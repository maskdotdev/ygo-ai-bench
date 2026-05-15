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
      entry: "src/browser-pvp-playtest.ts",
      formats: ["es"],
      fileName: () => "duel-pvp-engine.js",
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
