/**
 * Pixel comparison for the visual regression tests (pixelmatch, ISC).
 *
 * Anti-aliased pixels are detected and ignored (pixelmatch's `includeAA: false`), so the
 * soft edge of a glyph or a curve rasterized a hair differently by another machine's font
 * stack doesn't count. Anything else that changes color past `threshold` does: a layer
 * moved by one pixel leaves a full-strength edge of differing pixels, which is exactly what
 * these tests exist to catch.
 */
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface Comparison {
  match: boolean;
  /** Why they differ, for the failure message. */
  reason?: string;
  /** A PNG with the differing pixels in red over a faded copy of the baseline. */
  diff?: Uint8Array;
}

/** Color distance (OKLab, 0–1) above which a pixel differs. pixelmatch's default. */
const THRESHOLD = 0.1;
/**
 * Differing pixels tolerated per image. Zero: rendering is deterministic on one machine,
 * and anti-aliasing noise between machines is already ignored above. Raise it only with
 * evidence (a CI diff that is noise, not a change), and say so in DECISIONS.md.
 */
const MAX_DIFF_PIXELS = 0;

export interface CompareOptions {
  /**
   * Average `pool`×`pool` blocks of pixels before comparing: how sharply an edge was
   * rasterized stops counting, where it is still does (a layer moved by two pixels shifts
   * a full-contrast edge through a block). For frames drawn two different ways, such as
   * the compositor's stretched layer bitmaps against a fresh paint (D115).
   */
  pool?: number;
}

export function compareScreenshots(
  baseline: Uint8Array,
  actual: Uint8Array,
  options: CompareOptions = {},
): Comparison {
  const pool = options.pool ?? 1;
  const a = pooled(PNG.sync.read(Buffer.from(baseline)), pool);
  const b = pooled(PNG.sync.read(Buffer.from(actual)), pool);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      match: false,
      reason: `size changed from ${a.width}×${a.height} to ${b.width}×${b.height}`,
    };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const count = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: THRESHOLD,
    includeAA: false,
  });
  if (count <= MAX_DIFF_PIXELS) return { match: true };
  const share = ((count / (a.width * a.height)) * 100).toFixed(3);
  return {
    match: false,
    reason: `${count} pixels differ (${share}% of the slide)`,
    diff: new Uint8Array(PNG.sync.write(diff)),
  };
}

/** The image with each `size`×`size` block replaced by its average (`size` 1: as it is). */
function pooled(image: PNG, size: number): PNG {
  if (size <= 1) return image;
  const width = Math.floor(image.width / size);
  const height = Math.floor(image.height / size);
  const out = new PNG({ width, height });
  const area = size * size;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < size; dy++) {
          const row = (y * size + dy) * image.width;
          for (let dx = 0; dx < size; dx++) sum += image.data[(row + x * size + dx) * 4 + c] ?? 0;
        }
        out.data[(y * width + x) * 4 + c] = Math.round(sum / area);
      }
    }
  }
  return out;
}
