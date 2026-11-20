import type { Gradient } from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  angleTowards,
  dragLinearKnob,
  dragRadius,
  fractionIn,
  guideOf,
  moveCenter,
  offsetAt,
  pointAt,
  RING,
  radiusKnobs,
} from "./gradient-handles.js";

const stops = [
  { color: "#000000", offset: 0 },
  { color: "#ffffff", offset: 1 },
];
const linear = (angle?: number): Gradient => ({ type: "linear-gradient", angle, stops });
const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

describe("gradient handles (D87)", () => {
  it("draws a linear gradient's line the way CSS does", () => {
    // Default 180°: top to bottom through the middle.
    const down = guideOf(linear(), { w: 400, h: 200 });
    expect(down).toEqual({ kind: "line", start: { x: 200, y: 0 }, end: { x: 200, y: 200 } });
    const right = guideOf(linear(90), { w: 400, h: 200 });
    if (right.kind !== "line") throw new Error("line");
    near(right.start, 0, 100);
    near(right.end, 400, 100);
    // 45° in a square: corner to corner.
    const diagonal = guideOf(linear(45), { w: 100, h: 100 });
    if (diagonal.kind !== "line") throw new Error("line");
    near(diagonal.start, 0, 100);
    near(diagonal.end, 100, 0);
  });

  it("puts a radial gradient's stops on a ray to its farthest side", () => {
    const g: Gradient = { type: "radial-gradient", center: { x: 0.25, y: 0.5 }, stops };
    expect(guideOf(g, { w: 400, h: 200 })).toEqual({
      kind: "line",
      start: { x: 100, y: 100 },
      end: { x: 400, y: 100 },
    });
    const left: Gradient = { ...g, center: { x: 0.9, y: 0.5 } };
    expect(guideOf(left, { w: 400, h: 200 })).toMatchObject({ end: { x: 0, y: 100 } });
  });

  it("finds the offset a pointer means on a line, and how far off it is", () => {
    const guide = guideOf(linear(), { w: 400, h: 200 });
    expect(pointAt(guide, 0.75)).toEqual({ x: 200, y: 150 });
    expect(offsetAt(guide, { x: 200, y: 150 })).toEqual({ offset: 0.75, away: 0 });
    expect(offsetAt(guide, { x: 260, y: 50 })).toEqual({ offset: 0.25, away: 60 });
    expect(offsetAt(guide, { x: 200, y: 500 }).offset).toBe(1); // past the end: kept on it
  });

  it("puts a conic gradient's stops on a ring, clockwise from its angle", () => {
    const g: Gradient = { type: "conic-gradient", angle: 0, stops };
    const ring = guideOf(g, { w: 100, h: 100 });
    expect(ring).toEqual({ kind: "ring", center: { x: 50, y: 50 }, radius: RING * 100, angle: 0 });
    near(pointAt(ring, 0.25), 50 + RING * 100, 50);
    const below = offsetAt(ring, { x: 50, y: 90 });
    expect(below.offset).toBeCloseTo(0.5, 6);
    expect(below.away).toBeCloseTo(40 - RING * 100, 6);
  });

  it("reads angles like CSS (0 up, clockwise), snapping to 15° with Shift", () => {
    const o = { x: 0, y: 0 };
    expect(angleTowards(o, { x: 1, y: 0 })).toBe(90);
    expect(angleTowards(o, { x: 0, y: -1 })).toBe(0);
    expect(angleTowards(o, { x: -1, y: 0 })).toBe(270);
    expect(angleTowards(o, { x: 1, y: -1.1 }, true)).toBe(45);
    // Centers may sit outside the box (D88).
    expect(fractionIn({ x: -20, y: 150 }, { w: 400, h: 200 })).toEqual({ x: -0.05, y: 0.75 });
  });

  it("puts a linear gradient's knobs at its start and end along CSS's line (D88)", () => {
    const g: Gradient = { type: "linear-gradient", angle: 90, start: 0.25, end: 0.5, stops };
    expect(guideOf(g, { w: 400, h: 200 })).toEqual({
      kind: "line",
      start: { x: 100, y: 100 },
      end: { x: 200, y: 100 },
    });
  });

  it("drags a linear knob to the pointer, turning about the centre", () => {
    const box = { w: 400, h: 200 };
    const across = linear(90) as Extract<Gradient, { type: "linear-gradient" }>;
    // The end pulled in to three quarters across: a shorter ramp, same angle.
    expect(dragLinearKnob(across, box, "end", { x: 300, y: 100 })).toMatchObject({
      angle: 90,
      start: 0,
      end: 0.75,
    });
    // Out past the right edge.
    expect(dragLinearKnob(across, box, "end", { x: 500, y: 100 }).end).toBe(1.25);
    // Down below the centre: the gradient now runs downwards, the knob under the pointer.
    const down = dragLinearKnob(across, box, "end", { x: 200, y: 180 });
    expect(down).toMatchObject({ angle: 180, end: 0.9 });
    const guide = guideOf(down, box);
    if (guide.kind !== "line") throw new Error("line");
    near(guide.end, 200, 180);
    // The start knob, dragged right of the centre, keeps it on the start side (no flip).
    const start = dragLinearKnob(across, box, "start", { x: 50, y: 100 });
    expect(start).toMatchObject({ angle: 90, start: 0.125, end: 1 });
    // Shift: 15° steps, the knob on that line.
    expect(dragLinearKnob(across, box, "end", { x: 380, y: 110 }, true).angle).toBe(90);
  });

  it("sizes a radial gradient by its knobs and keeps its size when moved", () => {
    const box = { w: 400, h: 200 };
    const g = { type: "radial-gradient", stops } as Extract<Gradient, { type: "radial-gradient" }>;
    // Unsized at the centre: farthest side, knobs at the right and bottom edges.
    expect(radiusKnobs(g, box)).toEqual({ x: { x: 400, y: 100 }, y: { x: 200, y: 200 } });
    expect(dragRadius(g, box, "x", { x: 300, y: 40 })).toMatchObject({
      center: { x: 0.5, y: 0.5 },
      radius: { x: 0.25, y: 0.5 },
    });
    // Shift keeps the proportions.
    expect(dragRadius(g, box, "x", { x: 300, y: 100 }, true).radius).toEqual({ x: 0.25, y: 0.25 });
    // Moving the centre pins the size it showed, even outside the box.
    expect(moveCenter(g, box, { x: -40, y: 100 })).toMatchObject({
      center: { x: -0.1, y: 0.5 },
      radius: { x: 0.5, y: 0.5 },
    });
    const conic: Gradient = { type: "conic-gradient", stops };
    expect(moveCenter(conic, box, { x: 100, y: 50 })).toEqual({
      ...conic,
      center: { x: 0.25, y: 0.25 },
    });
  });
});
