import { describe, expect, it } from "vitest";
import {
  nearestStop,
  snapValue,
  stopForKey,
  stopFraction,
  valueAt,
  valueForKey,
  valueFraction,
} from "./slider.js";

describe("stepped sliders (D122)", () => {
  it("spreads stops evenly and snaps a point to the nearest", () => {
    expect([0, 1, 2, 3, 4].map((i) => stopFraction(i, 5))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(nearestStop(0.6, 5)).toBe(2);
    expect(nearestStop(0.63, 5)).toBe(3);
    expect(nearestStop(-3, 5)).toBe(0);
    expect(nearestStop(9, 5)).toBe(4);
    expect(stopFraction(0, 1)).toBe(0);
  });

  it("moves by keys like a native slider, never past the ends", () => {
    expect(stopForKey("ArrowRight", 1, 5)).toBe(2);
    expect(stopForKey("ArrowDown", 1, 5)).toBe(0);
    expect(stopForKey("ArrowLeft", 0, 5)).toBe(0);
    expect(stopForKey("PageUp", 3, 5)).toBe(4);
    expect([stopForKey("Home", 3, 5), stopForKey("End", 1, 5)]).toEqual([0, 4]);
    expect(stopForKey("a", 1, 5)).toBeNull();
  });
});

describe("continuous sliders (D122)", () => {
  const range = { min: 0, max: 2, step: 0.1 };

  it("snaps to the step without float dust, and keeps in range", () => {
    expect(snapValue(0.30000000000000004, range)).toBe(0.3);
    expect(snapValue(5, range)).toBe(2);
    expect(snapValue(0.14, { min: 0, max: 1, step: 0.25 })).toBe(0.25);
    expect(valueAt(0.5, range)).toBe(1);
    expect(valueFraction(1.5, range)).toBe(0.75);
    expect(valueFraction(3, { min: 3, max: 3 })).toBe(0);
  });

  it("moves by keys: a step, ten with Shift, a tenth of the range by page", () => {
    expect(valueForKey("ArrowUp", 1, range)).toBe(1.1);
    expect(valueForKey("ArrowLeft", 1, range, true)).toBe(0);
    expect(valueForKey("PageUp", 1, { min: 0, max: 500, step: 1 })).toBe(51);
    expect(valueForKey("End", 1, range)).toBe(2);
    expect(valueForKey("Enter", 1, range)).toBeNull();
  });
});
