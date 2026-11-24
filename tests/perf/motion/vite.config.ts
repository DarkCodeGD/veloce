/**
 * Builds the motion benchmark page (D104 §4) from workspace sources, like the editor does, so
 * it measures the real renderer. Output goes to `.output/dist` (git-ignored).
 */
import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  logLevel: "warn",
  resolve: { conditions: ["@veloce/source", ...defaultClientConditions] },
  build: { outDir: `${root}.output/dist`, emptyOutDir: true },
});
