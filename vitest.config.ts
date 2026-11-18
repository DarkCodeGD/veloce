import { defineConfig } from "vitest/config";

/**
 * Workspace packages expose their TypeScript source under the custom "@veloce/source" export
 * condition, so tests always run against src/ (never a stale dist/) and need no build first.
 *
 * Vite resolves browser-like environments (happy-dom) with `resolve.conditions` and Node
 * environments with `ssr.resolve.conditions`; setting either replaces Vite's defaults, so the
 * defaults are listed explicitly after our condition.
 */
const SOURCE = "@veloce/source";

export default defineConfig({
  resolve: {
    conditions: [SOURCE, "module", "browser", "development|production"],
  },
  ssr: {
    resolve: {
      conditions: [SOURCE, "module", "node", "development|production"],
    },
  },
  test: {
    include: [
      "{apps,packages,plugins}/*/src/**/*.test.ts",
      "scripts/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
  },
});
