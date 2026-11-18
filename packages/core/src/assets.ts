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
