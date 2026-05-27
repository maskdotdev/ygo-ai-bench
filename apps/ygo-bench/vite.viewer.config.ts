import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "viewer"),
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist-viewer"),
    emptyOutDir: true,
  },
});
