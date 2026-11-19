/**
 * Image optimization on import (D67): the smallest file that still looks identical.
 *
 * 1. **Resize** anything larger than 3840 px on its long side (twice a 1920 px slide: sharp
 *    when zoomed in and in 4K exports). Never enlarged. This is the biggest saving.
 * 2. **Search each image's own quality.** Tiles sampled at full resolution (the most
 *    detailed areas plus a smooth one, see `sample.ts`) are encoded at a quality, decoded
 *    and compared with SSIM; a binary search finds the lowest quality that still scores as
 *    identical. A grainy photo needs about q88, a clean one about q75: one fixed setting
 *    would waste bytes on one and smear the other.
 * 3. **WebP, lossy or lossless, whichever is smaller:** lossy for photos; lossless competes
 *    for lossless sources (screenshots, logos, where it's often smaller and exact). Every
 *    Veloce renderer is Chromium, so WebP shows everywhere. MozJPEG was measured too: at the
 *    same score WebP was 20–40% smaller on 6 of 7 test photos, and searching both cost 0.8 s
 *    per image, so JPEG isn't tried. Only the winner is encoded at full size (both when the
 *    tiles say it's close).
 * 4. **Keep the original** if the result isn't clearly smaller, or for what can't be
 *    optimized safely (animations, CMYK, SVG, GIF, anything already small).
 *
 * The color profile is carried over; EXIF (camera data, GPS location) and thumbnails are
 * dropped, and the pixels are turned upright first.
 */
import { type Codecs, codecs, type Pixels } from "./codecs.ts";
import {
  formatOf,
  type ImageFormat,
  iccProfile,
  isLosslessWebp,
  unsupported,
  withIcc,
} from "./container.ts";
import { sampleTiles } from "./sample.ts";
import { similarity } from "./ssim.ts";

/** The longest side an imported image keeps: twice the 1920 px stage. */
export const MAX_EDGE = 3840;
/** The SSIM score that reads as identical (calibrated by eye at 2× zoom on real photos). */
export const TARGET_SCORE = 0.94;
/** Files this small are left alone: there's little to win. */
export const MIN_BYTES = 32 * 1024;
/** An optimized file must be at least this much smaller to replace the original. */
const MIN_SAVING = 0.1;
/** Larger images aren't decoded at all (a 50 MP RGBA image is 200 MB of memory). */
const MAX_PIXELS = 50_000_000;
const QUALITY = { min: 55, max: 95 };
/** Stop searching when the quality is known to within this many steps. */
const PRECISION = 3;
/** Two predictions this close are both encoded in full (tiles can't tell them apart). */
const CLOSE_CALL = 0.1;

export type Method = "webp" | "webp-lossless";

export interface Optimized {
  bytes: Uint8Array;
  mime: "image/webp";
  /** As shown (upright). */
  width: number;
  height: number;
  /** The size before resizing, if it was resized. */
  resizedFrom?: { width: number; height: number };
  method: Method;
  /** The quality the search settled on (lossy methods). */
  quality?: number;
}

export type OptimizeResult = { optimized: Optimized } | { kept: string };

interface Candidate {
  method: Method;
  quality?: number;
  /** Encoded size of the tiles: what the choice between candidates is based on. */
  tileBytes: number;
  passed: boolean;
}

/**
 * Optimize one image file. `size` is its pixel size if already known (it guards against
 * decoding something huge). Never throws for a bad image: it's kept as it is.
 */
export async function optimizeImage(
  input: Uint8Array,
  size?: { width?: number; height?: number },
): Promise<OptimizeResult> {
  const reason = unsupported(input);
  if (reason) return { kept: reason };
  if (size?.width && size.height && size.width * size.height > MAX_PIXELS) {
    return { kept: "too large to optimize" };
  }
  const format = formatOf(input) as ImageFormat;
  const c = await codecs();

  let pixels: Pixels;
  try {
    pixels = await decode(c, format, input);
  } catch {
    return { kept: "couldn't be decoded" };
  }
  const original = { width: pixels.width, height: pixels.height };
  const scale = Math.min(1, MAX_EDGE / Math.max(pixels.width, pixels.height));
  const resized = scale < 1;
  if (!resized && input.length < MIN_BYTES) return { kept: "already small" };
  if (resized) {
    pixels = await c.resize(
      pixels,
      Math.max(1, Math.round(pixels.width * scale)),
      Math.max(1, Math.round(pixels.height * scale)),
    );
  }

  const lossless = format === "png" || (format === "webp" && isLosslessWebp(input));
  const tiles = sampleTiles(pixels);
  // Sharp RGB→YUV keeps thin colored edges (text, UI) crisp; photos don't need its cost.
  const sharp = lossless;
  const candidates: Candidate[] = [await search(c, tiles, sharp)];
  if (lossless) {
    const bytes = await c.encodeWebp(tiles, { quality: 100, lossless: true });
    candidates.push({ method: "webp-lossless", tileBytes: bytes.length, passed: true });
  }

  let pool = candidates.filter((k) => k.passed);
  if (pool.length === 0) {
    // Nothing looks identical even at q95 (a source already full of artifacts). A resize
    // still has to be saved somehow: the best-looking setting. Otherwise keep the original.
    if (!resized) return { kept: "can't be made smaller without a visible change" };
    pool = candidates;
  }
  pool.sort((a, b) => a.tileBytes - b.tileBytes);
  const best = pool[0] as Candidate;
  const finalists = pool.filter((k) => k.tileBytes <= best.tileBytes * (1 + CLOSE_CALL));

  let winner: { candidate: Candidate; bytes: Uint8Array } | null = null;
  for (const candidate of finalists) {
    const bytes = await encode(c, pixels, candidate, sharp);
    if (!winner || bytes.length < winner.bytes.length) winner = { candidate, bytes };
  }
  if (!winner) return { kept: "nothing to encode" };

  const icc = iccProfile(input);
  let bytes = icc ? withIcc(winner.bytes, icc, pixels.width, pixels.height) : winner.bytes;
  const limit = resized ? input.length : input.length * (1 - MIN_SAVING);
  if (bytes.length >= limit) return { kept: "already optimized" };
  bytes = new Uint8Array(bytes); // its own buffer, so it can be transferred
  return {
    optimized: {
      bytes,
      mime: "image/webp",
      width: pixels.width,
      height: pixels.height,
      ...(resized && { resizedFrom: original }),
      method: winner.candidate.method,
      ...(winner.candidate.method === "webp" && { quality: winner.candidate.quality }),
    },
  };
}

function decode(c: Codecs, format: ImageFormat, bytes: Uint8Array): Promise<Pixels> {
  if (format === "jpeg") return c.decodeJpeg(bytes);
  if (format === "png") return c.decodePng(bytes);
  return c.decodeWebp(bytes);
}

function encode(c: Codecs, pixels: Pixels, k: Candidate, sharp: boolean): Promise<Uint8Array> {
  if (k.method === "webp-lossless") return c.encodeWebp(pixels, { quality: 100, lossless: true });
  return c.encodeWebp(pixels, { quality: k.quality ?? QUALITY.max, sharp });
}

/**
 * The lowest WebP quality whose tiles still score as identical (binary search, 5 encodes of
 * a 768 × 512 sample). `passed` is false if even the top quality doesn't.
 */
async function search(c: Codecs, tiles: Pixels, sharp: boolean): Promise<Candidate> {
  const method = "webp";
  const test = async (quality: number) => {
    const bytes = await encode(c, tiles, { method, quality, tileBytes: 0, passed: true }, sharp);
    const score = similarity(tiles, await c.decodeWebp(bytes)).score;
    return { quality, size: bytes.length, ok: score >= TARGET_SCORE };
  };
  const top = await test(QUALITY.max);
  if (!top.ok) return { method, quality: top.quality, tileBytes: top.size, passed: false };
  let best = top;
  let lo = QUALITY.min - 1; // fails (assumed)
  let hi = QUALITY.max; // passes
  while (hi - lo > PRECISION) {
    const mid = Math.round((lo + hi) / 2);
    const result = await test(mid);
    if (result.ok) {
      hi = mid;
      best = result;
    } else {
      lo = mid;
    }
  }
  return { method, quality: best.quality, tileBytes: best.size, passed: true };
}
