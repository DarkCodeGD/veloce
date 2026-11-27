/**
 * Moving paths (D127): affine transforms keep arcs exact when they can and turn them into
 * curves when they can't, and a viewBox fits its box the way SVG's `meet` does.
 */
import { describe, expect, it } from "vitest";
import { formatPathData, parsePathData, pathBounds } from "../vector/path-data.js";
import {
  applyAffine,
  compose,
  defaultViewBox,
  fitViewBox,
  scale,
  transformPath,
  translate,
} from "../vector/transform.js";

const parse = (d: string) => {
  const r = parsePathData(d);
  if (!r.ok) throw new Error(`${r.message} @${r.at}`);
  return r.segments;
};

describe("affine transforms", () => {
  it("compose in SVG's nesting order: the inner one applies first", () => {
    // Scale by 2, then move right 10: (1, 1) → (2, 2) → (12, 2).
    const m = compose(translate(10, 0), scale(2));
    expect(applyAffine(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
  });

  it("moves every point of a path, closing back where it started", () => {
    const out = transformPath(parse("M 0 0 L 10 0 Q 10 10 0 10 Z"), translate(5, 5));
    expect(formatPathData(out)).toBe("M5 5L15 5Q15 15 5 15Z");
  });

  it("keeps an arc an arc under a plain scale and move", () => {
    const out = transformPath(parse("M 0 0 A 5 5 0 0 1 10 0"), compose(translate(1, 1), scale(2)));
    expect(out[1]).toMatchObject({ type: "A", rx: 10, ry: 10, x: 21, y: 1 });
  });

  it("turns an arc into curves when a turn or a flip would bend it", () => {
    const turn: [number, number, number, number, number, number] = [0, 1, -1, 0, 0, 0]; // 90°
    const out = transformPath(parse("M 10 0 A 10 10 0 0 1 -10 0"), turn);
    expect(out.slice(1).every((s) => s.type === "C")).toBe(true);
    // The half circle through (0, 10) turned 90° passes through (-10, 0): same shape, turned.
    const b = pathBounds(out);
    expect(b && Math.round(b.x)).toBe(-10);
    expect(b && Math.round(b.width)).toBe(10);
    expect(b && Math.round(b.height)).toBe(20);
    const flip = transformPath(parse("M 0 0 A 5 5 0 0 1 10 0"), scale(-1, 1));
    expect(flip[1]?.type).toBe("C");
  });
});

describe("fitting a viewBox", () => {
  const icon = { x: 0, y: 0, width: 24, height: 24 };

  it("contain keeps the proportions and centers the drawing", () => {
    const m = fitViewBox(icon, 200, 100, "contain");
    expect(applyAffine(m, { x: 0, y: 0 })).toEqual({ x: 50, y: 0 });
    expect(applyAffine(m, { x: 24, y: 24 })).toEqual({ x: 150, y: 100 });
  });

  it("stretch fills the box both ways", () => {
    const m = fitViewBox(icon, 200, 100, "stretch");
    expect(applyAffine(m, { x: 24, y: 24 })).toEqual({ x: 200, y: 100 });
  });

  it("honors a viewBox that doesn't start at the origin", () => {
    const m = fitViewBox({ x: 10, y: 20, width: 10, height: 10 }, 100, 100);
    expect(applyAffine(m, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 });
  });

  it("a path without a viewBox fits its own bounds; a flat one still gets depth", () => {
    expect(defaultViewBox(pathBounds(parse("M 2 3 L 12 8")))).toEqual({
      x: 2,
      y: 3,
      width: 10,
      height: 5,
    });
    // A horizontal stroke 10 long: square around it, so contain doesn't blow it up.
    expect(defaultViewBox(pathBounds(parse("M 0 5 H 10")))).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(defaultViewBox(null)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});
