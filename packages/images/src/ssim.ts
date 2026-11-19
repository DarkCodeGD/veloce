/**
 * How alike two images look: SSIM (structural similarity, Wang et al. 2004), the standard
 * "would a person see a difference" score. 1 is identical; around 0.98 and up, compression
 * is invisible at normal viewing. Pure TypeScript, no dependencies.
 *
 * Measured on brightness (where the eye sees detail and compression artifacts), in 8×8
 * windows stepping 4 pixels. Transparent pixels are composited over mid-gray, and the alpha
 * channel is scored too, so a soft edge that got jagged counts.
 *
 * A plain average hides a small damaged patch (text on an otherwise empty slide), so the
 * score blends the average with the worst 1% of windows: an image only scores high if no
 * part of it got visibly worse.
 */
import type { Pixels } from "./codecs.ts";

const WINDOW = 8;
const STEP = 4;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
/** The share of the score that comes from the worst windows. */
const WORST_WEIGHT = 0.5;
const WORST_SHARE = 0.01;

export interface Similarity {
  /** The blended score (what decisions use), 0–1. */
  score: number;
  /** Plain mean SSIM, for reporting. */
  mean: number;
  /** Mean SSIM of the worst 1% of windows. */
  worst: number;
}

/** Brightness (Rec. 709 luma), over mid-gray where transparent. */
function luma(p: Pixels): Float32Array {
  const out = new Float32Array(p.width * p.height);
  const d = p.data;
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const a = (d[i + 3] ?? 255) / 255;
    const y = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
    out[j] = y * a + 128 * (1 - a);
  }
  return out;
}

function alpha(p: Pixels): Float32Array | null {
  const out = new Float32Array(p.width * p.height);
  const d = p.data;
  let any = false;
  for (let i = 3, j = 0; j < out.length; i += 4, j++) {
    const a = d[i] ?? 255;
    out[j] = a;
    if (a !== 255) any = true;
  }
  return any ? out : null;
}

/** SSIM of every window, two planes of the same size. */
function windows(x: Float32Array, y: Float32Array, width: number, height: number): Float64Array {
  const cols = Math.max(1, Math.floor((width - WINDOW) / STEP) + 1);
  const rows = Math.max(1, Math.floor((height - WINDOW) / STEP) + 1);
  const w = Math.min(WINDOW, width);
  const h = Math.min(WINDOW, height);
  const n = w * h;
  const out = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let dy = 0; dy < h; dy++) {
        let i = (r * STEP + dy) * width + c * STEP;
        for (let dx = 0; dx < w; dx++, i++) {
          const a = x[i] ?? 0;
          const b = y[i] ?? 0;
          sx += a;
          sy += b;
          sxx += a * a;
          syy += b * b;
          sxy += a * b;
        }
      }
      const mx = sx / n;
      const my = sy / n;
      const vx = sxx / n - mx * mx;
      const vy = syy / n - my * my;
      const cov = sxy / n - mx * my;
      out[r * cols + c] =
        ((2 * mx * my + C1) * (2 * cov + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
    }
  }
  return out;
}

function pool(values: Float64Array): { mean: number; worst: number } {
  let sum = 0;
  for (const v of values) sum += v;
  const sorted = Float64Array.from(values).sort();
  const k = Math.max(1, Math.round(sorted.length * WORST_SHARE));
  let worst = 0;
  for (let i = 0; i < k; i++) worst += sorted[i] ?? 0;
  return { mean: sum / values.length, worst: worst / k };
}

/** How alike `a` and `b` look (same size). */
export function similarity(a: Pixels, b: Pixels): Similarity {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Different sizes: ${a.width}×${a.height} and ${b.width}×${b.height}`);
  }
  const { width, height } = a;
  let { mean, worst } = pool(windows(luma(a), luma(b), width, height));
  const alphaA = alpha(a);
  const alphaB = alpha(b);
  if (alphaA || alphaB) {
    const opaque = new Float32Array(width * height).fill(255);
    const scored = pool(windows(alphaA ?? opaque, alphaB ?? opaque, width, height));
    mean = Math.min(mean, scored.mean);
    worst = Math.min(worst, scored.worst);
  }
  return { score: (1 - WORST_WEIGHT) * mean + WORST_WEIGHT * worst, mean, worst };
}
