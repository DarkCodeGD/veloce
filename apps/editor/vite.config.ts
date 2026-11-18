/**
 * The editor is built with Vite straight from workspace sources (the `@veloce/source` export
 * condition), so `pnpm build:editor` doesn't need `tsc -b` first.
 *
 * Two pages: `index.html` (the editor) and `render.html` (the headless render page the server's
 * render worker drives). In dev (`pnpm dev:editor`), API/WebSocket/MCP calls go to a running
 * `veloce-server` on port 4321.
 */
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

const SERVER = process.env.VELOCE_SERVER ?? "http://127.0.0.1:4321";

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["@veloce/source", ...defaultClientConditions] },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: { input: { main: "index.html", render: "render.html" } },
  },
  server: {
    port: 5173,
    // changeOrigin rewrites Host to the server's own, which its DNS-rebinding check requires.
    // The browser's Origin (this dev server) is allowed with `--allow-origin` (pnpm dev:server).
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/mcp": { target: SERVER, changeOrigin: true },
      "/ws": { target: SERVER.replace(/^http/, "ws"), ws: true, changeOrigin: true },
    },
  },
});
