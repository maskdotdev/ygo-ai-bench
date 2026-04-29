import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    rollupOptions: {
      input: {
        playtest: "playtest.html",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
  },
});
