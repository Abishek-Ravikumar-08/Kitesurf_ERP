import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
    globals: true,
    setupFiles: ["reflect-metadata"],
    testTimeout: 30_000,
  },
  plugins: [swc.vite()],
});
