import { describe, expect, it } from "vitest";
import {
  childIndexForSlot,
  dropTarget,
  type FrameSnapshot,
  insertionIndex,
  insertionLine,
  insideDropZone,
} from "./reorder.js";

const cell = (x: number, y: number) => ({ x, y, w: 100, h: 100 });

describe("reorder", () => {
  it("skips free layers when turning a slot into a child index", () => {
    // [flow0, FREE, flow1, FREE]: free layers aren't slots, and stay on top.
    const kids = [{ free: false }, { free: true }, { free: false }, { free: true }];
    expect(childIndexForSlot(kids, 0)).toBe(0); // before flow0
    expect(childIndexForSlot(kids, 1)).toBe(2); // before flow1 (after the free one)
    expect(childIndexForSlot(kids, 2)).toBe(3); // after flow1, below the trailing free one
    expect(childIndexForSlot([{ free: true }], 0)).toBe(0); // no flow: under the free ones
    expect(childIndexForSlot([], 0)).toBe(0);
  });

  it("inserts by the siblings' centres along a row or a column", () => {
    const row = [0, 100, 200].map((x) => ({ x, y: 0, w: 80, h: 40 })); // centres 40, 140, 240
    expect(insertionIndex({ x: 10, y: 0 }, row, "row")).toBe(0);
    expect(insertionIndex({ x: 150, y: 0 }, row, "row")).toBe(2);
    expect(insertionIndex({ x: 300, y: 0 }, row, "row")).toBe(3);
    const column = [0, 50].map((y) => ({ x: 0, y, w: 80, h: 40 }));
    expect(insertionIndex({ x: 0, y: 45 }, column, "column")).toBe(1);
    expect(insertionIndex({ x: 0, y: 0 }, [], "column")).toBe(0);
  });

  it("inserts before or after the nearest grid cell", () => {
    const grid = [cell(0, 0), cell(100, 0), cell(0, 100), cell(100, 100)];
    expect(insertionIndex({ x: 40, y: 50 }, grid, "grid")).toBe(0);
    expect(insertionIndex({ x: 60, y: 60 }, grid, "grid")).toBe(1);
    expect(insertionIndex({ x: 160, y: 50 }, grid, "grid")).toBe(2);
    expect(insertionIndex({ x: 40, y: 190 }, grid, "grid")).toBe(2);
  });

  it("treats a frame's edges along the parent's flow as 'beside', not 'into'", () => {
    const frame = { x: 0, y: 0, w: 200, h: 100 };
    expect(insideDropZone({ x: 100, y: 50 }, frame, "column", 12)).toBe(true);
    expect(insideDropZone({ x: 100, y: 5 }, frame, "column", 12)).toBe(false);
    expect(insideDropZone({ x: 5, y: 50 }, frame, "row", 12)).toBe(false);
    expect(insideDropZone({ x: 5, y: 5 }, frame, "absolute", 12)).toBe(true);
    // Small frames: the band shrinks to a quarter, so the middle still accepts drops.
    expect(insideDropZone({ x: 0, y: 10 }, { x: 0, y: 0, w: 40, h: 20 }, "column", 12)).toBe(true);
  });
});

describe("drop targets", () => {
  const snap = (
    id: string,
    parentId: string | null,
    depth: number,
    rect: { x: number; y: number; w: number; h: number },
    flow: FrameSnapshot["flow"],
    locked = false,
  ): FrameSnapshot => ({ id, parentId, depth, rect, content: rect, flow, locked, children: [] });
  const frames = [
    snap("root", null, 0, { x: 0, y: 0, w: 1000, h: 600 }, "column"),
    snap("card", "root", 1, { x: 100, y: 100, w: 400, h: 200 }, "row"),
    snap("vault", "root", 1, { x: 600, y: 100, w: 200, h: 200 }, "column", true),
  ];

  it("picks the innermost frame under the pointer", () => {
    expect(dropTarget(frames, { x: 300, y: 200 }, 12)?.id).toBe("card");
    expect(dropTarget(frames, { x: 50, y: 50 }, 12)?.id).toBe("root");
    expect(dropTarget(frames, { x: 2000, y: 50 }, 12)).toBeNull();
  });

  it("treats the edge of a frame in a column as 'beside it'", () => {
    expect(dropTarget(frames, { x: 300, y: 105 }, 12)?.id).toBe("root");
  });

  it("never drops into a locked frame", () => {
    expect(dropTarget(frames, { x: 700, y: 200 }, 12)?.id).toBe("root");
  });

  it("draws the insertion line between siblings, or at the start of an empty frame", () => {
    const column = [
      { x: 0, y: 0, w: 100, h: 40 },
      { x: 0, y: 60, w: 100, h: 40 },
    ];
    const content = { x: 0, y: 0, w: 100, h: 200 };
    expect(insertionLine(column, 1, "column", content)).toEqual({ x1: 0, y1: 50, x2: 100, y2: 50 });
    expect(insertionLine(column, 2, "column", content)).toEqual({
      x1: 0,
      y1: 100,
      x2: 100,
      y2: 100,
    });
    expect(insertionLine([], 0, "row", content)).toEqual({ x1: 0, y1: 0, x2: 0, y2: 200 });
    const row = [
      { x: 0, y: 0, w: 40, h: 30 },
      { x: 60, y: 0, w: 40, h: 30 },
    ];
    expect(insertionLine(row, 1, "row", content)).toEqual({ x1: 50, y1: 0, x2: 50, y2: 30 });
  });
});
