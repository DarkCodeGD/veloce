import { describe, expect, it } from "vitest";
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  parseSettings,
  SettingsPatchSchema,
  SettingsSchema,
} from "../index.js";

describe("app settings (D91)", () => {
  it("defaults to a valid set of settings", () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not an object")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps every valid field of a file and defaults only the broken ones", () => {
    const parsed = parseSettings({
      version: 99, // another version: still read field by field
      interface: { uiScale: 1.25 }, // not a setting (yet): dropped
      editing: { undoSteps: 5, nudge: 2, snapping: "yes", mutedRules: ["overlap"] },
      files: { decksFolder: "  /home/me/Decks  " },
      ai: { port: 80, followAI: false, model: "x" },
      extra: { anything: true },
    });
    expect(parsed).toEqual({
      ...DEFAULT_SETTINGS,
      editing: { ...DEFAULT_SETTINGS.editing, nudge: 2, mutedRules: ["overlap"] },
      files: { ...DEFAULT_SETTINGS.files, decksFolder: "/home/me/Decks" },
      ai: { ...DEFAULT_SETTINGS.ai, followAI: false },
    });
    expect(SettingsSchema.safeParse(parsed).success).toBe(true);
  });

  it("applies a patch to some fields of some sections", () => {
    const patch = SettingsPatchSchema.parse({ editing: { snapping: false }, ai: { port: 5000 } });
    const next = applySettingsPatch(DEFAULT_SETTINGS, patch);
    expect(next.editing).toEqual({ ...DEFAULT_SETTINGS.editing, snapping: false });
    expect(next.ai.port).toBe(5000);
    expect(next.files).toBe(DEFAULT_SETTINGS.files); // untouched sections are shared
    expect(DEFAULT_SETTINGS.editing.snapping).toBe(true); // never mutated
  });

  it("rejects a patch with an unknown or out-of-range field", () => {
    expect(SettingsPatchSchema.safeParse({ editing: { nudge: 0 } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ editing: { colour: "red" } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ plugins: {} }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ files: { decksFolder: null } }).success).toBe(true);
  });
});
