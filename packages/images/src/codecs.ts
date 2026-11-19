/// <reference path="./globals.d.ts" />
/**
 * The image codecs, loaded once and only when an image is first optimized: MozJPEG, libwebp,
 * the PNG codec and the Lanczos resizer, all WebAssembly builds from jSquash (the
 * Squoosh codecs, Apache-2.0 wrappers around BSD/MIT code). Pure WebAssembly means no native
 * binaries to build per OS, in Node and in Electron alike.
 *
 * jSquash fetches its `.wasm` files by URL, which Node can't do, so each module is compiled
 * here from the file next to its JavaScript and handed over.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** The codecs return and take `ImageData`, which Node doesn't have: a minimal stand-in. */
class NodeImageData {
  readonly colorSpace = "srgb";
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}
const g = globalThis as { ImageData?: unknown };

/** RGBA pixels, 8 bits per channel, row by row. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const compile = async (file: string) =>
  WebAssembly.compile(await readFile(require.resolve(`@jsquash/${file}`)));

export interface JpegOptions {
  quality: number;
}
export interface WebpOptions {
  quality: number;
  lossless?: boolean;
  /** Sharp RGB→YUV: crisper thin colored edges (text, UI), ~15% slower and larger. */
  sharp?: boolean;
}

export interface Codecs {
  decodeJpeg(bytes: Uint8Array): Promise<Pixels>;
  decodePng(bytes: Uint8Array): Promise<Pixels>;
  decodeWebp(bytes: Uint8Array): Promise<Pixels>;
  encodeJpeg(pixels: Pixels, options: JpegOptions): Promise<Uint8Array>;
  encodeWebp(pixels: Pixels, options: WebpOptions): Promise<Uint8Array>;
  /** A plain lossless PNG (tests and tools; imports use WebP lossless, which is smaller). */
  encodePng(pixels: Pixels): Promise<Uint8Array>;
  resize(pixels: Pixels, width: number, height: number): Promise<Pixels>;
}

let loading: Promise<Codecs> | null = null;

/** The codecs, compiled on first use (a few hundred ms, once per process). */
export function codecs(): Promise<Codecs> {
  loading ??= load().catch((error: unknown) => {
    loading = null; // a later import may try again
    throw error;
  });
  return loading;
}

async function load(): Promise<Codecs> {
  // Installed only once codecs load, so importing this package (the server does, for the
  // worker pool) never changes the host's globals; in practice it's the worker's.
  if (typeof g.ImageData === "undefined") g.ImageData = NodeImageData;
  const [jpegDec, jpegEnc, webpDec, webpEnc, pngDec, pngEnc, resize] = await Promise.all([
    import("@jsquash/jpeg/decode.js"),
    import("@jsquash/jpeg/encode.js"),
    import("@jsquash/webp/decode.js"),
    import("@jsquash/webp/encode.js"),
    import("@jsquash/png/decode.js"),
    import("@jsquash/png/encode.js"),
    import("@jsquash/resize"),
  ]);
  await Promise.all([
    jpegDec.init(await compile("jpeg/codec/dec/mozjpeg_dec.wasm")),
    jpegEnc.init(await compile("jpeg/codec/enc/mozjpeg_enc.wasm")),
    webpDec.init(await compile("webp/codec/dec/webp_dec.wasm")),
    // Node 22+ always has Wasm SIMD, which is the build jSquash picks there.
    webpEnc.init(await compile("webp/codec/enc/webp_enc_simd.wasm")),
    pngDec.init(await compile("png/codec/pkg/squoosh_png_bg.wasm")),
    resize.initResize(await compile("resize/lib/resize/pkg/squoosh_resize_bg.wasm")),
  ]);
  const buffer = (bytes: Uint8Array) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // A real ImageData (ours, in Node), never a look-alike object.
  const ImageDataCtor = g.ImageData as new (
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ) => ImageData;
  const asImageData = (p: Pixels) =>
    p instanceof ImageDataCtor ? (p as ImageData) : new ImageDataCtor(p.data, p.width, p.height);
  return {
    // "Preserve orientation" means: show it as the camera meant (EXIF rotation applied).
    decodeJpeg: async (bytes) => jpegDec.default(buffer(bytes), { preserveOrientation: true }),
    decodePng: async (bytes) => pngDec.decode(buffer(bytes)),
    decodeWebp: async (bytes) => webpDec.default(buffer(bytes)),
    encodeJpeg: async (pixels, { quality }) =>
      new Uint8Array(
        await jpegEnc.default(asImageData(pixels), {
          quality,
          // MozJPEG's best: progressive, trellis-optimized, optimized Huffman tables.
          progressive: true,
          optimize_coding: true,
          trellis_multipass: true,
        }),
      ),
    encodeWebp: async (pixels, { quality, lossless = false, sharp = false }) =>
      new Uint8Array(
        await webpEnc.default(asImageData(pixels), {
          // For lossless, "quality" is effort: 75 measured 1–3% larger than 100, 3× faster.
          quality: lossless ? 75 : quality,
          lossless: lossless ? 1 : 0,
          // Effort 4 (the default): 5 and 6 measured ~0.3% smaller for 6–30% more time.
          method: 4,
          use_sharp_yuv: sharp ? 1 : 0,
          // Keep the RGB of fully transparent pixels: nothing, it just compresses better.
          exact: 0,
        }),
      ),
    encodePng: async (pixels) => new Uint8Array(await pngEnc.default(asImageData(pixels))),
    resize: async (pixels, width, height) =>
      resize.default(asImageData(pixels), {
        width,
        height,
        method: "lanczos3",
        // Only images with transparency need it (no dark fringes on soft edges).
        premultiply: hasAlpha(pixels),
        // Linear-light resizing is 5× slower (5 s for a 5K photo) for a difference you can
        // only see in test patterns; image editors resize in gamma space by default too.
        linearRGB: false,
      }),
  };
}

/** True if any pixel isn't fully opaque. */
export function hasAlpha(pixels: Pixels): boolean {
  const d = pixels.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
  return false;
}
