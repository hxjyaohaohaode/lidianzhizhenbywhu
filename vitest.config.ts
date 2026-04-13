import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 20000,
    environment: "node",
    environmentMatchGlobs: [["src/web/**/*.test.tsx", "jsdom"]],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
