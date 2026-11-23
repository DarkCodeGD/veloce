import { join, resolve } from "node:path";
import { DEFAULT_SETTINGS } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { settingsFile, startupOptions } from "./settings-file.js";

const home = resolve("/home/ada");

describe("the settings file (D91)", () => {
  it("lives where each platform keeps app settings", () => {
    expect(settingsFile({ platform: "linux", env: {}, home })).toBe(
      join(home, ".config", "veloce", "settings.json"),
    );
    expect(settingsFile({ platform: "linux", env: { XDG_CONFIG_HOME: "/cfg" }, home })).toBe(
      join("/cfg", "veloce", "settings.json"),
    );
    expect(settingsFile({ platform: "darwin", env: {}, home })).toBe(
      join(home, "Library", "Application Support", "Veloce", "settings.json"),
    );
    expect(settingsFile({ platform: "win32", env: { APPDATA: "C:\\Roaming" }, home })).toBe(
      join("C:\\Roaming", "Veloce", "settings.json"),
    );
    expect(settingsFile({ platform: "linux", env: { VELOCE_SETTINGS: "/tmp/s.json" }, home })).toBe(
      resolve("/tmp/s.json"),
    );
  });

  it("starts with the flags first, then the environment, then the settings", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      files: { ...DEFAULT_SETTINGS.files, decksFolder: "/decks/mine" },
      ai: { ...DEFAULT_SETTINGS.ai, port: 5000 },
    };
    expect(startupOptions(DEFAULT_SETTINGS, {}, { env: {}, home })).toEqual({
      dir: join(home, "Veloce"),
      port: 4321,
    });
    expect(startupOptions(settings, {}, { env: {}, home })).toEqual({
      dir: resolve("/decks/mine"),
      port: 5000,
    });
    expect(startupOptions(settings, {}, { env: { VELOCE_DIR: "/env" }, home }).dir).toBe(
      resolve("/env"),
    );
    expect(startupOptions(settings, { dir: "/flag", port: "6000" }, { env: {}, home })).toEqual({
      dir: resolve("/flag"),
      port: 6000,
    });
    expect(() => startupOptions(settings, { port: "http" }, { env: {}, home })).toThrow(
      /Invalid --port "http"/,
    );
  });
});
