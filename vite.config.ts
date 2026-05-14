import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** TanStack routes that must resolve to the playtest SPA shell (direct URL / refresh). */
const PLAYTEST_SPA_PATHS = ["/pvp"];

function playtestSpaFallback(): Plugin {
  const rewrite = (req: { url?: string; method?: string }, _res: unknown, next: () => void) => {
    if (req.method !== "GET" || !req.url) return next();
    const pathname = req.url.split(/[?#]/)[0] ?? "";
    if (PLAYTEST_SPA_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      const qs = req.url.includes("?") ? `?${req.url.split("?").slice(1).join("?")}` : "";
      req.url = `/playtest.html${qs}`;
    }
    next();
  };
  return {
    name: "playtest-spa-fallback",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), playtestSpaFallback()],
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
