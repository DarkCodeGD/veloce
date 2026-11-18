/**
 * Spacing indicators: the red distance lines with a number. Pure, in slide pixels.
 * - While moving or resizing a free layer: the gap to the nearest neighbour on each side
 *   (only neighbours that face it), else to the frame's content edge (`spacingAround`).
 * - Alt + hover with a layer selected: the distances between the two (`measureBetween`).
 */
import type { Rect } from "./geometry.js";

/**
 * A distance to draw. `dir: "h"` is a horizontal line from x = `from` to x = `to` at y = `at`;
 * `"v"` a vertical one from y = `from` to y = `to` at x = `at`.
 */
export interface Measure {
  dir: "h" | "v";
  from: number;
  to: number;
  at: number;
  /** What the label says (rounded, slide pixels). */
  value: number;
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  right(inner) <= right(outer) &&
  bottom(inner) <= bottom(outer);
/** The overlap of two ranges, or null when they don't overlap. */
const overlap = (a0: number, a1: number, b0: number, b1: number) => {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return hi > lo ? { lo, hi, mid: (lo + hi) / 2 } : null;
};

function measure(dir: "h" | "v", a: number, b: number, at: number): Measure | null {
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  const value = Math.round(to - from);
  return value > 0 ? { dir, from, to, at, value } : null;
}

/** The four sides, as functions of a rectangle, so one loop handles them all. */
const SIDES = [
  // Neighbours on the left: their right edge faces our left edge.
  {
    dir: "h",
    near: (m: Rect) => m.x,
    far: right,
    beyond: (n: Rect, m: Rect) => right(n) <= m.x,
    pick: Math.max,
    wall: (c: Rect) => c.x,
  },
  {
    dir: "h",
    near: right,
    far: (n: Rect) => n.x,
    beyond: (n: Rect, m: Rect) => n.x >= right(m),
    pick: Math.min,
    wall: right,
  },
  {
    dir: "v",
    near: (m: Rect) => m.y,
    far: bottom,
    beyond: (n: Rect, m: Rect) => bottom(n) <= m.y,
    pick: Math.max,
    wall: (c: Rect) => c.y,
  },
  {
    dir: "v",
    near: bottom,
    far: (n: Rect) => n.y,
    beyond: (n: Rect, m: Rect) => n.y >= bottom(m),
    pick: Math.min,
    wall: bottom,
  },
] as const;

/**
 * Gaps from `moving` to the nearest facing neighbour on each side, or to the `container`
 * edge when no neighbour faces that side.
 */
export function spacingAround(
  moving: Rect,
  neighbours: readonly Rect[],
  container: Rect | null,
): Measure[] {
  const out: Measure[] = [];
  for (const side of SIDES) {
    // The range a rectangle covers across the measuring direction.
    const across = (r: Rect): [number, number] =>
      side.dir === "h" ? [r.y, bottom(r)] : [r.x, right(r)];
    const [m0, m1] = across(moving);
    let best: { edge: number; at: number } | null = null;
    for (const n of neighbours) {
      if (!side.beyond(n, moving)) continue;
      const [n0, n1] = across(n);
      const shared = overlap(m0, m1, n0, n1);
      if (!shared) continue; // diagonal: doesn't face this side
      const edge = side.far(n);
      if (!best || side.pick(edge, best.edge) === edge) best = { edge, at: shared.mid };
    }
    const fallback =
      container && contains(container, moving)
        ? { edge: side.wall(container), at: (m0 + m1) / 2 }
        : null;
    const target = best ?? fallback;
    const m = target && measure(side.dir, side.near(moving), target.edge, target.at);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Alt + hover: the distances between the selected layer `a` and the hovered `b`. Nested
 * (one inside the other): the four inner gaps. Apart: the horizontal and vertical gaps.
 */
export function measureBetween(a: Rect, b: Rect): Measure[] {
  const inner = contains(b, a) ? a : contains(a, b) ? b : null;
  if (inner) {
    const outer = inner === a ? b : a;
    const cy = inner.y + inner.h / 2;
    const cx = inner.x + inner.w / 2;
    return [
      measure("h", outer.x, inner.x, cy),
      measure("h", right(inner), right(outer), cy),
      measure("v", outer.y, inner.y, cx),
      measure("v", bottom(inner), bottom(outer), cx),
    ].filter((m): m is Measure => m !== null);
  }
  const out: Measure[] = [];
  const ys = overlap(a.y, bottom(a), b.y, bottom(b));
  const xs = overlap(a.x, right(a), b.x, right(b));
  const atY = ys?.mid ?? a.y + a.h / 2;
  const atX = xs?.mid ?? a.x + a.w / 2;
  if (right(a) <= b.x) out.push(measure("h", right(a), b.x, atY) as Measure);
  else if (right(b) <= a.x) out.push(measure("h", right(b), a.x, atY) as Measure);
  if (bottom(a) <= b.y) out.push(measure("v", bottom(a), b.y, atX) as Measure);
  else if (bottom(b) <= a.y) out.push(measure("v", bottom(b), a.y, atX) as Measure);
  return out.filter(Boolean);
}
