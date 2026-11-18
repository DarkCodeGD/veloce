/**
 * Asset identity and reference tracking.
 *
 * An asset's ID is the SHA-256 of its bytes, so identical files are stored once and
 * a file's integrity can be checked on load. Content refers to assets as `"asset:<id>"`.
 */
import { webCrypto } from "./crypto.js";
import { isPlainObject } from "./json.js";
import type { Deck } from "./schema/deck.js";
import { ASSET_REF_PATTERN, type AssetRef } from "./schema/primitives.js";
import { walkNodes } from "./tree.js";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await webCrypto().subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function assetRef(id: string): AssetRef {
  return `asset:${id}`;
}

/** `"asset:<id>"` → `"<id>"`, or `null` if it isn't an asset reference. */
export function parseAssetRef(value: unknown): string | null {
  return typeof value === "string" && ASSET_REF_PATTERN.test(value) ? value.slice(6) : null;
}

/**
 * Asset IDs referenced anywhere inside a JSON value. Works on plugin props without knowing their
 * schema, because asset references always use the `asset:` prefix.
 */
export function collectAssetRefs(value: unknown, into: Set<string> = new Set()): Set<string> {
  const id = parseAssetRef(value);
  if (id) into.add(id);
  else if (Array.isArray(value)) for (const item of value) collectAssetRefs(item, into);
  else if (isPlainObject(value))
    for (const item of Object.values(value)) collectAssetRefs(item, into);
  return into;
}

/** asset ID → IDs of the slides/nodes that use it. */
export function assetUsage(deck: Deck): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  const record = (ownerId: string, value: unknown) => {
    for (const id of collectAssetRefs(value)) usage.set(id, [...(usage.get(id) ?? []), ownerId]);
  };
  for (const slide of deck.slides) {
    record(slide.id, slide.background);
    for (const { node } of walkNodes(slide.root)) {
      record(node.id, node.kind === "frame" ? node.style : node.props);
    }
  }
  return usage;
}

// ── Importable files ────────────────────────────────────────────────────────────────────

/** The largest file that can be imported as an asset (50 MiB). */
export const MAX_ASSET_BYTES = 50 * 1024 ** 2;

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
] as const;
export const FONT_MIME_TYPES = ["font/woff2", "font/woff", "font/ttf", "font/otf"] as const;

export type AssetKind = "image" | "font" | "other";

export function assetKind(mime: string): AssetKind {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return "image";
  if ((FONT_MIME_TYPES as readonly string[]).includes(mime)) return "font";
  return "other";
}

// ── Deck fonts ──────────────────────────────────────────────────────────────────────────

/** One face of a font the deck carries as an asset (a file dropped in, or added by an agent). */
export interface DeckFontFace {
  assetId: string;
  mime: string;
  family: string;
  /** CSS `font-weight` descriptor: "400", or "100 900" for a variable font. */
  weight: string;
  style: "normal" | "italic";
}

/** Every font face in the deck's assets, in a stable order. */
export function deckFontFaces(deck: Pick<Deck, "assets">): DeckFontFace[] {
  const faces: DeckFontFace[] = [];
  for (const [assetId, info] of Object.entries(deck.assets).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!info.font || assetKind(info.mime) !== "font") continue;
    const w = info.font.weight;
    faces.push({
      assetId,
      mime: info.mime,
      family: info.font.family,
      weight: w === undefined ? "100 900" : Array.isArray(w) ? `${w[0]} ${w[1]}` : String(w),
      style: info.font.style ?? "normal",
    });
  }
  return faces;
}

/** The deck's own font families (each listed once), alphabetically. */
export function deckFontFamilies(deck: Pick<Deck, "assets">): string[] {
  return [...new Set(deckFontFaces(deck).map((f) => f.family))].sort((a, b) => a.localeCompare(b));
}

/** A theme font stack for an imported family: `"Acme Sans", system-ui, sans-serif`. */
export function fontStackFor(family: string): string {
  return `"${family}", system-ui, sans-serif`;
}
