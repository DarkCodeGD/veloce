import { describe, expect, it } from "vitest";
import { guidesFor, snapAxis, snapMove } from "./snapping.js";

describe("snapping", () => {
  it("picks the smallest correction within the threshold", () => {
    expect(snapAxis([0, 50, 100], [103, 300], 5)).toBe(3);
    expect(snapAxis([0, 50, 100], [103, 300], 2)).toBeNull();
    expect(snapAxis([10], [7, 12], 5)).toBe(2);
  });

  it("snaps an edge to a sibling's edge and shows a guide spanning both", () => {
    const frame = { x: 0, y: 0, w: 100, h: 100 };
    const result = snapMove({ x: 98, y: 10, w: 50, h: 50 }, [frame], 4);
    expect(result).toEqual({ dx: 2, dy: 0, guides: [{ axis: "x", at: 100, from: 0, to: 100 }] });
  });

  it("snaps centres to centres", () => {
    const sibling = { x: 0, y: 0, w: 100, h: 40 }; // centre y = 20
    const result = snapMove({ x: 300, y: 3, w: 60, h: 30 }, [sibling], 4); // centre y = 18
    expect(result.dy).toBe(2);
    expect(result.guides).toEqual([{ axis: "y", at: 20, from: 0, to: 360 }]);
  });

  it("only draws guides on the axes that snapped", () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(guidesFor(r, [r], { x: false, y: false })).toEqual([]);
    expect(guidesFor(r, [r], { x: true, y: false }).every((g) => g.axis === "x")).toBe(true);
  });
});
