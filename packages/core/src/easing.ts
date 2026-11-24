/**
 * Easing functions (D105 §1, D114): how an animation's progress (0 → 1 over time) turns into
 * how far its value has travelled. Pure math, no dependencies, the same result everywhere.
 *
 * - **CSS names and cubic Béziers** match the browser's `cubic-bezier()` exactly, so motion
 *   handed to the compositor (D107) draws the frames `seek(t)` computes.
 * - **Springs are duration-based:** `bounce` (0–1) sets how springy, and the stiffness is
 *   solved so the spring has settled when the duration ends. The animation lasts exactly
 *   its `duration` (the schedule stays true) and lands exactly on its end value; the
 *   compositor gets it sampled into a CSS `linear()` curve.
 */
import type { EasingValue } from "./schema/motion.js";

/** Progress 0–1 in, travel out: 0 at the start, 1 at the end, past 1 when it overshoots. */
export type EasingFunction = (progress: number) => number;

export const linear: EasingFunction = (p) => p;

/** The CSS easing keywords as the cubic Béziers CSS defines them. */
export const CSS_EASING_CURVES = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)`: the curve from (0,0) to (1,1) with those two control
 * points, where x is time and y is travel. Finding the y for a time means solving the
 * curve's x for its parameter: Newton's method, which converges in a few steps on almost
 * every curve, with bisection as the fallback where the slope is flat.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  if (x1 === y1 && x2 === y2) return linear;
  // The curve as polynomials in its parameter u: x(u) = ((ax·u + bx)·u + cx)·u.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const xAt = (u: number) => ((ax * u + bx) * u + cx) * u;
  const yAt = (u: number) => ((ay * u + by) * u + cy) * u;
  const slopeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  const solve = (x: number): number => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const error = xAt(u) - x;
      if (Math.abs(error) < 1e-9) return u;
      const slope = slopeX(u);
      if (Math.abs(slope) < 1e-6) break;
      u -= error / slope;
    }
    // x(u) rises monotonically on [0, 1] (x1 and x2 are 0–1), so bisection always finds it.
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 60 && hi - lo > 1e-12; i++) {
      if (xAt(u) < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };

  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : yAt(solve(p)));
}

/** How close to its end a spring must be when its duration ends: then it's nudged onto it. */
const SPRING_SETTLED = 0.001;
/** The lowest damping ratio: bounce 1 still settles, after about ten swings. */
const MIN_DAMPING = 0.1;

/**
 * A spring that settles in its duration. `bounce` 0 is critically damped (the fastest
 * approach with no overshoot); higher bounces overshoot and swing back, `1` the most.
 *
 * The physics: a damped spring released from 0 towards 1 with damping ratio ζ = 1 − 0.9 ×
 * bounce. Its swings shrink as e^(−ζωt), so ω (how stiff it is) is chosen to make them
 * smaller than 0.1% of the distance at t = 1. What's left of that 0.1% is spread linearly
 * over the duration, so the curve ends on exactly 1 with no jump.
 */
export function springEasing(bounce = 0): EasingFunction {
  const zeta = Math.max(MIN_DAMPING, 1 - 0.9 * Math.min(1, Math.max(0, bounce)));
  let position: (t: number) => number;
  if (zeta >= 1) {
    const w = CRITICAL_STIFFNESS;
    position = (t) => 1 - Math.exp(-w * t) * (1 + w * t);
  } else {
    const root = Math.sqrt(1 - zeta * zeta);
    const w = Math.log(1 / (SPRING_SETTLED * root)) / zeta;
    const wd = w * root;
    const k = (zeta * w) / wd;
    position = (t) => 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + k * Math.sin(wd * t));
  }
  const residual = 1 - position(1);
  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : position(p) + residual * p);
}

/**
 * ω for the critically damped spring: where e^(−ω)(1 + ω) is `SPRING_SETTLED`, by Newton's
 * method on ln(1 + ω) − ω = ln(SPRING_SETTLED). About 9.23.
 */
const CRITICAL_STIFFNESS = (() => {
  const target = Math.log(SPRING_SETTLED);
  let w = 10;
  for (let i = 0; i < 20; i++) w -= (Math.log(1 + w) - w - target) / (1 / (1 + w) - 1);
  return w;
})();

const cache = new Map<string, EasingFunction>();
const MAX_CACHED = 256;

/** The function for an easing (no `$motion` tokens: resolve those first, `resolveEasing`). */
export function easingFunction(easing: EasingValue): EasingFunction {
  if (easing === "linear") return linear;
  const key = typeof easing === "string" ? easing : JSON.stringify(easing);
  const cached = cache.get(key);
  if (cached) return cached;
  let fn: EasingFunction;
  if (typeof easing === "object" && "spring" in easing) fn = springEasing(easing.spring.bounce);
  else {
    const [x1, y1, x2, y2] =
      typeof easing === "string" ? CSS_EASING_CURVES[easing] : easing.cubicBezier;
    fn = cubicBezier(x1, y1, x2, y2);
  }
  if (cache.size >= MAX_CACHED) cache.clear(); // a deck uses a handful; never grow unbounded
  cache.set(key, fn);
  return fn;
}
