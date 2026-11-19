/**
 * What the file around the pixels says, read and written byte by byte (no codec needed):
 *
 * - **Rotation:** phones store a photo sideways and say "turn it" in EXIF. Browsers obey,
 *   so a deck must measure the photo turned too (`displaySize`).
 * - **Color profile (ICC):** a phone's Display P3 photo looks washed out without its
 *   profile, and our encoders don't carry it over, so it's copied into the new file
 *   (`withIcc`). Everything else (EXIF, GPS location, camera data, thumbnails) is dropped.
 * - **What can't be optimized safely:** animated PNG/WebP (the codecs keep one frame) and
 *   CMYK JPEGs (print files the decoder can't convert faithfully).
 */
import { deflateSync, inflateSync } from "node:zlib";

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const tag = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));
const concat = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export type ImageFormat = "jpeg" | "png" | "webp";

export function formatOf(bytes: Uint8Array): ImageFormat | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 8 && tag(bytes, 1) === "PNG\r") return "png";
  if (bytes.length > 12 && tag(bytes, 0) === "RIFF" && tag(bytes, 8) === "WEBP") return "webp";
  return null;
}

// ── JPEG ────────────────────────────────────────────────────────────────────────────────

interface Segment {
  marker: number;
  /** The payload, after the 2-byte length. */
  data: Uint8Array;
}

/** The segments before the image data starts (SOS). */
function jpegSegments(b: Uint8Array): Segment[] {
  const v = view(b);
  const out: Segment[] = [];
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) break;
    const marker = b[o + 1] ?? 0;
    if (marker === 0xff) {
      o++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const length = v.getUint16(o + 2);
    if (length < 2 || o + 2 + length > b.length) break;
    out.push({ marker, data: b.subarray(o + 4, o + 2 + length) });
    o += 2 + length;
  }
  return out;
}

/** EXIF orientation 1–8 (1: as stored), from a JPEG's APP1 segment. */
export function jpegOrientation(b: Uint8Array): number {
  for (const { marker, data } of jpegSegments(b)) {
    if (marker !== 0xe1 || data.length < 14 || tag(data, 0) !== "Exif") continue;
    const tiff = data.subarray(6);
    const v = view(tiff);
    const little = tiff[0] === 0x49;
    const u16 = (o: number) => v.getUint16(o, little);
    const u32 = (o: number) => v.getUint32(o, little);
    try {
      const ifd = u32(4);
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const at = ifd + 2 + i * 12;
        if (u16(at) === 0x0112) {
          const value = u16(at + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
    } catch {
      return 1; // a truncated EXIF block: treat as upright
    }
  }
  return 1;
}

/** Orientations 5–8 turn the picture a quarter: its width and height swap on screen. */
export function displaySize(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

/** True for a 4-channel (CMYK/YCCK) JPEG. */
export function isCmykJpeg(b: Uint8Array): boolean {
  for (const { marker, data } of jpegSegments(b)) {
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return (data[5] ?? 0) === 4;
  }
  return false;
}

const ICC_TAG = ascii("ICC_PROFILE\0");

function jpegIcc(b: Uint8Array): Uint8Array | null {
  // A profile larger than a segment is split into numbered chunks (APP2 "ICC_PROFILE").
  const chunks: Array<{ seq: number; data: Uint8Array }> = [];
  for (const { marker, data } of jpegSegments(b)) {
    if (marker !== 0xe2 || data.length < 14) continue;
    if (!ICC_TAG.every((c, i) => data[i] === c)) continue;
    chunks.push({ seq: data[12] ?? 0, data: data.subarray(14) });
  }
  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  return concat(chunks.map((c) => c.data));
}

function jpegWithIcc(b: Uint8Array, icc: Uint8Array): Uint8Array {
  const MAX = 65519; // 65535 − length (2) − "ICC_PROFILE\0" (12) − sequence numbers (2)
  const count = Math.ceil(icc.length / MAX);
  const segments: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const part = icc.subarray(i * MAX, (i + 1) * MAX);
    const head = new Uint8Array(4 + ICC_TAG.length + 2);
    const v = view(head);
    head[0] = 0xff;
    head[1] = 0xe2;
    v.setUint16(2, 2 + ICC_TAG.length + 2 + part.length);
    head.set(ICC_TAG, 4);
    head[4 + ICC_TAG.length] = i + 1;
    head[5 + ICC_TAG.length] = count;
    segments.push(head, part);
  }
  // Right after SOI (and JFIF's APP0, if the encoder wrote one).
  let at = 2;
  if (b[2] === 0xff && b[3] === 0xe0) at = 4 + view(b).getUint16(4);
  return concat([b.subarray(0, at), ...segments, b.subarray(at)]);
}

// ── PNG ─────────────────────────────────────────────────────────────────────────────────

function pngChunks(b: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const v = view(b);
  const out: Array<{ type: string; data: Uint8Array }> = [];
  for (let o = 8; o + 12 <= b.length; ) {
    const length = v.getUint32(o);
    const type = tag(b, o + 4);
    if (o + 12 + length > b.length) break;
    out.push({ type, data: b.subarray(o + 8, o + 8 + length) });
    if (type === "IEND") break;
    o += 12 + length;
  }
  return out;
}

function pngIcc(b: Uint8Array): Uint8Array | null {
  const chunk = pngChunks(b).find((c) => c.type === "iCCP");
  if (!chunk) return null;
  const nameEnd = chunk.data.indexOf(0);
  if (nameEnd < 0 || chunk.data[nameEnd + 1] !== 0) return null; // 0 = deflate
  try {
    return new Uint8Array(
      inflateSync(chunk.data.subarray(nameEnd + 2), { maxOutputLength: 4 << 20 }),
    );
  } catch {
    return null;
  }
}

// ── WebP ────────────────────────────────────────────────────────────────────────────────

function webpChunks(b: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const v = view(b);
  const out: Array<{ type: string; data: Uint8Array }> = [];
  for (let o = 12; o + 8 <= b.length; ) {
    const type = tag(b, o);
    const length = v.getUint32(o + 4, true);
    if (o + 8 + length > b.length) break;
    out.push({ type, data: b.subarray(o + 8, o + 8 + length) });
    o += 8 + length + (length & 1);
  }
  return out;
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  head.set(ascii(type));
  view(head).setUint32(4, data.length, true);
  return concat([head, data, data.length & 1 ? new Uint8Array(1) : new Uint8Array(0)]);
}

/** WebP with the ICC profile: an extended (VP8X) file with an ICCP chunk. */
function webpWithIcc(b: Uint8Array, icc: Uint8Array, width: number, height: number): Uint8Array {
  const chunks = webpChunks(b).filter((c) => c.type !== "VP8X" && c.type !== "ICCP");
  const hasAlpha = chunks.some((c) => c.type === "ALPH") || alphaInLossless(chunks);
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x20 | (hasAlpha ? 0x10 : 0); // ICC profile, alpha
  const w = width - 1;
  const h = height - 1;
  vp8x.set(
    [w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff],
    4,
  );
  const body = concat([
    ascii("WEBP"),
    riffChunk("VP8X", vp8x),
    riffChunk("ICCP", icc),
    ...chunks.map((c) => riffChunk(c.type, c.data)),
  ]);
  const head = new Uint8Array(8);
  head.set(ascii("RIFF"));
  view(head).setUint32(4, body.length, true);
  return concat([head, body]);
}

/** A lossless (VP8L) bitstream says in its header whether it uses alpha. */
function alphaInLossless(chunks: ReadonlyArray<{ type: string; data: Uint8Array }>): boolean {
  const vp8l = chunks.find((c) => c.type === "VP8L")?.data;
  return vp8l !== undefined && vp8l.length >= 5 && ((vp8l[4] ?? 0) & 0x10) !== 0;
}

// ── Any format ──────────────────────────────────────────────────────────────────────────

/** The embedded color profile, if any. */
export function iccProfile(bytes: Uint8Array): Uint8Array | null {
  switch (formatOf(bytes)) {
    case "jpeg":
      return jpegIcc(bytes);
    case "png":
      return pngIcc(bytes);
    case "webp":
      return webpChunks(bytes).find((c) => c.type === "ICCP")?.data ?? null;
    default:
      return null;
  }
}

/** `bytes` (our encoder's output, JPEG or WebP) carrying `icc`. */
export function withIcc(bytes: Uint8Array, icc: Uint8Array, width: number, height: number) {
  const format = formatOf(bytes);
  if (format === "jpeg") return jpegWithIcc(bytes, icc);
  if (format === "webp") return webpWithIcc(bytes, icc, width, height);
  return bytes;
}

/** A WebP whose image is a lossless (VP8L) bitstream: a screenshot or graphic, usually. */
export function isLosslessWebp(bytes: Uint8Array): boolean {
  return formatOf(bytes) === "webp" && webpChunks(bytes).some((c) => c.type === "VP8L");
}

/** Why this file is left as it is, or null if it can be optimized. */
export function unsupported(bytes: Uint8Array): string | null {
  const format = formatOf(bytes);
  if (!format) return "not a JPEG, PNG or WebP";
  if (format === "png" && pngChunks(bytes).some((c) => c.type === "acTL")) return "animated";
  if (format === "webp") {
    const vp8x = webpChunks(bytes).find((c) => c.type === "VP8X")?.data;
    if (vp8x && ((vp8x[0] ?? 0) & 0x02) !== 0) return "animated";
  }
  if (format === "jpeg" && isCmykJpeg(bytes)) return "a CMYK (print) JPEG";
  return null;
}

/** A PNG's iCCP chunk for `icc` (tests build profiled PNGs with it). */
export function pngIccChunk(icc: Uint8Array): Uint8Array {
  return concat([ascii("icc\0\0"), new Uint8Array(deflateSync(icc))]);
}
