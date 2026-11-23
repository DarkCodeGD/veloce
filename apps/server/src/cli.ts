#!/usr/bin/env node
/**
 * `veloce-server`: run Veloce locally.
 *
 *   veloce-server [--dir <folder>] [--port 4321] [--host 127.0.0.1] [--no-render]
 *                 [--chromium <path>] [--allow-origin <url>] [--settings <file>]
 *
 * Decks live as .veloce files in --dir (default: $VELOCE_DIR, the decks folder setting, or
 * ~/Veloce). App settings (D91) live in one file per user (see settings-file.ts).
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createBuiltinRegistry } from "@veloce/builtins";
import { CachedRenderService, SettingsStore, Workspace } from "@veloce/doc-server";
import { startVeloceServer, VERSION } from "./app.js";
import { PlaywrightRenderService } from "./render-worker.js";
import { settingsFile, startupOptions } from "./settings-file.js";

const HELP = `veloce-server ${VERSION}

Usage: veloce-server [options]

  --dir <folder>         Where decks are stored (default: $VELOCE_DIR, the decks folder
                         in Preferences, or ~/Veloce)
  --port <n>             Port (default: the port in Preferences, 4321)
  --host <addr>          Address to bind (default 127.0.0.1; there's no login, keep it local)
  --no-render            Don't start headless Chromium (lint skips visual checks, no previews)
  --chromium <path>      Use this Chrome/Chromium binary for headless rendering
  --allow-origin <url>   Also accept browser requests from this origin (e.g. a Vite dev server)
  --settings <file>      The app settings file (default: $VELOCE_SETTINGS, or your user
                         config folder, e.g. ~/.config/veloce/settings.json)
  -h, --help             Show this help`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      "no-render": { type: "boolean" },
      chromium: { type: "string" },
      "allow-origin": { type: "string", multiple: true },
      settings: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const host = { platform: process.platform, env: process.env, home: homedir() };
  const settings = await SettingsStore.open(
    values.settings ? resolve(values.settings) : settingsFile(host),
    (message) => console.warn(`  ${message}`),
  );
  const { dir, port } = startupOptions(settings.settings, values, host);
  const registry = createBuiltinRegistry();
  const workspace = await Workspace.open({
    dir,
    context: registry.applyContext(),
    generator: { name: "Veloce", version: VERSION },
  });
  const editorDir = fileURLToPath(new URL("../../editor/dist", import.meta.url));
  const chromiumPath = values.chromium ?? process.env.VELOCE_CHROMIUM;

  const app = await startVeloceServer({
    workspace,
    registry,
    editorDir,
    port,
    settings,
    ...(values.host && { host: values.host }),
    ...(values["allow-origin"] && { allowedOrigins: values["allow-origin"] }),
    render: values["no-render"]
      ? null
      : (baseUrl) =>
          new CachedRenderService(
            new PlaywrightRenderService({
              baseUrl,
              ...(chromiumPath && { executablePath: chromiumPath }),
            }),
          ),
  });

  console.log(`
  Veloce ${VERSION} is running

    Editor   ${app.url}
    MCP      ${app.mcpUrl}
    Decks    ${dir}
    Settings ${settings.file}

  Connect Claude Code:
    claude mcp add --transport http veloce ${app.mcpUrl}
`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\n  Saving and shutting down…");
    await app.close();
    await workspace.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((error: unknown) => {
  const err = error as NodeJS.ErrnoException;
  if (err?.code === "EADDRINUSE") {
    console.error(`Port already in use. Is Veloce already running? Try another port with --port.`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
