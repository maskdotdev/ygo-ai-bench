import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  define: {
    process: "globalThis.__duelDeckStudioProcess",
    global: "globalThis",
  },
  resolve: {
    alias: {
      "#cards": "/src/cards",
      "#duel": "/src/engine/duel",
      "#engine": "/src/engine",
      "#lua": "/src/engine/lua",
      "#playtest": "/src/playtest",
      "fs": resolve(__dirname, "src/browser-node-shims/fs.ts"),
      "os": resolve(__dirname, "src/browser-node-shims/os.ts"),
      "readline-sync": resolve(__dirname, "src/browser-node-shims/readline-sync.ts"),
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
