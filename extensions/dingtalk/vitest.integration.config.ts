import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    include: ["test/integration/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["test/setup.ts"],
  },
});
