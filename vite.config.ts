import { defineConfig } from "vite";

export default defineConfig({
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
