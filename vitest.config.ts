import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.js";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/vitest-global-setup.ts"],
      setupFiles: ["./test/vitest-setup.ts"],
      maxWorkers: 4,
      minWorkers: 1,
      teardownTimeout: 30_000,
      testTimeout: 10_000,
    },
  }),
);
