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

export function compareScreenshots(baseline: Uint8Array, actual: Uint8Array): Comparison {
  const a = PNG.sync.read(Buffer.from(baseline));
  const b = PNG.sync.read(Buffer.from(actual));
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
