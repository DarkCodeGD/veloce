import { element } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { LINE_PAD, lineBox, lineEnds, lineReadout, moveLineEnd, snapAngle } from "./line-ends.js";

describe("lines on the canvas (D127)", () => {
  it("boxes a drawn line around its ends, which keep their direction", () => {
    // Drawn up and to the right: from the bottom-left of its box to the top-right.
    const box = lineBox({ x: 100, y: 300 }, { x: 300, y: 100 });
    expect(box.rect).toEqual({ x: 100 - LINE_PAD, y: 100 - LINE_PAD, w: 232, h: 232 });
    expect(box.from.x).toBeCloseTo(LINE_PAD / 232, 3);
    expect(box.from.y).toBeCloseTo(1 - LINE_PAD / 232, 3);
    expect(box.to.x).toBeCloseTo(1 - LINE_PAD / 232, 3);
    // A flat line still gets a box with room for its heads.
    expect(lineBox({ x: 0, y: 50 }, { x: 200, y: 50 }).rect.h).toBe(2 * LINE_PAD);
  });

  it("snaps to 45° steps and reads out length and angle", () => {
    const snapped = snapAngle({ x: 0, y: 0 }, { x: 100, y: -90 });
    expect(snapped.x).toBeCloseTo(-snapped.y, 6); // up-right at 45°
    expect(snapAngle({ x: 0, y: 0 }, { x: 100, y: 10 }).y).toBeCloseTo(0, 6);
    expect(lineReadout({ x: 0, y: 0 }, { x: 100, y: -100 })).toBe("141 px · 45°");
    expect(lineReadout({ x: 0, y: 0 }, { x: -50, y: 0 })).toBe("50 px · 180°");
  });

  it("reads a line's ends with the element's defaults", () => {
    expect(lineEnds(element("line", {}))).toEqual({ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } });
    expect(lineEnds(element("line", { to: { x: 0.5, y: 0 } })).to).toEqual({ x: 0.5, y: 0 });
  });

  it("refits a free line's box when an end moves, keeping the other end in place", () => {
    const size = { w: 232, h: 32 };
    const ends = { from: { x: 16 / 232, y: 0.5 }, to: { x: 216 / 232, y: 0.5 } };
    // Drag the end 100px down: the box grows down, its top-left stays.
    const next = moveLineEnd(size, ends, "to", { x: 216, y: 116 }, true);
    expect(next.size).toEqual({ w: 232, h: 132 });
    expect(next.moved).toEqual({ x: 0, y: 0 });
    const px = (f: { x: number; y: number }) => ({
      x: Math.round(f.x * 232),
      y: Math.round(f.y * 132),
    });
    expect(px(next.from)).toEqual({ x: 16, y: 16 }); // the start end hasn't moved
    expect(px(next.to)).toEqual({ x: 216, y: 116 });
    // Drag the start end past the left edge: the box moves left with it.
    const left = moveLineEnd(size, ends, "from", { x: -84, y: 16 }, true);
    expect(left.moved).toEqual({ x: -100, y: 0 });
  });

  it("keeps the end inside the box when the layout owns it", () => {
    const ends = { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } };
    const next = moveLineEnd({ w: 200, h: 40 }, ends, "to", { x: 260, y: -20 }, false);
    expect(next).toEqual({ from: ends.from, to: { x: 1, y: 0 } });
    expect(next.size).toBeUndefined();
  });
});
