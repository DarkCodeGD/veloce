/**
 * Moving paths around (D127): affine transforms on parsed path data, and fitting a path's
 * viewBox into a box. The `vector` element draws through these (path units → its box's
 * pixels), and SVG import uses them for group transforms. Pure, no DOM.
 */
import { arcToCubics, type Bounds, type PathPoint, type PathSegment } from "./path-data.js";

/**
 * An affine transform in SVG's `matrix(a b c d e f)` order:
 * x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** `outer` after `inner`: a point goes through `inner` first (SVG's nesting order). */
export function compose(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}

export const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
export const scale = (x: number, y = x): Affine => [x, 0, 0, y, 0, 0];

export function applyAffine(m: Affine, p: PathPoint): PathPoint {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/**
 * Whether an arc stays an arc under `m`: a plain scale and move, uniform, or with the
 * arc's axes still along x and y. Anything else (a turn, a skew, a flip, an uneven scale of
 * a tilted arc) turns it into curves.
 */
function keepsArcs(m: Affine, rotation: number): boolean {
  const [a, b, c, d] = m;
  if (b !== 0 || c !== 0 || a <= 0 || d <= 0) return false;
  return a === d || rotation % 180 === 0;
}

/** The path moved through `m`. Every segment stays absolute; arcs become curves when needed. */
export function transformPath(segments: readonly PathSegment[], m: Affine): PathSegment[] {
  const out: PathSegment[] = [];
  let pen: PathPoint = { x: 0, y: 0 };
  let start: PathPoint = pen;
  const at = (x: number, y: number) => applyAffine(m, { x, y });
  for (const s of segments) {
    switch (s.type) {
      case "M":
      case "L": {
        const p = at(s.x, s.y);
        out.push({ type: s.type, ...p });
        pen = { x: s.x, y: s.y };
        if (s.type === "M") start = pen;
        break;
      }
      case "C": {
        const c1 = at(s.x1, s.y1);
        const c2 = at(s.x2, s.y2);
        const p = at(s.x, s.y);
        out.push({ type: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
        pen = { x: s.x, y: s.y };
        break;
      }
      case "Q": {
        const c = at(s.x1, s.y1);
        const p = at(s.x, s.y);
        out.push({ type: "Q", x1: c.x, y1: c.y, x: p.x, y: p.y });
        pen = { x: s.x, y: s.y };
        break;
      }
      case "A": {
        if (keepsArcs(m, s.rotation)) {
          const p = at(s.x, s.y);
          out.push({ ...s, rx: s.rx * m[0], ry: s.ry * m[3], x: p.x, y: p.y });
        } else {
          for (const c of arcToCubics(pen, s)) {
            const c1 = at(c.x1, c.y1);
            const c2 = at(c.x2, c.y2);
            const p = at(c.x, c.y);
            out.push({ type: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y });
          }
        }
        pen = { x: s.x, y: s.y };
        break;
      }
      case "Z":
        out.push(s);
        pen = start;
        break;
    }
  }
  return out;
}

/**
 * The viewBox a path gets when none is given: its own bounds. A flat path (a straight
 * horizontal or vertical stroke) gets some depth, so fitting it never divides by zero.
 */
export function defaultViewBox(bounds: Bounds | null): Bounds {
  if (!bounds) return { x: 0, y: 0, width: 1, height: 1 };
  const width = bounds.width > 0 ? bounds.width : Math.max(bounds.height, 1);
  const height = bounds.height > 0 ? bounds.height : Math.max(bounds.width, 1);
  return {
    x: bounds.x - (width - bounds.width) / 2,
    y: bounds.y - (height - bounds.height) / 2,
    width,
    height,
  };
}

export type PathFit = "contain" | "stretch";

/**
 * Path units → a `width` × `height` box: `contain` keeps the proportions and centers the
 * drawing (like SVG's default `xMidYMid meet`), `stretch` fills the box both ways.
 */
export function fitViewBox(
  viewBox: Bounds,
  width: number,
  height: number,
  fit: PathFit = "contain",
): Affine {
  let sx = width / viewBox.width;
  let sy = height / viewBox.height;
  if (fit === "contain") sx = sy = Math.min(sx, sy);
  const dx = (width - viewBox.width * sx) / 2;
  const dy = (height - viewBox.height * sy) / 2;
  return [sx, 0, 0, sy, dx - viewBox.x * sx, dy - viewBox.y * sy];
}
