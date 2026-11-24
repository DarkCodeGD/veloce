/**
 * Format migrations: how decks from older Veloce versions keep opening forever.
 *
 * `MIGRATIONS[n]` upgrades a raw document (the deck as plain JSON) from format version
 * `n` to `n + 1`. To change the document format:
 *   1. bump `FORMAT_VERSION` in @veloce/core,
 *   2. add `MIGRATIONS[old]` here,
 *   3. add a fixture file of the old version and a test that it migrates.
 * Migrations must be pure and must never be edited once released.
 */
import { FORMAT_VERSION } from "@veloce/core";
import { FormatError } from "./errors.js";

export type RawDocument = Record<string, unknown>;
export type Migration = (doc: RawDocument) => RawDocument;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * v1 → v2: themes gain the `lead` text style (large body text, D98), which the built-in
 * layouts use. It's derived from the deck's own `body` style at 1.5× the size, so a theme
 * with its own fonts keeps them; a theme that already has a `lead` keeps it. Placed just
 * before `body`, where the built-in themes list it.
 */
function addLeadStyle(doc: RawDocument): RawDocument {
  const theme = doc.theme;
  if (!isObject(theme) || !isObject(theme.text) || "lead" in theme.text) return doc;
  const body = theme.text.body;
  if (!isObject(body) || typeof body.size !== "number") return doc;
  const lead = { ...body, size: Math.round(body.size * 1.5) };
  const text: Json = {};
  for (const [name, style] of Object.entries(theme.text)) {
    if (name === "body") text.lead = lead;
    text[name] = style;
  }
  return { ...doc, theme: { ...theme, text } };
}

/**
 * v2 → v3: the motion release (D103 §7). Everything v3 adds is optional, so a v2 document is
 * already a valid v3 one: the version number is what makes an older Veloce say "update
 * Veloce" instead of failing on a field it doesn't know. v3 is unreleased while Phase 4
 * builds it, so this migration may still grow (match keys, D109; then the timeline, 2.5D,
 * the motion level and `$motion` tokens); it freezes when v3 ships.
 */
const motionRelease: Migration = (doc) => doc;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: addLeadStyle,
  2: motionRelease,
};

export function migrateDocument(
  doc: RawDocument,
  from: number,
  to: number = FORMAT_VERSION,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): RawDocument {
  if (from > to) {
    throw new FormatError(
      "TOO_NEW",
      `This deck uses format version ${from}, but this Veloce only understands up to ${to}. Update Veloce to open it.`,
    );
  }
  let current = doc;
  for (let version = from; version < to; version++) {
    const migrate = migrations[version];
    if (!migrate)
      throw new Error(`Missing migration from format version ${version} to ${version + 1}`);
    current = { ...migrate(current), formatVersion: version + 1 };
  }
  return current;
}
