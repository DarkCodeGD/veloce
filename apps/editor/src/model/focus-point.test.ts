import { describe, expect, it } from "vitest";
import {
  CENTER,
  crops,
  focusAt,
  focusOf,
  focusText,
  nudgeFocus,
  visibleCrop,
} from "./focus-point.js";

describe("image focus point (D82)", () => {
  it("reads stored values safely: missing is the centre, out of range is clamped", () => {
    expect(focusOf(undefined)).toEqual(CENTER);
    expect(focusOf({ x: 0.2, y: 0.9 })).toEqual({ x: 0.2, y: 0.9 });
    expect(focusOf({ x: 50, y: -1 })).toEqual({ x: 1, y: 0 }); // an agent's 50 (meaning %)
    expect(focusOf({ x: "a" })).toEqual(CENTER);
  });

  it("shows which part a cover fit keeps, sliding toward the focus", () => {
    // A 1600×900 photo in a square box: a 900×900 slice, 9/16 of the width.
    const image = { w: 1600, h: 900 };
    const square = { w: 300, h: 300 };
    const centred = visibleCrop(image, square, CENTER);
    expect(centred.w).toBeCloseTo(0.5625);
    expect(centred.x).toBeCloseTo(0.21875);
    expect([centred.y, centred.h]).toEqual([0, 1]);
    expect(visibleCrop(image, square, { x: 0, y: 0.5 }).x).toBe(0); // left edge
    expect(visibleCrop(image, square, { x: 1, y: 0.5 }).x).toBeCloseTo(0.4375); // right edge
    // A wide, short box crops top and bottom instead.
    const banner = visibleCrop(image, { w: 1600, h: 300 }, { x: 0.5, y: 0.2 });
    expect(banner.w).toBe(1);
    expect(banner.h).toBeCloseTo(1 / 3);
    expect(banner.y).toBeCloseTo((2 / 3) * 0.2);
    // Same shape as the image: nothing cropped, the focus changes nothing.
    const same = visibleCrop(image, { w: 800, h: 450 }, { x: 0.9, y: 0.1 });
    expect(crops(same)).toBe(false);
    expect(crops(visibleCrop(image, square, CENTER))).toBe(true);
    expect(visibleCrop(image, { w: 0, h: 0 }, CENTER)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("turns a pointer on the preview into a focus, kept on the image, to 0.1%", () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    expect(focusAt({ x: 150, y: 75 }, rect)).toEqual({ x: 0.25, y: 0.25 });
    expect(focusAt({ x: 0, y: 500 }, rect)).toEqual({ x: 0, y: 1 });
    expect(focusAt({ x: 100 + 200 / 3, y: 50 }, rect)).toEqual({ x: 0.333, y: 0 });
  });

  it("nudges with the arrow keys, 1% or 10% with Shift, never off the image", () => {
    expect(nudgeFocus({ x: 0.5, y: 0.5 }, "ArrowRight", false)).toEqual({ x: 0.51, y: 0.5 });
    expect(nudgeFocus({ x: 0.5, y: 0.5 }, "ArrowUp", true)).toEqual({ x: 0.5, y: 0.4 });
    expect(nudgeFocus({ x: 0.05, y: 0.5 }, "ArrowLeft", true)).toEqual({ x: 0, y: 0.5 });
    expect(nudgeFocus(CENTER, "Enter", false)).toBeNull();
    expect(focusText({ x: 0.5, y: 0.204 })).toBe("50% across, 20% down");
  });
});
