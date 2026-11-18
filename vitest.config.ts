import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Workspace packages expose their TypeScript source under the custom
    // "@veloce/source" export condition, so tests run against src/ directly
    // without needing a `pnpm build` first.
    conditions: ["@veloce/source"],
  },
  test: {
    include: ["{apps,packages,plugins}/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
