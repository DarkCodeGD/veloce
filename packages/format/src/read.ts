/**
 * Reading .veloce files, treating every file as untrusted input from a stranger.
 *
 * Defenses:
 * - Path checks: no absolute paths, `..`, backslashes or NUL bytes in entry names.
 * - Size caps on entry count, each entry and the total, checked against the zip's declared sizes
 *   *and* the actual decompressed sizes (declared sizes can lie).
 * - Only known entries are extracted; anything else is skipped with a warning.
 * - Every asset's bytes are re-hashed and must match their SHA-256 ID (detects corruption and tampering).
 * - The document is migrated to the current format, then fully validated before it's returned.
 * - Saved versions (D93) get the same treatment, but a bad one is only skipped with a warning:
 *   the deck itself is what has to open.
 *
 * Note: this reads the whole archive into memory (fflate `unzipSync`). Fine for typical decks;
 * switch to fflate's streaming `Unzip` if multi-GB video decks become common.
 */
import {
  type ApplyContext,
  type Deck,
  type DeckVersion,
  FORMAT_VERSION,
  ID_PATTERN,
  MAX_VERSIONS,
  sha256Hex,
  VersionNameSchema,
  validateDeck,
} from "@veloce/core";
import { strFromU8, type UnzipFileInfo, unzipSync } from "fflate";
import { z } from "zod";
import type { ReadResult } from "./bundle.js";
import { DEFAULT_READ_LIMITS, PATHS, type ReadLimits } from "./constants.js";
import { FormatError } from "./errors.js";
import { type Manifest, ManifestSchema, type PluginsLock, PluginsLockSchema } from "./manifest.js";
import { migrateDocument, type RawDocument } from "./migrations.js";

export interface ReadOptions {
  limits?: Partial<ReadLimits>;
  /** Pass the plugin registry's `validateElement` to check element props while loading. */
  context?: ApplyContext;
}

const JSON_PATHS: ReadonlySet<string> = new Set([
  PATHS.manifest,
  PATHS.document,
  PATHS.theme,
  PATHS.plugins,
]);
const ASSET_PATH = /^assets\/([0-9a-f]{64})\.[a-z0-9]{1,8}$/;
const FALLBACK_PATH = /^fallbacks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.png$/;
const VERSION_PATH = /^versions\/(vr_[a-z0-9]{10})\.json$/;
const SAVED_AT = z.iso.datetime();

export async function readVeloce(
  bytes: Uint8Array,
  options: ReadOptions = {},
): Promise<ReadResult> {
  const limits = { ...DEFAULT_READ_LIMITS, ...options.limits };
  const warnings: string[] = [];
  const entries = unzip(bytes, limits, warnings);

  // ── Manifest ──
  const manifestBytes = entries[PATHS.manifest];
  if (!manifestBytes)
    throw new FormatError("NOT_VELOCE", "Not a .veloce file: manifest.json is missing");
  const manifest = ManifestSchema.safeParse(parseJson(manifestBytes, PATHS.manifest));
  if (!manifest.success) {
    throw new FormatError(
      "NOT_VELOCE",
      "Not a .veloce file: manifest.json isn't a Veloce manifest",
    );
  }
  const { formatVersion } = manifest.data;

  // ── Document (+ theme) → migrate → validate ──
  const document = parseJsonObject(entries, PATHS.document);
  const theme = parseJsonObject(entries, PATHS.theme);
  if (document.formatVersion !== formatVersion) {
    throw new FormatError(
      "CORRUPT",
      `document.json says format version ${String(document.formatVersion)} but the manifest says ${formatVersion}`,
    );
  }
  const migrated = migrateDocument({ ...document, theme }, formatVersion);
  const validation = validateDeck(migrated, options.context);
  if (!validation.ok) {
    const summary = validation.errors
      .slice(0, 3)
      .map((e) => e.message)
      .join("; ");
    throw new FormatError(
      "INVALID_DOCUMENT",
      `The deck in this file is invalid: ${summary}`,
      validation.errors,
    );
  }
  warnings.push(...validation.warnings.map((w) => w.message));
  const { deck } = validation;

  // ── Assets: every registered asset must be present and intact ──
  const assetFiles = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    const id = ASSET_PATH.exec(path)?.[1];
    if (id) assetFiles.set(id, data);
  }
  const assets = new Map<string, Uint8Array>();
  for (const [id, info] of Object.entries(deck.assets)) {
    const data = assetFiles.get(id);
    const label = info.name ? `"${info.name}" (${id})` : id;
    if (!data) throw new FormatError("CORRUPT", `Asset ${label} is missing from the file`);
    if ((await sha256Hex(data)) !== id) {
      throw new FormatError(
        "CORRUPT",
        `Asset ${label} is damaged: its contents don't match its checksum`,
      );
    }
    if (data.length !== info.bytes)
      warnings.push(`Asset ${label}: recorded size differs from the actual size`);
    assets.set(id, data);
  }
  // ── Versions: each checked like the deck, with the assets it registers ──
  const versions = await readVersions(entries, assetFiles, assets, options.context, warnings);

  for (const id of assetFiles.keys()) {
    if (!assets.has(id)) warnings.push(`Ignored asset file ${id}: it isn't registered in the deck`);
  }

  // ── Optional parts ──
  const fallbacks = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    const nodeId = FALLBACK_PATH.exec(path)?.[1];
    if (nodeId) fallbacks.set(nodeId, data);
  }

  let plugins: PluginsLock = {};
  const lockBytes = entries[PATHS.plugins];
  if (lockBytes) {
    const lock = PluginsLockSchema.safeParse(parseJson(lockBytes, PATHS.plugins));
    if (lock.success) plugins = lock.data;
    else warnings.push("Ignored plugins.lock.json: it isn't valid");
  }

  const preview = entries[PATHS.preview];
  return {
    deck,
    assets,
    versions,
    plugins,
    fallbacks,
    manifest: manifest.data,
    warnings,
    ...(preview && { preview }),
    ...(formatVersion < FORMAT_VERSION && { migratedFrom: formatVersion }),
  };
}

// ── Versions ────────────────────────────────────────────────────────────────────────

/**
 * The file's saved versions, oldest first (D93). A version that isn't JSON, is too new,
 * invalid, or misses an asset is skipped with a warning. The assets they register are added
 * to `assets` (each verified once).
 */
async function readVersions(
  entries: Record<string, Uint8Array>,
  assetFiles: ReadonlyMap<string, Uint8Array>,
  assets: Map<string, Uint8Array>,
  context: ApplyContext | undefined,
  warnings: string[],
): Promise<DeckVersion[]> {
  const versions: DeckVersion[] = [];
  /** Version-only assets already hashed: each file is checked once, however many use it. */
  const checked = new Map<string, boolean>();
  for (const [path, data] of Object.entries(entries)) {
    const id = VERSION_PATH.exec(path)?.[1];
    if (!id) continue;
    const skip = (why: string) => warnings.push(`Skipped version ${id}: ${why}`);
    let raw: unknown;
    try {
      raw = JSON.parse(strFromU8(data));
    } catch {
      skip("it isn't valid JSON");
      continue;
    }
    const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const name = VersionNameSchema.safeParse(value.name);
    const savedAt = SAVED_AT.safeParse(value.savedAt);
    const document = value.deck as RawDocument | undefined;
    if (!name.success || !savedAt.success || typeof document !== "object" || document === null) {
      skip("it has no name, date or deck");
      continue;
    }
    let deck: Deck;
    try {
      const from = typeof document.formatVersion === "number" ? document.formatVersion : 0;
      const validation = validateDeck(migrateDocument(document, from), context);
      if (!validation.ok) {
        skip(`its deck is invalid (${validation.errors[0]?.message})`);
        continue;
      }
      deck = validation.deck;
    } catch (error) {
      skip(error instanceof Error ? error.message : String(error));
      continue;
    }
    const missing = await missingAsset(deck, assetFiles, assets, checked);
    if (missing) {
      skip(missing);
      continue;
    }
    versions.push({ id, name: name.data, savedAt: savedAt.data, deck });
  }
  versions.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  if (versions.length > MAX_VERSIONS) {
    warnings.push(`Kept the newest ${MAX_VERSIONS} of ${versions.length} versions`);
    versions.splice(0, versions.length - MAX_VERSIONS);
  }
  // Only the assets of versions kept (and of the deck) stay.
  const used = new Set<string>();
  for (const d of versions.map((v) => v.deck)) for (const id of Object.keys(d.assets)) used.add(id);
  for (const id of used) {
    const bytes = assetFiles.get(id);
    if (bytes && !assets.has(id)) assets.set(id, bytes);
  }
  return versions;
}

/** Why a version's assets can't all be used (missing or damaged), or null if they can. */
async function missingAsset(
  deck: Deck,
  assetFiles: ReadonlyMap<string, Uint8Array>,
  verified: ReadonlyMap<string, Uint8Array>,
  checked: Map<string, boolean>,
): Promise<string | null> {
  for (const id of Object.keys(deck.assets)) {
    if (verified.has(id)) continue;
    const data = assetFiles.get(id);
    if (!data) return `asset ${id} is missing from the file`;
    let intact = checked.get(id);
    if (intact === undefined) {
      intact = (await sha256Hex(data)) === id;
      checked.set(id, intact);
    }
    if (!intact) return `asset ${id} is damaged`;
  }
  return null;
}

// ── Quick look ──────────────────────────────────────────────────────────────────────

export interface VeloceInfo {
  manifest: Manifest;
  deckId: string;
  slideCount: number;
}

/**
 * Cheap look at a .veloce file for file lists: reads only the manifest and the document
 * (no assets, no full validation), with the same zip safety checks as `readVeloce`.
 */
export function inspectVeloce(
  bytes: Uint8Array,
  options: Pick<ReadOptions, "limits"> = {},
): VeloceInfo {
  const limits = { ...DEFAULT_READ_LIMITS, ...options.limits };
  const entries = unzip(bytes, limits, [], new Set([PATHS.manifest, PATHS.document]));
  const manifestBytes = entries[PATHS.manifest];
  const manifest =
    manifestBytes && ManifestSchema.safeParse(parseJson(manifestBytes, PATHS.manifest));
  if (!manifest?.success)
    throw new FormatError("NOT_VELOCE", "Not a .veloce file: no valid manifest.json");
  const document = parseJsonObject(entries, PATHS.document);
  if (typeof document.id !== "string" || !ID_PATTERN.test(document.id)) {
    throw new FormatError("CORRUPT", "document.json has no valid deck id");
  }
  return {
    manifest: manifest.data,
    deckId: document.id,
    slideCount: Array.isArray(document.slides) ? document.slides.length : 0,
  };
}

// ── Zip extraction with safety checks ────────────────────────────────────────────────

function unzip(
  bytes: Uint8Array,
  limits: ReadLimits,
  warnings: string[],
  only?: ReadonlySet<string>,
): Record<string, Uint8Array> {
  let count = 0;
  let declaredTotal = 0;
  const filter = (file: UnzipFileInfo): boolean => {
    if (++count > limits.maxEntries) {
      throw new FormatError(
        "UNSAFE",
        `The file has too many entries (more than ${limits.maxEntries})`,
      );
    }
    assertSafePath(file.name);
    if (file.name.endsWith("/")) return false; // directory entry
    if (!isKnownPath(file.name)) {
      warnings.push(`Ignored unknown file "${file.name}"`);
      return false;
    }
    if (only && !only.has(file.name)) return false;
    assertEntrySize(file.name, file.originalSize, limits);
    declaredTotal += file.originalSize;
    assertTotalSize(declaredTotal, limits);
    return true;
  };

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter });
  } catch (error) {
    if (error instanceof FormatError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new FormatError(
      "NOT_VELOCE",
      `Not a .veloce file: couldn't read it as a zip archive (${reason})`,
    );
  }

  // Declared sizes come from the archive itself and can lie, so check what we actually got.
  let actualTotal = 0;
  for (const [name, data] of Object.entries(entries)) {
    assertEntrySize(name, data.length, limits);
    actualTotal += data.length;
    assertTotalSize(actualTotal, limits);
  }
  return entries;
}

function assertSafePath(name: string): void {
  const unsafe =
    name.length === 0 ||
    name.length > 512 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[a-zA-Z]:/.test(name) ||
    name.split("/").some((segment) => segment === ".." || segment === ".");
  if (unsafe)
    throw new FormatError(
      "UNSAFE",
      `The file contains an unsafe path: ${JSON.stringify(name.slice(0, 100))}`,
    );
}

function isKnownPath(name: string): boolean {
  return (
    JSON_PATHS.has(name) ||
    VERSION_PATH.test(name) ||
    name === PATHS.preview ||
    ASSET_PATH.test(name) ||
    FALLBACK_PATH.test(name)
  );
}

function assertEntrySize(name: string, size: number, limits: ReadLimits): void {
  const json = JSON_PATHS.has(name) || VERSION_PATH.test(name);
  const max = json ? limits.maxJsonBytes : limits.maxEntryBytes;
  if (size > max)
    throw new FormatError("UNSAFE", `"${name}" is too large (${size} bytes, limit ${max})`);
}

function assertTotalSize(total: number, limits: ReadLimits): void {
  if (total > limits.maxTotalBytes) {
    throw new FormatError(
      "UNSAFE",
      `The file is too large when unpacked (limit ${limits.maxTotalBytes} bytes)`,
    );
  }
}

// ── JSON ─────────────────────────────────────────────────────────────────────────────

function parseJson(data: Uint8Array, name: string): unknown {
  try {
    return JSON.parse(strFromU8(data));
  } catch {
    throw new FormatError("CORRUPT", `${name} isn't valid JSON`);
  }
}

function parseJsonObject(entries: Record<string, Uint8Array>, name: string): RawDocument {
  const data = entries[name];
  if (!data) throw new FormatError("CORRUPT", `${name} is missing from the file`);
  const value = parseJson(data, name);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FormatError("CORRUPT", `${name} must contain a JSON object`);
  }
  return value as RawDocument;
}
