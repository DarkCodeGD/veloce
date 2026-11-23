/**
 * Writing .veloce files.
 *
 * Invariant: we never write a file we couldn't read back. The deck is validated, and asset
 * bytes must match what the deck and its versions register exactly (each asset's SHA-256 is
 * re-checked). Versions were valid decks when they were saved and never change, so they
 * aren't validated again on every save (a reader skips a bad one, never fails on it).
 */
import {
  type AssetInfo,
  type Deck,
  ID_PATTERN,
  MAX_VERSIONS,
  sha256Hex,
  VERSION_ID_PATTERN,
  validateDeck,
} from "@veloce/core";
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
  const registered = registeredAssets(bundle);
  for (const [id, bytes] of bundle.assets) {
    const ext = extensionFor(registered.get(id)?.mime ?? "");
    files[`${PATHS.assetsDir}${id}.${ext}`] = entry(bytes, isPrecompressed(ext) ? STORE : COMPRESS);
  }
  for (const [nodeId, png] of bundle.fallbacks ?? []) {
    if (!ID_PATTERN.test(nodeId)) {
      throw new FormatError("INCONSISTENT", `Fallback key "${nodeId}" isn't a valid node ID`);
    }
    files[`${PATHS.fallbacksDir}${nodeId}.png`] = entry(png, STORE);
  }
  const versions = bundle.versions ?? [];
  if (versions.length > MAX_VERSIONS) {
    throw new FormatError("INCONSISTENT", `A deck keeps at most ${MAX_VERSIONS} versions`);
  }
  for (const version of versions) {
    if (!VERSION_ID_PATTERN.test(version.id)) {
      throw new FormatError("INCONSISTENT", `Version ID "${version.id}" isn't valid`);
    }
    const { name, savedAt, deck: saved } = version;
    files[`${PATHS.versionsDir}${version.id}.json`] = entry(
      strToU8(JSON.stringify({ name, savedAt, deck: saved })),
      COMPRESS,
    );
  }
  return zipSync(files);
}

/** Every asset the deck or one of its versions registers, with its info. */
function registeredAssets({ deck, versions }: DeckBundle): Map<string, AssetInfo> {
  const all = new Map<string, AssetInfo>();
  for (const d of [deck, ...(versions ?? []).map((v) => v.deck)] as Deck[]) {
    for (const [id, info] of Object.entries(d.assets)) if (!all.has(id)) all.set(id, info);
  }
  return all;
}

async function assertAssetsMatch(bundle: DeckBundle): Promise<void> {
  const { assets } = bundle;
  const registered = registeredAssets(bundle);
  for (const [id, info] of registered) {
    const bytes = assets.get(id);
    const label = info.name ? `"${info.name}" (${id})` : id;
    if (!bytes) throw new FormatError("INCONSISTENT", `No bytes provided for asset ${label}`);
    if ((await sha256Hex(bytes)) !== id) {
      throw new FormatError("INCONSISTENT", `Bytes for asset ${label} don't match its SHA-256 ID`);
    }
  }
  for (const id of assets.keys()) {
    if (!registered.has(id)) {
      throw new FormatError(
        "INCONSISTENT",
        `Bytes were provided for asset ${id}, which isn't registered in the deck (add it with asset.add)`,
      );
    }
  }
}
