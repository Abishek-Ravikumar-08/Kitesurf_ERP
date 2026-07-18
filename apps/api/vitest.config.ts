import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globals: true,
    setupFiles: ["reflect-metadata"],
    testTimeout: 30_000,
  },
  plugins: [swc.vite()],
});
