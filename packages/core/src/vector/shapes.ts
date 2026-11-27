/**
 * The outlines of the parametric shapes (D127 §1): triangle, polygon, star, block arrow and
 * chevron, as path data in a unit box (0…1 both ways). The renderer clips the shape's box
 * to it, so a shape stretches with its box like a rect does; export and morphing (Phase 5)
 * read the same outline.
 */
import { formatPathData, type PathSegment } from "./path-data.js";

export const SHAPE_KINDS = [
  "rect",
  "ellipse",
  "triangle",
  "polygon",
  "star",
  "arrow",
  "chevron",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** A shape's settings that change its outline; each kind reads its own, with defaults. */
export interface ShapeGeometry {
  /** Polygon: how many sides (3–60). Default 6. */
  sides?: number;
  /** Star: how many points (3–60). Default 5. */
  points?: number;
  /** Star: the inner corners' distance from the center, 0–1 of the outer. Default 0.5. */
  innerRadius?: number;
  /** Arrow: the head's length, 0–1 of the width. Default 0.4. */
  headLength?: number;
  /** Arrow: the shaft's thickness, 0–1 of the height. Default 0.5. */
  shaftWidth?: number;
  /** Chevron: how deep the notch and the point are, 0–1 of the width. Default 0.3. */
  depth?: number;
}

export const SHAPE_DEFAULTS = {
  sides: 6,
  points: 5,
  innerRadius: 0.5,
  headLength: 0.4,
  shaftWidth: 0.5,
  depth: 0.3,
} as const satisfies Required<ShapeGeometry>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Corners on the ellipse inscribed in the unit box, the first at the top. */
function ring(count: number, radius: (i: number) => number): PathSegment[] {
  const out: PathSegment[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const r = radius(i);
    out.push({
      type: i === 0 ? "M" : "L",
      x: 0.5 + 0.5 * r * Math.cos(a),
      y: 0.5 + 0.5 * r * Math.sin(a),
    });
  }
  out.push({ type: "Z" });
  return out;
}

const poly = (...points: [number, number][]): PathSegment[] => [
  ...points.map(([x, y], i): PathSegment => ({ type: i === 0 ? "M" : "L", x, y })),
  { type: "Z" },
];

/**
 * The outline of a shape kind in the unit box, or null for `rect` and `ellipse`, which the
 * renderer draws with CSS (exact corners and radius, no clip).
 */
export function shapeOutline(kind: ShapeKind, g: ShapeGeometry = {}): PathSegment[] | null {
  switch (kind) {
    case "rect":
    case "ellipse":
      return null;
    case "triangle":
      return poly([0.5, 0], [1, 1], [0, 1]);
    case "polygon": {
      const sides = Math.round(clamp(g.sides ?? SHAPE_DEFAULTS.sides, 3, 60));
      return ring(sides, () => 1);
    }
    case "star": {
      const points = Math.round(clamp(g.points ?? SHAPE_DEFAULTS.points, 3, 60));
      const inner = clamp(g.innerRadius ?? SHAPE_DEFAULTS.innerRadius, 0, 1);
      return ring(points * 2, (i) => (i % 2 === 0 ? 1 : inner));
    }
    case "arrow": {
      // Pointing right; turn it with the layer's rotation.
      const head = clamp(g.headLength ?? SHAPE_DEFAULTS.headLength, 0, 1);
      const shaft = clamp(g.shaftWidth ?? SHAPE_DEFAULTS.shaftWidth, 0, 1);
      const neck = 1 - head;
      const top = 0.5 - shaft / 2;
      const bottom = 0.5 + shaft / 2;
      return poly(
        [0, top],
        [neck, top],
        [neck, 0],
        [1, 0.5],
        [neck, 1],
        [neck, bottom],
        [0, bottom],
      );
    }
    case "chevron": {
      const depth = clamp(g.depth ?? SHAPE_DEFAULTS.depth, 0, 0.5);
      return poly([0, 0], [1 - depth, 0], [1, 0.5], [1 - depth, 1], [0, 1], [depth, 0.5]);
    }
  }
}

/** The outline as path data (unit box), or null for rect and ellipse. */
export function shapeOutlineData(kind: ShapeKind, g: ShapeGeometry = {}): string | null {
  const outline = shapeOutline(kind, g);
  return outline ? formatPathData(outline, 5) : null;
}
