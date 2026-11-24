/**
 * Seeded randomness and stagger (D105 §1, D114): the "random" in motion that still gives the
 * same frame every time (golden rule 3, MP4 export, the determinism test).
 *
 * Randomness is **stateless**: `randomAt(seed, i)` is a hash of the two numbers, not the
 * i-th draw of a generator, so seeking straight to any moment needs no replay of what came
 * before. Effects seed it from something stable, like the animation's ID (`hashSeed`).
 */
import { type EasingFunction, linear } from "./easing.js";

/** A 32-bit seed from any mix of strings and numbers (FNV-1a, then mixed). */
export function hashSeed(...parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = `${typeof part}:${part}|`;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return mix(h);
}

/** A number in [0, 1) for this seed and index: the same pair always gives the same number. */
export function randomAt(seed: number, index = 0): number {
  return mix(seed ^ mix(Math.imul(index + 1, 0x9e3779b9))) / 0x1_0000_0000;
}

/** A sequence of `randomAt(seed, 0)`, `randomAt(seed, 1)`…, for code that draws in turn. */
export function createRandom(seed: number): () => number {
  let index = 0;
  return () => randomAt(seed, index++);
}

/** MurmurHash3's finalizer: spreads every input bit over the whole 32-bit output. */
function mix(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// ── Stagger ──────────────────────────────────────────────────────────────────────────

/** Where a stagger starts: an end, the middle, both edges, an item's index, or shuffled. */
export type StaggerFrom = "start" | "end" | "center" | "edges" | "random" | number;

export interface StaggerOptions {
  from?: StaggerFrom;
  /** For `"random"`: the same seed, the same order. */
  seed?: number;
  /** Spreads the delays over the stagger's span, e.g. bunched up at the start. */
  easing?: EasingFunction;
}

/**
 * Each item's delay when `count` items start `each` milliseconds apart: item by item from
 * `from` (default `"start"`), so 5 items `from: "center"` are 2, 1, 0, 1, 2 steps late. The
 * first to start is always at 0. With an `easing`, the delays keep their order and span
 * but are spread along that curve.
 */
export function staggerDelays(count: number, each: number, options: StaggerOptions = {}): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const from = options.from ?? "start";
  const middle = (n - 1) / 2;
  let steps: number[];
  if (from === "random") {
    const seed = options.seed ?? 0;
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => randomAt(seed, a) - randomAt(seed, b) || a - b,
    );
    steps = new Array<number>(n);
    order.forEach((item, rank) => {
      steps[item] = rank;
    });
  } else {
    steps = Array.from({ length: n }, (_, i) => {
      if (from === "start") return i;
      if (from === "end") return n - 1 - i;
      if (from === "center") return Math.abs(i - middle);
      if (from === "edges") return middle - Math.abs(i - middle);
      return Math.abs(i - from);
    });
  }
  const first = Math.min(...steps);
  const span = Math.max(...steps) - first;
  const ease = options.easing ?? linear;
  return steps.map((s) =>
    span === 0 ? 0 : ease === linear ? (s - first) * each : ease((s - first) / span) * span * each,
  );
}
