import { describe, expect, it } from "vitest";
import { anchoredPosition, shiftAnchored, startPosition } from "../anchor.js";
import { NodeSchema } from "../schema/node.js";

const size = { w: 100, h: 40 };
const content = { w: 800, h: 400 };

describe("anchors", () => {
  it("validates per-axis edges", () => {
    const node = { id: "b", kind: "element", type: "text", props: {} };
    expect(NodeSchema.safeParse({ ...node, anchor: { x: "end", y: "center" } }).success).toBe(true);
    expect(NodeSchema.safeParse({ ...node, anchor: { x: "right" } }).success).toBe(false);
    expect(NodeSchema.safeParse({ ...node, anchor: { z: "end" } }).success).toBe(false);
  });

  it("converts between the start edge and each anchor, both ways", () => {
    const start = { x: 684, y: 16 }; // a badge 16px in from the top-right corner
    const pinned = anchoredPosition(start, { x: "end" }, size, content);
    expect(pinned).toEqual({ x: 16, y: 16 });
    expect(startPosition(pinned, { x: "end" }, size, content)).toEqual(start);

    const centered = anchoredPosition(
      { x: 350, y: 180 },
      { x: "center", y: "center" },
      size,
      content,
    );
    expect(centered).toEqual({ x: 0, y: 0 });
    expect(startPosition({ x: 10, y: -20 }, { x: "center", y: "end" }, size, content)).toEqual({
      x: 360,
      y: 380,
    });
    // No anchor: start-edge positions as they always were.
    expect(anchoredPosition(start, undefined, size, content)).toEqual(start);
  });

  it("turns a move of the start edge into each anchor", () => {
    const d = { x: 10, y: 5 };
    expect(shiftAnchored({ x: 16, y: 16 }, undefined, d)).toEqual({ x: 26, y: 21 });
    expect(shiftAnchored({ x: 16, y: 16 }, { x: "end", y: "end" }, d)).toEqual({ x: 6, y: 11 });
    expect(shiftAnchored({ x: 0, y: 0 }, { x: "center" }, d)).toEqual({ x: 10, y: 5 });
  });

  it("keeps the anchored edge when a resize grows the layer", () => {
    // Dragging the left handle 20px left: the start edge moves -20 and the layer grows 20.
    const d = { x: -20, y: 0 };
    const grow = { w: 20, h: 0 };
    expect(shiftAnchored({ x: 16, y: 0 }, { x: "end" }, d, grow)).toEqual({ x: 16, y: 0 });
    expect(shiftAnchored({ x: 100, y: 0 }, undefined, d, grow)).toEqual({ x: 80, y: 0 });
    // The right handle 20px right: the start edge stays, so the right inset shrinks.
    expect(shiftAnchored({ x: 16, y: 0 }, { x: "end" }, { x: 0, y: 0 }, grow)).toEqual({
      x: -4,
      y: 0,
    });
    expect(shiftAnchored({ x: 0, y: 0 }, { x: "center" }, { x: 0, y: 0 }, grow)).toEqual({
      x: 10,
      y: 0,
    });
  });
});
