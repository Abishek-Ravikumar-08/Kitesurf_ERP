import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globals: true,
    setupFiles: ["reflect-metadata"], // required for Nest DI under Vitest (D-018)
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  plugins: [swc.vite()],
});
