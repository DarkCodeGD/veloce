/**
 * Where a gradient's handles go on the canvas, and what dragging them means (D87). Pure
 * geometry in the painted box's own axes (origin at its top-left, y down, rotation removed),
 * matching exactly what CSS draws (plugin-api's `cssPaint`):
 *
 * - **linear** `linear-gradient(θ)`: CSS's gradient line runs through the box's centre in
 *   the direction θ (0 = up, clockwise), long enough that its ends' perpendiculars touch the
 *   box's corners: |w·sin θ| + |h·cos θ|. Offsets 0 and 1 sit at `start` and `end` along it
 *   (fractions of it, default 0 and 1, D88), which is where the knobs are.
 * - **radial** `rx ry at c` (or `ellipse farthest-side`): offset 1 is that ellipse. Its stops
 *   are shown on a ray from the centre towards the farther vertical side.
 * - **conic** `from θ at c`: offsets go clockwise around the centre from θ; shown on a ring.
 *
 * The schema stores an angle and positions along CSS's line, not two free points: sliding a
 * linear gradient sideways changes nothing CSS draws, and two points would need the box's
 * pixel size to become an angle. So dragging a linear knob puts it under the pointer and
 * turns the gradient about the centre, the other knob swinging round (D88).
 */
import type { Gradient, LinearGradient, RadialGradient } from "@veloce/core";
import type { Point } from "./geometry.js";

export interface Size {
  w: number;
  h: number;
}

/** Where the stops of a gradient lie on the canvas. */
export type Guide =
  | { kind: "line"; start: Point; end: Point }
  | { kind: "ring"; center: Point; radius: number; angle: number };

const RAD = Math.PI / 180;
/** The ring a conic gradient's stops sit on, as a share of the box's smaller side. */
export const RING = 0.32;

/** Rounds away float dust, so 90° steps land on exact pixels (cos 90° isn't quite 0). */
const clean = (v: number) => Math.round(v * 1e12) / 1e12 + 0;

/** The unit vector CSS angle `deg` points along (0 = up, 90 = right). */
export const direction = (deg: number): Point => ({
  x: clean(Math.sin(deg * RAD)),
  y: clean(-Math.cos(deg * RAD)),
});

/** The gradient's centre in the box (linear gradients: the box's centre). */
export function centerOf(g: Gradient, box: Size): Point {
  const c = g.type === "linear-gradient" ? { x: 0.5, y: 0.5 } : (g.center ?? { x: 0.5, y: 0.5 });
  return { x: c.x * box.w, y: c.y * box.h };
}

/** The length of CSS's gradient line at `angle` in a box (see the file comment). */
export function lineLength(angle: number, box: Size): number {
  const d = direction(angle);
  return Math.abs(box.w * d.x) + Math.abs(box.h * d.y) || 1;
}

/** The point `t` along CSS's gradient line (0 its start, 1 its end; it may run past). */
function alongLine(angle: number, box: Size, t: number): Point {
  const d = direction(angle);
  const k = (t - 0.5) * lineLength(angle, box);
  return { x: box.w / 2 + d.x * k, y: box.h / 2 + d.y * k };
}

/** A radial gradient's ellipse radii, in the box's units (farthest side when not sized). */
export function radiusOf(g: RadialGradient, box: Size): Size {
  const c = centerOf(g, box);
  if (g.radius) return { w: g.radius.x * box.w, h: g.radius.y * box.h };
  return { w: Math.max(c.x, box.w - c.x), h: Math.max(c.y, box.h - c.y) };
}

/**
 * A radial gradient's size knobs: where its ellipse crosses the horizontal and vertical
 * through the centre, on the sides with more room (inside the box when it can be).
 */
export function radiusKnobs(g: RadialGradient, box: Size): { x: Point; y: Point } {
  const c = centerOf(g, box);
  const r = radiusOf(g, box);
  const sx = c.x <= box.w / 2 ? 1 : -1;
  const sy = c.y <= box.h / 2 ? 1 : -1;
  return { x: { x: c.x + sx * r.w, y: c.y }, y: { x: c.x, y: c.y + sy * r.h } };
}

/** Where the gradient's stops lie (see the file comment). */
export function guideOf(g: Gradient, box: Size): Guide {
  const c = centerOf(g, box);
  if (g.type === "linear-gradient") {
    const angle = g.angle ?? 180;
    return {
      kind: "line",
      start: alongLine(angle, box, g.start ?? 0),
      end: alongLine(angle, box, g.end ?? 1),
    };
  }
  if (g.type === "radial-gradient") {
    return { kind: "line", start: c, end: radiusKnobs(g, box).x };
  }
  return { kind: "ring", center: c, radius: RING * Math.min(box.w, box.h), angle: g.angle ?? 0 };
}

/** Where the stop at `offset` sits on the guide. */
export function pointAt(guide: Guide, offset: number): Point {
  if (guide.kind === "line") {
    return {
      x: guide.start.x + (guide.end.x - guide.start.x) * offset,
      y: guide.start.y + (guide.end.y - guide.start.y) * offset,
    };
  }
  const d = direction(guide.angle + offset * 360);
  return { x: guide.center.x + d.x * guide.radius, y: guide.center.y + d.y * guide.radius };
}

/**
 * The offset a pointer at `p` means on the guide (0–1), and how far off the guide it is (to
 * remove a stop dragged away, like the picker's bar).
 */
export function offsetAt(guide: Guide, p: Point): { offset: number; away: number } {
  if (guide.kind === "line") {
    const vx = guide.end.x - guide.start.x;
    const vy = guide.end.y - guide.start.y;
    const len2 = vx * vx + vy * vy || 1;
    const t = ((p.x - guide.start.x) * vx + (p.y - guide.start.y) * vy) / len2;
    const away =
      Math.abs((p.x - guide.start.x) * vy - (p.y - guide.start.y) * vx) / Math.sqrt(len2);
    return { offset: Math.min(1, Math.max(0, t)), away };
  }
  const deg = angleTowards(guide.center, p);
  const offset = (((deg - guide.angle) % 360) + 360) % 360;
  const dist = Math.hypot(p.x - guide.center.x, p.y - guide.center.y);
  return { offset: offset / 360, away: Math.abs(dist - guide.radius) };
}

/** The CSS angle (0 = up, clockwise, 0–360) from `from` towards `to`; Shift snaps to 15°. */
export function angleTowards(from: Point, to: Point, snap = false): number {
  const deg = Math.atan2(to.x - from.x, -(to.y - from.y)) / RAD;
  const whole = (((Math.round(snap ? deg / 15 : deg) * (snap ? 15 : 1)) % 360) + 360) % 360;
  return whole + 0;
}

/** Four decimals: no float dust in the file. */
const round4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const MID = { x: 0.5, y: 0.5 };
/** How far past the box a position or size may go (the schema's bounds), in box sizes. */
const REACH = 10;
const within = (v: number) => Math.min(REACH, Math.max(-REACH, v));

/** A point as fractions of the box (a gradient's `center`): it may sit outside it (D88). */
export function fractionIn(p: Point, box: Size): Point {
  const f = (v: number, size: number) => round4(within(v / (size || 1)));
  return { x: f(p.x, box.w), y: f(p.y, box.h) };
}

/**
 * A linear gradient with its `start` or `end` knob dragged to `p`: the knob lands under the
 * pointer (Shift: the angle in 15° steps, the knob on that line), turning the gradient about
 * the box's centre; the other knob keeps its place along the line.
 */
export function dragLinearKnob(
  g: LinearGradient,
  box: Size,
  knob: "start" | "end",
  p: Point,
  snap = false,
): LinearGradient {
  const t = knob === "start" ? (g.start ?? 0) : (g.end ?? 1);
  // Which side of the centre the knob is on, along the gradient's direction.
  const side = Math.sign(t - 0.5) || (knob === "end" ? 1 : -1);
  const c = { x: box.w / 2, y: box.h / 2 };
  const angle = side > 0 ? angleTowards(c, p, snap) : angleTowards(p, c, snap);
  const d = direction(angle);
  const reach = Math.abs((p.x - c.x) * d.x + (p.y - c.y) * d.y);
  const moved = round4(within(0.5 + (side * reach) / lineLength(angle, box)));
  return { ...g, angle, start: g.start ?? 0, end: g.end ?? 1, [knob]: moved };
}

/**
 * A radial gradient with a size knob dragged to `p`: that radius follows the pointer
 * (Shift keeps the ellipse's proportions). The gradient keeps its center.
 */
export function dragRadius(
  g: RadialGradient,
  box: Size,
  axis: "x" | "y",
  p: Point,
  keepRatio = false,
): RadialGradient {
  const c = centerOf(g, box);
  const r = radiusOf(g, box);
  const was = axis === "x" ? r.w : r.h;
  const now = Math.max(1, Math.abs(axis === "x" ? p.x - c.x : p.y - c.y));
  const k = keepRatio ? now / (was || 1) : 1;
  const fraction = (px: number, size: number) =>
    Math.min(REACH, Math.max(0.001, round4(px / (size || 1))));
  const radius = {
    x: fraction(axis === "x" ? now : r.w * k, box.w),
    y: fraction(axis === "y" ? now : r.h * k, box.h),
  };
  return { ...g, center: g.center ?? MID, radius };
}

/**
 * A radial or conic gradient with its center moved to `p`. A radial one keeps the size it
 * shows (an unsized one would otherwise grow and shrink with the distance to the far side).
 */
export function moveCenter<G extends Gradient>(g: G, box: Size, p: Point): G {
  const center = fractionIn(p, box);
  if (g.type !== "radial-gradient") return { ...g, center };
  const r = radiusOf(g, box);
  const radius = g.radius ?? {
    x: Math.max(0.001, round4(r.w / (box.w || 1))),
    y: Math.max(0.001, round4(r.h / (box.h || 1))),
  };
  return { ...g, center, radius };
}
