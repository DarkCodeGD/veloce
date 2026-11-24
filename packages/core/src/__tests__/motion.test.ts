import { describe, expect, it } from "vitest";
import { isRestMotion, resolveMotion, sameMotion } from "../motion.js";

describe("motion state (D103)", () => {
  it("fills omitted fields with their rest values", () => {
    expect(resolveMotion(undefined)).toEqual({
      x: 0,
      y: 0,
      z: 0,
      rotate: 0,
      rotateX: 0,
      rotateY: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      blur: 0,
    });
    expect(resolveMotion({ x: 12, opacity: 0.5 })).toMatchObject({ x: 12, y: 0, opacity: 0.5 });
  });

  it("keeps broken values from reaching the renderer: clamps and drops non-finite numbers", () => {
    const resolved = resolveMotion({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      opacity: 1.4, // an easing overshoot
      blur: -3,
      scale: -0.2,
      scaleX: -1,
      scaleY: 2,
    });
    expect(resolved).toMatchObject({ x: 0, y: 0, opacity: 1, blur: 0, scale: 0, scaleX: 0 });
    expect(resolved.scaleY).toBe(2);
    expect(resolveMotion({ opacity: -0.2 }).opacity).toBe(0);
  });

  it("knows a motion that draws the layer at rest", () => {
    expect(isRestMotion(undefined)).toBe(true);
    expect(isRestMotion({})).toBe(true);
    expect(isRestMotion({ x: 0, scale: 1, opacity: 1 })).toBe(true);
    expect(isRestMotion({ opacity: 2 })).toBe(true); // clamped to 1
    expect(isRestMotion({ x: 0.5 })).toBe(false);
    expect(isRestMotion({ opacity: 0 })).toBe(false);
  });

  it("compares motions by how they draw, not by object identity", () => {
    expect(sameMotion({ x: 4 }, { x: 4, y: 0 })).toBe(true);
    expect(sameMotion(undefined, {})).toBe(true);
    expect(sameMotion({ x: 4 }, { x: 5 })).toBe(false);
    expect(sameMotion({ scale: 2 }, { scaleX: 2, scaleY: 2 })).toBe(false); // other fields
  });
});
