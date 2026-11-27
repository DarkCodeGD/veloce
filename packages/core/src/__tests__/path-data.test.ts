/**
 * Path data (D127 §3): the SVG grammar parsed strictly into absolute segments, bounds that
 * include curve extrema, and everything that isn't a path refused with where it broke.
 */
import { describe, expect, it } from "vitest";
import {
  arcToCubics,
  formatPathData,
  MAX_PATH_COMMANDS,
  MAX_PATH_LENGTH,
  parsePathData,
  pathBounds,
} from "../vector/path-data.js";
import { PathDataSchema } from "../vector/schema.js";
import { shapeOutline, shapeOutlineData } from "../vector/shapes.js";

const parse = (d: string) => {
  const r = parsePathData(d);
  if (!r.ok) throw new Error(`${r.message} @${r.at}`);
  return r.segments;
};
const round = (n: number) => Math.round(n * 1000) / 1000;

describe("parsePathData", () => {
  it("reads every command, absolute and relative, into absolute segments", () => {
    expect(formatPathData(parse("M10 10 l5 0 h5 v5 H10 V10 z"))).toBe(
      "M10 10L15 10L20 10L20 15L10 15L10 10Z",
    );
    expect(formatPathData(parse("M0 0 c1 1 2 2 3 3 s4 4 5 5"))).toBe(
      "M0 0C1 1 2 2 3 3C4 4 7 7 8 8",
    );
    expect(formatPathData(parse("M0 0 Q5 5 10 0 T20 0"))).toBe("M0 0Q5 5 10 0Q15 -5 20 0");
    expect(formatPathData(parse("M0 0 A5 5 0 0 1 10 0"))).toBe("M0 0A5 5 0 0 1 10 0");
  });

  it("takes the packed forms real SVGs use", () => {
    // Implicit lines after a move, numbers run together, compact arc flags, exponents.
    expect(formatPathData(parse("M0,0 10,0 10,10"))).toBe("M0 0L10 0L10 10");
    expect(formatPathData(parse("M.5.5L-1-1"))).toBe("M0.5 0.5L-1 -1");
    expect(formatPathData(parse("M0 0a10 10 0 0110 10"))).toBe("M0 0A10 10 0 0 1 10 10");
    expect(formatPathData(parse("M1e1 2E-1"))).toBe("M10 0.2");
    expect(formatPathData(parse("m5 5 5 0"))).toBe("M5 5L10 5"); // relative repeats
    expect(formatPathData(parse("M0 0 L10 0 Z m 2 2 l1 1"))).toBe("M0 0L10 0ZM2 2L3 3");
  });

  it("refuses what isn't a path, saying what and where", () => {
    const bad = (d: string) => {
      const r = parsePathData(d);
      expect(r.ok).toBe(false);
      return r.ok ? null : r;
    };
    expect(bad("")?.message).toMatch(/empty/);
    expect(bad("L 0 0")?.message).toMatch(/starts with a move/);
    expect(bad("M 0 0 X 1 1")).toMatchObject({
      message: expect.stringMatching(/"X" isn't a path command/),
      at: 6,
    });
    expect(bad("M 0 0 L 1")?.message).toMatch(/"L" takes 2 numbers; found the end/);
    expect(bad("M0 0 A 5 5 0 2 1 10 0")?.message).toMatch(/a flag \(0 or 1\)/);
    expect(bad("M0 0 Z 5")?.message).toMatch(/"5" isn't a path command/);
    expect(bad("M0 0 L Infinity 0")).toBeTruthy();
    expect(bad("M0 0 L NaN 0")).toBeTruthy();
    // Markup, scripts and URLs are just not path data.
    expect(bad('M0 0"/><script>alert(1)</script>')).toBeTruthy();
    expect(bad("M0 0 url(javascript:alert(1))")).toBeTruthy();
    expect(bad("x".repeat(MAX_PATH_LENGTH + 1))?.message).toMatch(/limit/);
    expect(bad(`M0 0${"L1 1".repeat(MAX_PATH_COMMANDS)}`)?.message).toMatch(
      /more than 4000 commands/,
    );
  });

  it("is a zod schema whose error points at the problem", () => {
    expect(PathDataSchema.safeParse("M0 0 L10 10").success).toBe(true);
    const r = PathDataSchema.safeParse("M0 0 L10 Q");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(
      /"L" takes 2 numbers.*at character 9, near "M0 0 L10 Q"/,
    );
  });
});

describe("pathBounds", () => {
  it("covers the outline, curve extrema included, not the control points", () => {
    expect(pathBounds(parse("M0 0 L10 0 L10 5 Z"))).toEqual({ x: 0, y: 0, width: 10, height: 5 });
    // A cubic bulging up: control points at y -10, the curve only reaches -7.5.
    const b = pathBounds(parse("M0 0 C0 -10 10 -10 10 0"));
    expect(b && { ...b, y: round(b.y), height: round(b.height) }).toEqual({
      x: 0,
      y: -7.5,
      width: 10,
      height: 7.5,
    });
    // A half circle as an arc: radius 5 above the line.
    const arc = pathBounds(parse("M0 0 A5 5 0 0 1 10 0"));
    expect(arc && [round(arc.x), round(arc.y), round(arc.width), round(arc.height)]).toEqual([
      0, -5, 10, 5,
    ]);
    expect(pathBounds(parse("M5 5"))).toBeNull(); // a lone move draws nothing
  });

  it("turns arcs into quarter-turn cubics that land on the end", () => {
    const cubics = arcToCubics(
      { x: 0, y: 0 },
      { type: "A", rx: 5, ry: 5, rotation: 0, largeArc: true, sweep: true, x: 0, y: 10 },
    );
    expect(cubics).toHaveLength(2);
    expect(cubics.at(-1)).toMatchObject({ x: 0, y: 10 });
    // Radii too small to reach are scaled up (SVG's rule), not an error.
    expect(
      arcToCubics(
        { x: 0, y: 0 },
        { type: "A", rx: 1, ry: 1, rotation: 0, largeArc: false, sweep: true, x: 10, y: 0 },
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("shape outlines", () => {
  it("draws each kind in the unit box", () => {
    expect(shapeOutline("rect")).toBeNull();
    expect(shapeOutlineData("triangle")).toBe("M0.5 0L1 1L0 1Z");
    // A star has two corners per point; a hexagon six; every corner stays inside the box.
    const star = shapeOutline("star", { points: 5 }) ?? [];
    expect(star.filter((s) => s.type !== "Z")).toHaveLength(10);
    expect(shapeOutline("polygon", { sides: 6 })?.filter((s) => s.type !== "Z")).toHaveLength(6);
    for (const kind of ["triangle", "polygon", "star", "arrow", "chevron"] as const) {
      const b = pathBounds(shapeOutline(kind) ?? []);
      expect(
        b &&
          b.x >= -1e-9 &&
          b.y >= -1e-9 &&
          b.x + b.width <= 1 + 1e-9 &&
          b.y + b.height <= 1 + 1e-9,
      ).toBe(true);
    }
    // Out-of-range settings are clamped, never broken geometry.
    expect(shapeOutline("polygon", { sides: 1000 })?.filter((s) => s.type !== "Z")).toHaveLength(
      60,
    );
  });
});
