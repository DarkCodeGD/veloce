/**
 * Writing .veloce files.
 *
 * Invariant: we never write a file we couldn't read back. The deck is validated, and asset
 * bytes must match the deck's registry exactly (each asset's SHA-256 is re-checked).
 */
import { ID_PATTERN, sha256Hex, validateDeck } from "@veloce/core";
import { strToU8, type Zippable, zipSync } from "fflate";
import type { DeckBundle } from "./bundle.js";
import { FORMAT_ID, PATHS } from "./constants.js";
import { FormatError } from "./errors.js";
import type { Manifest } from "./manifest.js";
import { extensionFor, isPrecompressed } from "./mime.js";

export interface WriteOptions {
  /** When the deck was first created. Pass the previous manifest's value when re-saving. Default: now. */
  createdAt?: Date | string;
  /** Timestamp for this save (also used as zip entry time, so output is reproducible). Default: now. */
  now?: Date;
  /** Recorded in the manifest, e.g. `{ name: "Veloce Desktop", version: "1.2.0" }`. */
  generator?: { name: string; version: string };
}

const COMPRESS = 6;
const STORE = 0;

export async function writeVeloce(
  bundle: DeckBundle,
  options: WriteOptions = {},
): Promise<Uint8Array> {
  const { deck } = bundle;
  const validation = validateDeck(deck);
  if (!validation.ok) {
    throw new FormatError(
      "INVALID_DOCUMENT",
      `Refusing to save an invalid deck: ${validation.errors[0]?.message}`,
      validation.errors,
    );
  }
  await assertAssetsMatch(bundle);

  const now = options.now ?? new Date();
  const createdAt = options.createdAt ?? now;
  const manifest: Manifest = {
    format: FORMAT_ID,
    formatVersion: deck.formatVersion,
    title: deck.meta.title,
    createdAt: typeof createdAt === "string" ? createdAt : createdAt.toISOString(),
    modifiedAt: now.toISOString(),
    ...(options.generator && { generator: options.generator }),
  };
  const { theme, ...document } = deck;

  const entry = (data: Uint8Array, level: typeof COMPRESS | typeof STORE): Zippable[string] => [
    data,
    { level, mtime: now },
  ];
  // Insertion order = zip order: the small manifest goes first so readers can sniff it cheaply.
  const files: Zippable = {
    [PATHS.manifest]: entry(strToU8(JSON.stringify(manifest, null, 2)), STORE),
    [PATHS.document]: entry(strToU8(JSON.stringify(document)), COMPRESS),
    [PATHS.theme]: entry(strToU8(JSON.stringify(theme, null, 2)), COMPRESS),
  };
  if (bundle.plugins) {
    files[PATHS.plugins] = entry(strToU8(JSON.stringify(bundle.plugins, null, 2)), COMPRESS);
  }
  if (bundle.preview) files[PATHS.preview] = entry(bundle.preview, STORE);
  for (const [id, bytes] of bundle.assets) {
    const ext = extensionFor(deck.assets[id]?.mime ?? "");
    files[`${PATHS.assetsDir}${id}.${ext}`] = entry(bytes, isPrecompressed(ext) ? STORE : COMPRESS);
  }
  for (const [nodeId, png] of bundle.fallbacks ?? []) {
    if (!ID_PATTERN.test(nodeId)) {
      throw new FormatError("INCONSISTENT", `Fallback key "${nodeId}" isn't a valid node ID`);
    }
    files[`${PATHS.fallbacksDir}${nodeId}.png`] = entry(png, STORE);
  }
  return zipSync(files);
}

async function assertAssetsMatch({ deck, assets }: DeckBundle): Promise<void> {
  for (const [id, info] of Object.entries(deck.assets)) {
    const bytes = assets.get(id);
    const label = info.name ? `"${info.name}" (${id})` : id;
    if (!bytes) throw new FormatError("INCONSISTENT", `No bytes provided for asset ${label}`);
    if ((await sha256Hex(bytes)) !== id) {
      throw new FormatError("INCONSISTENT", `Bytes for asset ${label} don't match its SHA-256 ID`);
    }
  }
  for (const id of assets.keys()) {
    if (!Object.hasOwn(deck.assets, id)) {
      throw new FormatError(
        "INCONSISTENT",
        `Bytes were provided for asset ${id}, which isn't registered in the deck (add it with asset.add)`,
      );
    }
  }
}
