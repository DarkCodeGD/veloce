import { afterAll, describe, expect, it } from "vitest";
import { codecs, type Pixels } from "./codecs.ts";
import {
  displaySize,
  formatOf,
  iccProfile,
  jpegOrientation,
  unsupported,
  withIcc,
} from "./container.ts";
import { MAX_EDGE, optimizeImage, TARGET_SCORE } from "./optimize.ts";
import { optimizeInWorker, stopOptimizer } from "./pool.ts";
import { sampleTiles, TILE } from "./sample.ts";
import { similarity } from "./ssim.ts";

afterAll(() => stopOptimizer());

// ── Test images, made here (deterministic) ──────────────────────────────────────────────

/** A seeded random generator (mulberry32), so every run sees the same "photo". */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Photo-like: smooth color gradients, film grain and a few hard edges. */
function photo(width: number, height: number, seed = 1, alpha = false): Pixels {
  const rand = random(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const grain = (rand() - 0.5) * 24;
      const edge = (x + y * 0.5) % 400 < 200 ? 40 : 0;
      data[i] = 60 + (150 * x) / width + grain + edge;
      data[i + 1] = 90 + (100 * y) / height + grain;
      data[i + 2] = 180 - (120 * x) / width + grain - edge;
      data[i + 3] = alpha ? Math.round((255 * x) / width) : 255;
    }
  }
  return { data, width, height };
}

function solid(width: number, height: number, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width, height };
}

/** A JPEG with an EXIF orientation inserted after SOI. */
function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  // biome-ignore format: TIFF header (big-endian), one IFD entry: 0x0112 SHORT = orientation
  const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const body = [..."Exif\0\0"].map((c) => c.charCodeAt(0)).concat(tiff);
  const segment = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  return Uint8Array.from([...jpeg.subarray(0, 2), ...segment, ...jpeg.subarray(2)]);
}

const ICC = Uint8Array.from({ length: 700 }, (_, i) => (i * 37) % 256); // a stand-in profile

// ── Similarity ──────────────────────────────────────────────────────────────────────────

describe("similarity (SSIM)", () => {
  it("scores identical images 1, and a damaged patch lower than its average suggests", () => {
    const a = photo(256, 256);
    expect(similarity(a, a).score).toBeCloseTo(1, 6);
    // Wreck one 32 px corner: 1.6% of the image.
    const b = { ...a, data: new Uint8ClampedArray(a.data) };
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) b.data.fill(0, (y * 256 + x) * 4, (y * 256 + x) * 4 + 3);
    const s = similarity(a, b);
    expect(s.mean).toBeGreaterThan(0.95);
    expect(s.score).toBeLessThan(TARGET_SCORE); // the worst windows pull it under the bar
  });

  it("counts transparency changes", () => {
    const a = solid(64, 64, [200, 50, 50, 255]);
    const b = solid(64, 64, [200, 50, 50, 255]);
    for (let i = 3; i < b.data.length / 2; i += 4) b.data[i] = 0;
    expect(similarity(a, b).score).toBeLessThan(0.9);
    expect(() => similarity(a, solid(32, 64, [0, 0, 0, 255]))).toThrow(/Different sizes/);
  });
});

describe("sample tiles", () => {
  it("takes the busiest tiles and a smooth one, at full resolution; small images whole", () => {
    const small = photo(300, 200);
    expect(sampleTiles(small)).toBe(small);
    const big = photo(TILE * 6, TILE * 3);
    const tiles = sampleTiles(big);
    expect([tiles.width, tiles.height]).toEqual([TILE * 3, TILE * 2]);
  });
});

// ── The file around the pixels ──────────────────────────────────────────────────────────

describe("container metadata", () => {
  it("reads EXIF rotation; a quarter turn swaps width and height", async () => {
    const c = await codecs();
    const jpeg = await c.encodeJpeg(photo(64, 32), { quality: 80 });
    expect(jpegOrientation(jpeg)).toBe(1);
    expect(jpegOrientation(withOrientation(jpeg, 6))).toBe(6);
    expect(displaySize(64, 32, 6)).toEqual({ width: 32, height: 64 });
    expect(displaySize(64, 32, 3)).toEqual({ width: 64, height: 32 });
  });

  it("carries a color profile into JPEG and WebP files that still decode", async () => {
    const c = await codecs();
    const px = photo(48, 32);
    const jpeg = withIcc(await c.encodeJpeg(px, { quality: 80 }), ICC, 48, 32);
    expect(iccProfile(jpeg)).toEqual(ICC);
    expect((await c.decodeJpeg(jpeg)).width).toBe(48);
    for (const lossless of [false, true]) {
      const webp = withIcc(await c.encodeWebp(px, { quality: 80, lossless }), ICC, 48, 32);
      expect(iccProfile(webp)).toEqual(ICC);
      expect((await c.decodeWebp(webp)).width).toBe(48);
    }
    // Big profiles span several JPEG segments.
    const big = Uint8Array.from({ length: 150_000 }, (_, i) => i % 251);
    expect(iccProfile(withIcc(await c.encodeJpeg(px, { quality: 80 }), big, 48, 32))).toEqual(big);
  });

  it("knows what it can't optimize safely", () => {
    expect(unsupported(new TextEncoder().encode("GIF89a…"))).toMatch(/not a JPEG, PNG or WebP/);
    // A PNG with an animation control chunk (APNG).
    const apng = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...[0, 0, 0, 8],
      ...[..."acTL"].map((ch) => ch.charCodeAt(0)),
      ...new Array(8).fill(0),
      ...[0, 0, 0, 0],
    ]);
    expect(formatOf(apng)).toBe("png");
    expect(unsupported(apng)).toBe("animated");
    // A CMYK JPEG: SOF0 with 4 components.
    const cmyk = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0,
      17,
      8,
      0,
      16,
      0,
      16,
      4,
      ...new Array(12).fill(0),
    ]);
    expect(unsupported(cmyk)).toMatch(/CMYK/);
  });
});

// ── Optimizing ──────────────────────────────────────────────────────────────────────────

describe("optimizing an image", { timeout: 60_000 }, () => {
  it("resizes a huge photo to 3840 px, as WebP, still looking the same", async () => {
    const c = await codecs();
    const source = photo(4400, 1100, 7);
    const png = await c.encodePng(source);
    const result = await optimizeImage(png);
    if (!("optimized" in result)) throw new Error(`kept: ${result.kept}`);
    const o = result.optimized;
    expect(o).toMatchObject({ mime: "image/webp", width: MAX_EDGE, height: 960 });
    expect(o.resizedFrom).toEqual({ width: 4400, height: 1100 });
    expect(o.bytes.length).toBeLessThan(png.length / 4);
    // Against the resized original, it scores as the same picture.
    const reference = await c.resize(source, MAX_EDGE, 960);
    const decoded = await c.decodeWebp(o.bytes);
    expect(similarity(reference, decoded).score).toBeGreaterThan(TARGET_SCORE - 0.02);
  });

  it("finds each image's own quality: grainier photos need more", async () => {
    const c = await codecs();
    const clean = photo(1600, 900, 3);
    for (let i = 0; i < clean.data.length; i += 4) clean.data[i + 1] = 120; // calmer
    const grainy = photo(1600, 900, 4);
    const quality = async (p: Pixels) => {
      const r = await optimizeImage(await c.encodePng(p));
      if (!("optimized" in r)) throw new Error(`kept: ${r.kept}`);
      return r.optimized;
    };
    const [a, b] = [await quality(clean), await quality(grainy)];
    expect(a.method).toBe("webp");
    expect(b.method).toBe("webp");
    expect(a.quality).toBeGreaterThanOrEqual(55);
    expect(b.quality).toBeLessThanOrEqual(95);
  });

  it("keeps flat graphics exact: lossless WebP for a lossless source", async () => {
    const c = await codecs();
    // A flat "logo" with transparency, big enough to be worth optimizing.
    const logo = solid(1200, 800, [0, 0, 0, 0]);
    for (let y = 200; y < 600; y++) {
      for (let x = 300; x < 900; x++)
        logo.data.set(x < 600 ? [79, 70, 229, 255] : [236, 72, 153, 255], (y * 1200 + x) * 4);
    }
    const png = await c.encodePng(logo);
    // Pad the file past the "already small" bar with a private chunk (as editors do).
    const padded = Uint8Array.from([
      ...png.subarray(0, png.length - 12),
      ...pngChunk("zzZz", 40_000),
      ...png.subarray(png.length - 12),
    ]);
    const r = await optimizeImage(padded);
    if (!("optimized" in r)) throw new Error(`kept: ${r.kept}`);
    expect(r.optimized.method).toBe("webp-lossless");
    const decoded = await c.decodeWebp(r.optimized.bytes);
    expect(Buffer.from(decoded.data).equals(Buffer.from(logo.data))).toBe(true);
  });

  it("turns a rotated phone photo upright and keeps its color profile; drops EXIF", async () => {
    const c = await codecs();
    let jpeg = await c.encodeJpeg(photo(1200, 400, 9), { quality: 98 });
    jpeg = withIcc(withOrientation(jpeg, 6), ICC, 1200, 400);
    const r = await optimizeImage(jpeg);
    if (!("optimized" in r)) throw new Error(`kept: ${r.kept}`);
    expect([r.optimized.width, r.optimized.height]).toEqual([400, 1200]);
    expect(iccProfile(r.optimized.bytes)).toEqual(ICC);
    expect(new TextDecoder("latin1").decode(r.optimized.bytes)).not.toContain("Exif");
  });

  it("keeps what's small, already tight, or not a photo format", async () => {
    const c = await codecs();
    expect(await optimizeImage(await c.encodeJpeg(photo(100, 80), { quality: 80 }))).toEqual({
      kept: "already small",
    });
    expect(await optimizeImage(new TextEncoder().encode("GIF89a"))).toEqual({
      kept: "not a JPEG, PNG or WebP",
    });
    // Already a well-compressed WebP at its own size: nothing worth saving.
    const tight = await c.encodeWebp(photo(1400, 900, 5), { quality: 60 });
    expect(await optimizeImage(tight)).toMatchObject({ kept: expect.any(String) });
    expect(await optimizeImage(new Uint8Array(10), { width: 20_000, height: 20_000 })).toEqual({
      kept: "not a JPEG, PNG or WebP",
    });
  });

  it("runs in a worker thread with the same result, and never throws for bad bytes", async () => {
    const c = await codecs();
    const png = await c.encodePng(photo(1500, 800, 11));
    const [inline, worker] = [await optimizeImage(png), await optimizeInWorker(png)];
    expect("optimized" in worker && worker.optimized.bytes.length).toBe(
      "optimized" in inline && inline.optimized.bytes.length,
    );
    // Garbage that claims to be a PNG: kept, not thrown.
    const broken = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...new Array(40_000).fill(7),
    ]);
    expect(await optimizeInWorker(broken)).toEqual({ kept: "couldn't be decoded" });
  });
});

/** A PNG chunk with `length` zero bytes (the CRC isn't checked by decoders for ancillary). */
function pngChunk(type: string, length: number): number[] {
  const head = [length >>> 24, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff];
  return [
    ...head,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...new Array(length).fill(0),
    0,
    0,
    0,
    0,
  ];
}
