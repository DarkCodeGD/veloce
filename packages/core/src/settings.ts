/**
 * App settings (D53 §5, D91): the user's preferences, stored in one settings file the server
 * owns, outside every `.veloce` file and outside ops (they're not deck content, so no undo,
 * no history, no agent changes them).
 *
 * One schema serves the file, the sync protocol and the Preferences window. Reading is
 * forgiving field by field: a value that's missing, broken or out of range falls back to
 * its default without losing the others, so a hand-edited file or one from another version
 * never stops the app from starting.
 */
import { z } from "zod";

/** Bumped only by a change old versions would misread; additions keep it. */
export const SETTINGS_VERSION = 1;

/** The settings, by Preferences tab. Every field has a default (`DEFAULT_SETTINGS`). */
/**
 * Interface settings (UI scale, light/dark) come with the desktop app (D91 §2): CSS zoom
 * misplaces every popover, and there's no light theme yet. No setting ships that does nothing.
 */
const SECTIONS = {
  editing: z.strictObject({
    /** Undo steps kept per participant (you, each agent). More steps, more memory. */
    undoSteps: z.int().min(20).max(1000),
    /** Moving layers snaps them to their neighbours and their frame. */
    snapping: z.boolean(),
    /** Slide pixels an arrow key moves a layer, and with Shift. */
    nudge: z.number().min(0.1).max(100),
    nudgeBig: z.number().min(1).max(500),
    /** Lint in the editor (D73): the Issues tab and its badges. Agents always get lint. */
    lint: z.boolean(),
    /** Lint rules the editor doesn't show (by rule ID). */
    mutedRules: z.array(z.string().min(1).max(64)).max(64),
    /** Dragging the motion level plays the slide on the canvas at each level (D122). */
    previewLevel: z.boolean(),
  }),
  files: z.strictObject({
    /** Where decks are kept. null: the default folder (~/Veloce). Applies on restart. */
    decksFolder: z.string().trim().min(1).max(4096).nullable(),
    /** The pause after a change before it's saved. */
    autosaveMs: z.int().min(200).max(60_000),
  }),
  ai: z.strictObject({
    /** Follow AI starts on: the editor jumps to the slide an agent is working on. */
    followAI: z.boolean(),
    /** The local port for the editor and MCP. Applies on restart. */
    port: z.int().min(1024).max(65_535),
  }),
};

type Sections = typeof SECTIONS;
export type SettingsSection = keyof Sections;
export type Settings = { version: typeof SETTINGS_VERSION } & {
  [S in SettingsSection]: z.infer<Sections[S]>;
};

export const SettingsSchema = z.strictObject({
  version: z.literal(SETTINGS_VERSION),
  ...SECTIONS,
});

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  editing: {
    undoSteps: 200,
    snapping: true,
    nudge: 1,
    nudgeBig: 10,
    lint: true,
    mutedRules: [],
    previewLevel: true,
  },
  files: { decksFolder: null, autosaveMs: 800 },
  ai: { followAI: true, port: 4321 },
};

/** A change to some settings: any fields of any sections. */
export const SettingsPatchSchema = z.strictObject({
  editing: SECTIONS.editing.partial().optional(),
  files: SECTIONS.files.partial().optional(),
  ai: SECTIONS.ai.partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

const SECTION_NAMES = Object.keys(SECTIONS) as SettingsSection[];

/**
 * Settings from whatever a file held: each valid field kept, every other one its default.
 * Never throws.
 */
export function parseSettings(raw: unknown): Settings {
  const input = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = { version: SETTINGS_VERSION };
  for (const name of SECTION_NAMES) {
    const given = isRecord(input[name]) ? (input[name] as Record<string, unknown>) : {};
    const defaults = DEFAULT_SETTINGS[name] as Record<string, unknown>;
    const shape = SECTIONS[name].shape as Record<string, z.ZodType>;
    const section: Record<string, unknown> = {};
    for (const [field, fallback] of Object.entries(defaults)) {
      const parsed = shape[field]?.safeParse(given[field]);
      section[field] = parsed?.success ? parsed.data : fallback;
    }
    out[name] = section;
  }
  return out as Settings;
}

/** The settings with a (validated) patch applied. */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  const next = { ...settings } as Record<string, unknown>;
  for (const name of SECTION_NAMES) {
    const changes = patch[name];
    if (changes) next[name] = { ...settings[name], ...changes };
  }
  return next as Settings;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
