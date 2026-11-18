import { describe, expect, it } from "vitest";
import {
  type Box,
  boundingRect,
  handleDirection,
  normalizeAngle,
  resizeBox,
  resizeCursor,
  rotateBox,
  rotateVector,
  topLeft,
} from "./geometry.js";

/** 200 × 100, top-left at (0, 0). */
const box: Box = { cx: 100, cy: 50, w: 200, h: 100, rotation: 0 };

const close = (a: Box, b: Partial<Box>) => {
  for (const [k, v] of Object.entries(b)) expect(a[k as keyof Box]).toBeCloseTo(v as number, 6);
};

describe("geometry", () => {
  it("maps handles to the sides they pull", () => {
    expect(handleDirection("nw")).toEqual({ x: -1, y: -1 });
    expect(handleDirection("e")).toEqual({ x: 1, y: 0 });
    expect(handleDirection("s")).toEqual({ x: 0, y: 1 });
  });

  it("rotates vectors clockwise (screen y points down)", () => {
    const v = rotateVector({ x: 1, y: 0 }, 90);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  it("resizes from a side, keeping the opposite side in place", () => {
    const r = resizeBox(box, "e", { x: 20, y: 7 }); // vertical movement is ignored
    close(r, { w: 220, h: 100, cx: 110, cy: 50 });
    expect(topLeft(r)).toEqual({ x: 0, y: 0 });
  });

  it("resizes from a corner, keeping the opposite corner in place", () => {
    const r = resizeBox(box, "nw", { x: -10, y: -20 });
    close(r, { w: 210, h: 120, cx: 95, cy: 40 });
    expect(r.cx + r.w / 2).toBeCloseTo(200); // bottom-right corner unchanged
    expect(r.cy + r.h / 2).toBeCloseTo(100);
  });

  it("measures movement along a rotated box's own axes", () => {
    const turned: Box = { cx: 0, cy: 0, w: 200, h: 100, rotation: 90 };
    // Rotated 90°, the "east" handle points down the screen.
    const r = resizeBox(turned, "e", { x: 0, y: 20 });
    close(r, { w: 220, h: 100, cx: 0, cy: 10 });
    // The west side (now at the top) stays put: centre − w/2 along the box's x axis.
    expect(r.cy - r.w / 2).toBeCloseTo(turned.cy - turned.w / 2);
  });

  it("keeps the aspect ratio with Shift", () => {
    close(resizeBox(box, "se", { x: 100, y: 10 }, { keepRatio: true }), { w: 300, h: 150 });
    close(resizeBox(box, "e", { x: 100, y: 0 }, { keepRatio: true }), { w: 300, h: 150 });
    close(resizeBox(box, "n", { x: 0, y: -100 }, { keepRatio: true }), { w: 400, h: 200 });
  });

  it("resizes around the centre with Alt", () => {
    close(resizeBox(box, "e", { x: 20, y: 0 }, { fromCenter: true }), { w: 240, cx: 100 });
  });

  it("never shrinks below the minimum size, and stays anchored", () => {
    const r = resizeBox(box, "e", { x: -500, y: 0 });
    expect(r.w).toBe(1);
    expect(topLeft(r).x).toBeCloseTo(0);
    expect(resizeBox(box, "e", { x: -500, y: 0 }, { minSize: 8 }).w).toBe(8);
  });

  it("normalises angles to (-180, 180]", () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(540)).toBe(180);
  });

  it("rotates by the angle swept around the centre, snapping with Shift", () => {
    const centred: Box = { cx: 0, cy: 0, w: 100, h: 100, rotation: 0 };
    expect(rotateBox(centred, { x: 100, y: 0 }, { x: 0, y: 100 })).toBe(90);
    expect(rotateBox(centred, { x: 100, y: 0 }, { x: 100, y: 30 })).toBe(16.7);
    expect(rotateBox(centred, { x: 100, y: 0 }, { x: 100, y: 30 }, true)).toBe(15);
    expect(rotateBox({ ...centred, rotation: 170 }, { x: 100, y: 0 }, { x: 0, y: 100 })).toBe(-100);
    expect(Object.is(rotateBox(centred, { x: 100, y: 0 }, { x: 100, y: -0.01 }), 0)).toBe(true);
  });

  it("computes the bounding rectangle of a rotated box", () => {
    const r = boundingRect({ ...box, rotation: 90 });
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(200);
    expect(r.x).toBeCloseTo(50);
    expect(r.y).toBeCloseTo(-50);
  });

  it("turns resize cursors with the box", () => {
    expect(resizeCursor("e", 0)).toBe("ew-resize");
    expect(resizeCursor("nw", 0)).toBe("nwse-resize");
    expect(resizeCursor("e", 90)).toBe("ns-resize");
    expect(resizeCursor("e", 40)).toBe("nwse-resize");
    expect(resizeCursor("n", -45)).toBe("nwse-resize");
    expect(resizeCursor("ne", 180)).toBe("nesw-resize");
  });
});
