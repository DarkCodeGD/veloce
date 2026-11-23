/**
 * Where the app settings file lives (D91), and how its startup settings meet the command
 * line. Pure (the platform, environment and home folder are passed in), so it's tested.
 */
import { join, resolve } from "node:path";
import type { Settings } from "@veloce/core";

interface Host {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}

/**
 * The settings file: $VELOCE_SETTINGS if set, else the platform's usual place for app
 * settings: %APPDATA%\Veloce on Windows, ~/Library/Application Support/Veloce on macOS,
 * $XDG_CONFIG_HOME/veloce (default ~/.config/veloce) elsewhere. Electron (Phase 6) uses the
 * same folders, so both share one file.
 */
export function settingsFile({ platform, env, home }: Host): string {
  if (env.VELOCE_SETTINGS) return resolve(env.VELOCE_SETTINGS);
  if (platform === "win32") {
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Veloce", "settings.json");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Veloce", "settings.json");
  }
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "veloce", "settings.json");
}

/**
 * The decks folder and port to start with. A flag beats the environment, which beats the
 * settings, which beat the defaults: a one-off `--port` never changes what's saved.
 */
export function startupOptions(
  settings: Settings,
  flags: { dir?: string | undefined; port?: string | undefined },
  { env, home }: Pick<Host, "env" | "home">,
): { dir: string; port: number } {
  const dir = resolve(
    flags.dir ?? env.VELOCE_DIR ?? settings.files.decksFolder ?? join(home, "Veloce"),
  );
  const port = flags.port === undefined ? settings.ai.port : Number(flags.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port "${flags.port}"`);
  }
  return { dir, port };
}
