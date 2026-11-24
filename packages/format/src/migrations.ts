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
 * otherwise already a valid v3 one: the version number is what makes an older Veloce say
 * "update Veloce" instead of failing on a field it doesn't know.
 *
 * One change (D111): a theme left exactly as a built-in one (its name unchanged; editing a
 * theme renames it "… (custom)") gets that built-in's `$motion` tokens, so a Midnight deck
 * moves like Midnight and still shows as Midnight in the theme picker. Any other theme gets
 * none and moves with Veloce's default. The values are a snapshot: tuning a built-in later
 * mustn't change how an old file opens.
 *
 * v3 is unreleased while Phase 4 builds it, so this migration may still grow (2.5D next);
 * it freezes when v3 ships.
 */
const VELOCE_MOTION = {
  fast: 200,
  normal: 400,
  slow: 700,
  stagger: 80,
  enter: { cubicBezier: [0.16, 1, 0.3, 1] },
  exit: { cubicBezier: [0.7, 0, 0.84, 0] },
  move: { cubicBezier: [0.65, 0, 0.35, 1] },
};
const V3_BUILTIN_MOTION: Readonly<Record<string, Json>> = {
  "Veloce Light": VELOCE_MOTION,
  "Veloce Dark": VELOCE_MOTION,
  Midnight: {
    fast: 260,
    normal: 550,
    slow: 900,
    stagger: 120,
    enter: { cubicBezier: [0.22, 1, 0.36, 1] },
    exit: { cubicBezier: [0.64, 0, 0.78, 0] },
    move: { cubicBezier: [0.83, 0, 0.17, 1] },
  },
  Ember: {
    fast: 180,
    normal: 380,
    slow: 650,
    stagger: 60,
    enter: { spring: { bounce: 0.3 } },
    exit: { cubicBezier: [0.7, 0, 0.84, 0] },
    move: { spring: { bounce: 0.15 } },
  },
  Paper: {
    fast: 240,
    normal: 480,
    slow: 800,
    stagger: 100,
    enter: "ease-out",
    exit: "ease-in",
    move: "ease-in-out",
  },
  Studio: {
    fast: 150,
    normal: 320,
    slow: 560,
    stagger: 50,
    enter: { cubicBezier: [0.2, 0, 0, 1] },
    exit: { cubicBezier: [0.3, 0, 1, 1] },
    move: { cubicBezier: [0.2, 0, 0, 1] },
  },
};

function motionRelease(doc: RawDocument): RawDocument {
  const theme = doc.theme;
  if (!isObject(theme) || "motion" in theme || typeof theme.name !== "string") return doc;
  if (!Object.hasOwn(V3_BUILTIN_MOTION, theme.name)) return doc;
  return {
    ...doc,
    theme: { ...theme, motion: JSON.parse(JSON.stringify(V3_BUILTIN_MOTION[theme.name])) },
  };
}

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
