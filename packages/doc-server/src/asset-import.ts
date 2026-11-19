/**
 * What an uploaded file really is. The server decides, from the bytes, never from the
 * client's file name or claimed type: magic numbers pick the MIME type, image headers give
 * the pixel size, and a font's own `name`, `OS/2` and `fvar` tables give its family, weight
 * and style (WOFF and WOFF2 are decompressed with hard output caps, so a crafted file can't
 * balloon). Anything else is refused with a message that says what is accepted.
 *
 * Images: PNG, JPEG, GIF, WebP, AVIF, SVG (SVGs are only ever shown through <img> and served
 * sandboxed, so their scripts never run). Fonts: TTF, OTF, WOFF, WOFF2 (not collections).
 */
import { brotliDecompressSync, inflateSync } from "node:zlib";
import { type AssetInfo, type FontCategory, MAX_ASSET_BYTES } from "@veloce/core";
import { displaySize, jpegOrientation } from "@veloce/images";

export type InspectResult = { ok: true; info: AssetInfo } | { ok: false; message: string };

const ACCEPTED = "PNG, JPEG, GIF, WebP, AVIF or SVG images, and TTF, OTF, WOFF or WOFF2 fonts";
/** Decompressed font data is capped well above any real font. */
const MAX_FONT_BYTES = 64 * 1024 ** 2;
const MAX_NAME = 255;

export function inspectAsset(bytes: Uint8Array, fileName?: string): InspectResult {
  if (bytes.length === 0) return { ok: false, message: "The file is empty" };
  if (bytes.length > MAX_ASSET_BYTES) {
    return {
      ok: false,
      message: `The file is ${mib(bytes.length)}; assets can be at most ${mib(MAX_ASSET_BYTES)}`,
    };
  }
  const name = cleanFileName(fileName);
  const base = { bytes: bytes.length, ...(name && { name }) };
  const image = sniffImage(bytes);
  if (image) return { ok: true, info: { ...base, ...image } };
  const font = sniffFont(bytes);
  if (font) {
    if ("error" in font) return { ok: false, message: font.error };
    const family = font.family ?? familyFromFileName(name);
    return {
      ok: true,
      info: {
        ...base,
        mime: font.mime,
        ...(family && {
          font: {
            family,
            ...(font.weight !== undefined && { weight: font.weight }),
            ...(font.italic && { style: "italic" as const }),
            ...(font.category && { category: font.category }),
          },
        }),
      },
    };
  }
  return { ok: false, message: `Unsupported file type. Veloce imports ${ACCEPTED}.` };
}

const mib = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MiB`;

// ── Bytes ───────────────────────────────────────────────────────────────────────────────

class Reader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  has(offset: number, length: number) {
    return offset >= 0 && length >= 0 && offset + length <= this.bytes.length;
  }
  u8 = (o: number) => this.view.getUint8(o);
  u16 = (o: number) => this.view.getUint16(o);
  u16le = (o: number) => this.view.getUint16(o, true);
  u24le = (o: number) => this.u16le(o) | (this.u8(o + 2) << 16);
  u32 = (o: number) => this.view.getUint32(o);
  i32 = (o: number) => this.view.getInt32(o);
  tag = (o: number) => String.fromCharCode(...this.bytes.subarray(o, o + 4));
  startsWith(signature: readonly number[], at = 0) {
    return this.has(at, signature.length) && signature.every((b, i) => this.bytes[at + i] === b);
  }
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** Only sizes a renderer could actually use (and the schema accepts). */
const size = (width: number, height: number) =>
  width > 0 && height > 0 && width <= 100_000 && height <= 100_000
    ? { width: Math.round(width), height: Math.round(height) }
    : {};

// ── Images ──────────────────────────────────────────────────────────────────────────────

type ImageInfo = Pick<AssetInfo, "mime" | "width" | "height">;

function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const r = new Reader(bytes);
  try {
    if (r.startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return { mime: "image/png", ...(r.has(16, 8) && size(r.u32(16), r.u32(20))) };
    }
    if (r.startsWith([0xff, 0xd8, 0xff])) {
      // As shown: a phone photo stored sideways says "turn it" in EXIF, and browsers do.
      const stored = jpegSize(r);
      if (!stored.width || !stored.height) return { mime: "image/jpeg" };
      const shown = displaySize(stored.width, stored.height, jpegOrientation(bytes));
      return { mime: "image/jpeg", ...shown };
    }
    if (r.startsWith(ascii("GIF87a")) || r.startsWith(ascii("GIF89a"))) {
      return { mime: "image/gif", ...(r.has(6, 4) && size(r.u16le(6), r.u16le(8))) };
    }
    if (r.startsWith(ascii("RIFF")) && r.startsWith(ascii("WEBP"), 8)) {
      return { mime: "image/webp", ...webpSize(r) };
    }
    if (r.startsWith(ascii("ftyp"), 4) && isAvif(r)) return { mime: "image/avif", ...avifSize(r) };
    const svg = svgInfo(bytes);
    if (svg) return svg;
  } catch {
    // A truncated header: not a usable image.
  }
  return null;
}

function jpegSize(r: Reader) {
  let o = 2;
  while (r.has(o, 4)) {
    if (r.u8(o) !== 0xff) return {};
    const marker = r.u8(o + 1);
    if (marker === 0xff) {
      o++; // fill byte
      continue;
    }
    const length = r.u16(o + 2);
    // SOF0–SOF15 carry the frame size (C4, C8 and CC are other segments).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return r.has(o + 5, 4) ? size(r.u16(o + 7), r.u16(o + 5)) : {};
    }
    if (marker === 0xda || length < 2) return {}; // image data starts: no frame header found
    o += 2 + length;
  }
  return {};
}

function webpSize(r: Reader) {
  const chunk = r.tag(12);
  if (chunk === "VP8 " && r.has(26, 4)) {
    return size(r.u16le(26) & 0x3fff, r.u16le(28) & 0x3fff);
  }
  if (chunk === "VP8L" && r.has(21, 4)) {
    const bits = r.view.getUint32(21, true);
    return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X" && r.has(24, 6)) return size(r.u24le(24) + 1, r.u24le(27) + 1);
  return {};
}

function isAvif(r: Reader) {
  const boxSize = r.u32(0);
  if (!r.has(0, Math.min(boxSize, 4096))) return false;
  for (let o = 8; o + 4 <= Math.min(boxSize, 4096); o += 4) {
    if (o === 12) continue; // minor version, not a brand
    const brand = r.tag(o);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

/** AVIF's size lives in an `ispe` property box; it's near the start of the file. */
function avifSize(r: Reader) {
  // "ispe", version/flags, width, height: 16 bytes from the box type on.
  const last = Math.min(r.bytes.length - 16, 64 * 1024);
  for (let o = 0; o <= last; o++) {
    if (r.bytes[o] === 0x69 && r.tag(o) === "ispe") return size(r.u32(o + 8), r.u32(o + 12));
  }
  return {};
}

function svgInfo(bytes: Uint8Array): ImageInfo | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 64 * 1024));
  } catch {
    return null;
  }
  // Skip what may come before the root element: BOM, XML declaration, comments, doctype.
  const head = text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|\s+)*/i, "");
  const tag = /^<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return null;
  const attr = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1]?.trim();
  const px = (value: string | undefined) => {
    const m = value && /^([\d.]+)(px)?$/.exec(value);
    return m ? Number(m[1]) : Number.NaN;
  };
  let width = px(attr("width"));
  let height = px(attr("height"));
  const box = attr("viewBox")
    ?.split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box.every(Number.isFinite)) {
    const [, , w = 0, h = 0] = box;
    if (!(width > 0) && height > 0 && h > 0) width = (height * w) / h;
    else if (!(height > 0) && width > 0 && w > 0) height = (width * h) / w;
    else if (!(width > 0) && !(height > 0)) [width, height] = [w, h];
  }
  return { mime: "image/svg+xml", ...size(width, height) };
}

// ── Fonts ───────────────────────────────────────────────────────────────────────────────

interface FontFacts {
  mime: string;
  family?: string;
  weight?: number | [number, number];
  italic?: boolean;
  category?: FontCategory;
}

/**
 * Serif, sans or monospace, from the OS/2 table: PANOSE first (Latin text faces say their
 * serif style and whether they're monospaced), then the IBM family class. Unknown: none.
 */
function fontCategory(os2: Reader): FontCategory | undefined {
  if (os2.has(32, 10) && os2.u8(32) === 2) {
    if (os2.u8(35) === 9) return "monospace";
    const serifStyle = os2.u8(33);
    if (serifStyle >= 11 && serifStyle <= 13) return "sans-serif";
    if (serifStyle >= 2 && serifStyle <= 10) return "serif";
  }
  const familyClass = os2.has(30, 2) ? os2.u8(30) : 0;
  if (familyClass >= 1 && familyClass <= 7) return "serif";
  if (familyClass === 8) return "sans-serif";
  return undefined;
}

type Tables = Map<string, Uint8Array>;
const WANTED = new Set(["name", "OS/2", "fvar"]);

function sniffFont(bytes: Uint8Array): FontFacts | { error: string } | null {
  const r = new Reader(bytes);
  if (!r.has(0, 4)) return null;
  const signature = r.tag(0);
  const mime =
    signature === "wOF2"
      ? "font/woff2"
      : signature === "wOFF"
        ? "font/woff"
        : signature === "OTTO"
          ? "font/otf"
          : signature === "\u0000\u0001\u0000\u0000" || signature === "true"
            ? "font/ttf"
            : signature === "ttcf"
              ? "collection"
              : null;
  if (!mime) return null;
  if (mime === "collection") {
    return { error: "Font collections (.ttc) aren't supported; import the single fonts instead" };
  }
  let tables: Tables;
  try {
    tables =
      mime === "font/woff2" ? woff2Tables(r) : mime === "font/woff" ? woffTables(r) : sfntTables(r);
  } catch {
    return { error: "This font file is damaged or uses an unsupported layout" };
  }
  return { mime, ...readFontFacts(tables) };
}

function sfntTables(r: Reader): Tables {
  const tables: Tables = new Map();
  const count = r.u16(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = r.tag(at);
    if (!WANTED.has(tag)) continue;
    const offset = r.u32(at + 8);
    const length = r.u32(at + 12);
    if (!r.has(offset, length)) throw new Error("table out of range");
    tables.set(tag, r.bytes.subarray(offset, offset + length));
  }
  return tables;
}

function woffTables(r: Reader): Tables {
  const tables: Tables = new Map();
  const count = r.u16(12);
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const tag = r.tag(at);
    if (!WANTED.has(tag)) continue;
    const offset = r.u32(at + 4);
    const compressed = r.u32(at + 8);
    const length = r.u32(at + 12);
    if (!r.has(offset, compressed) || length > MAX_FONT_BYTES) throw new Error("bad table");
    const data = r.bytes.subarray(offset, offset + compressed);
    tables.set(
      tag,
      compressed < length ? new Uint8Array(inflateSync(data, { maxOutputLength: length })) : data,
    );
  }
  return tables;
}

/** WOFF2's known-table index (spec section 5.1): a table's flags name it by position here. */
// biome-ignore format: a table reads best as a table
const WOFF2_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf",
  "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT",
  "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT",
  "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar",
  "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd",
  "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function woff2Tables(r: Reader): Tables {
  if (r.tag(4) === "ttcf") throw new Error("collection");
  const count = r.u16(12);
  const totalSfnt = r.u32(16);
  const compressedLength = r.u32(20);
  if (totalSfnt > MAX_FONT_BYTES) throw new Error("too big");
  let o = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = r.u8(o++);
      if (i === 0 && byte === 0x80) throw new Error("leading zero");
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error("UIntBase128 too long");
  };
  const directory: Array<{ tag: string; length: number }> = [];
  for (let i = 0; i < count; i++) {
    const flags = r.u8(o++);
    const known = flags & 0x3f;
    let tag: string;
    if (known === 63) {
      tag = r.tag(o);
      o += 4;
    } else {
      tag = WOFF2_TAGS[known] ?? "????";
    }
    const version = (flags >> 6) & 3;
    const original = base128();
    // glyf/loca are transformed unless version 3; every other table only when version ≠ 0.
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    directory.push({ tag, length: transformed ? base128() : original });
  }
  if (!r.has(o, compressedLength)) throw new Error("truncated");
  const stream = new Uint8Array(
    brotliDecompressSync(r.bytes.subarray(o, o + compressedLength), {
      maxOutputLength: MAX_FONT_BYTES,
    }),
  );
  const tables: Tables = new Map();
  let at = 0;
  for (const { tag, length } of directory) {
    if (at + length > stream.length) throw new Error("table out of range");
    if (WANTED.has(tag)) tables.set(tag, stream.subarray(at, at + length));
    at += length;
  }
  return tables;
}

function readFontFacts(tables: Tables): Omit<FontFacts, "mime"> {
  const facts: Omit<FontFacts, "mime"> = {};
  const range = fvarWeight(tables.get("fvar"));
  const name = tables.get("name");
  if (name) {
    const typographic = nameRecord(name, 16);
    let family = typographic ?? nameRecord(name, 1);
    // A variable font without a typographic family (16) often names its default instance in
    // the legacy family (1): "Manrope ExtraLight", "Space Grotesk Light". Its faces are all
    // one family, so the style words go. Static fonts keep theirs ("Archivo Black" is real).
    if (!typographic && range && family) family = family.replace(STYLE_SUFFIX, "") || family;
    const cleaned = cleanFamily(family);
    if (cleaned) facts.family = cleaned;
  }
  const os2 = tables.get("OS/2");
  if (os2 && os2.length >= 64) {
    const r = new Reader(os2);
    const weight = r.u16(4);
    if (weight >= 1 && weight <= 1000) facts.weight = weight;
    const selection = r.u16(62);
    if (selection & 0x1 || selection & 0x200) facts.italic = true;
    const category = fontCategory(r);
    if (category) facts.category = category;
  }
  if (range) facts.weight = range;
  return facts;
}

/**
 * One string from the `name` table: Windows Unicode English first, then any Windows
 * Unicode, then Mac Roman, then Unicode platform.
 */
function nameRecord(table: Uint8Array, nameId: number): string | undefined {
  const r = new Reader(table);
  if (!r.has(0, 6)) return undefined;
  const count = r.u16(2);
  const strings = r.u16(4);
  let best: { rank: number; text: string } | undefined;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (!r.has(at, 12) || r.u16(at + 6) !== nameId) continue;
    const platform = r.u16(at);
    const encoding = r.u16(at + 2);
    const language = r.u16(at + 4);
    const length = r.u16(at + 8);
    const offset = strings + r.u16(at + 10);
    if (!r.has(offset, length)) continue;
    const raw = table.subarray(offset, offset + length);
    let rank: number;
    let text: string;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      rank = language === 0x409 ? 0 : 1;
      text = utf16be(raw);
    } else if (platform === 1 && encoding === 0) {
      rank = 2;
      text = String.fromCharCode(...raw); // Mac Roman ≈ Latin-1 for family names
    } else if (platform === 0) {
      rank = 3;
      text = utf16be(raw);
    } else {
      continue;
    }
    if (!best || rank < best.rank) best = { rank, text };
  }
  return best?.text;
}

function utf16be(raw: Uint8Array): string {
  let text = "";
  for (let i = 0; i + 1 < raw.length; i += 2) {
    text += String.fromCharCode(((raw[i] ?? 0) << 8) | (raw[i + 1] ?? 0));
  }
  return text;
}

/** A variable font's weight axis, as [min, max]. */
function fvarWeight(table: Uint8Array | undefined): [number, number] | undefined {
  if (!table) return undefined;
  const r = new Reader(table);
  if (!r.has(0, 16)) return undefined;
  const axesOffset = r.u16(4);
  const axisCount = r.u16(8);
  const axisSize = r.u16(10);
  for (let i = 0; i < axisCount; i++) {
    const at = axesOffset + i * axisSize;
    if (!r.has(at, 20) || r.tag(at) !== "wght") continue;
    const min = clampWeight(r.i32(at + 4) / 65536);
    const max = clampWeight(r.i32(at + 12) / 65536);
    return min < max ? [min, max] : undefined;
  }
  return undefined;
}

const clampWeight = (w: number) => Math.min(1000, Math.max(1, Math.round(w)));

// ── Names ───────────────────────────────────────────────────────────────────────────────

/** Safe in a CSS font stack: no quotes, backslashes or control characters (see AssetInfo). */
function cleanFamily(name: string | undefined): string | undefined {
  const cleaned = (name ?? "")
    .replace(/["\\]/g, "")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return cleaned || undefined;
}

/** Style words at the end of a font's file name ("-SemiBoldItalic", " Variable", "[wght]"). */
const STYLE_SUFFIX =
  /(?:[-_ ]*(?:\[[^\]]*\]|thin|hairline|extra ?light|ultra ?light|light|regular|normal|book|medium|semi ?bold|demi ?bold|extra ?bold|ultra ?bold|bold|black|heavy|italic|oblique|variable|vf))+$/i;

/**
 * "Acme Sans-SemiBoldItalic.woff2" → "Acme Sans": the fallback for a font without a usable
 * name table. Only known style words are dropped, so "Acme Sans" keeps its "Sans".
 */
function familyFromFileName(name: string | undefined): string | undefined {
  const stem = name?.replace(/\.[^.]+$/, "");
  return cleanFamily(stem?.replace(STYLE_SUFFIX, "") || stem);
}

/** Just the file's own name, without any path, at most 255 characters. */
function cleanFileName(name: string | undefined): string | undefined {
  const base = name
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/\p{Cc}/gu, "")
    .trim();
  return base ? base.slice(0, MAX_NAME) : undefined;
}
