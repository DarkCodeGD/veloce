import { createDeck, createSlide, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { intersects, marqueeCandidates, marqueeHits, rectBetween } from "./marquee.js";
import { indexSlide } from "./slide-index.js";

const text = (id: string, extra = {}) => element("text", { content: id }, { id, ...extra });

/** root > [card > [title, empty frame], loose, locked > [inner], hidden] */
const index = indexSlide(
  createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          frame({ id: "card", children: [text("title"), frame({ id: "empty", children: [] })] }),
          text("loose"),
          frame({ id: "locked", locked: true, children: [text("inner")] }),
          text("hidden", { hidden: true }),
        ],
      }),
    ],
  }).slides[0] as never,
);

describe("marquee", () => {
  it("normalizes the dragged rectangle in any direction", () => {
    expect(rectBetween({ x: 50, y: 10 }, { x: 20, y: 40 })).toEqual({ x: 20, y: 10, w: 30, h: 30 });
  });

  it("intersects when touching or overlapping", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(intersects(a, { x: 10, y: 10, w: 5, h: 5 })).toBe(true);
    expect(intersects(a, { x: 5, y: 5, w: 1, h: 1 })).toBe(true); // inside
    expect(intersects(a, { x: 11, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it("catches top-level layers, or the deepest ones with Ctrl, never locked/hidden", () => {
    expect(marqueeCandidates(index, false)).toEqual(["card", "loose"]);
    expect(marqueeCandidates(index, true)).toEqual(["title", "empty", "loose"]);
  });

  it("returns the touched candidates in document order", () => {
    const candidates = [
      { id: "a", rect: { x: 0, y: 0, w: 10, h: 10 } },
      { id: "b", rect: { x: 100, y: 0, w: 10, h: 10 } },
      { id: "c", rect: { x: 5, y: 50, w: 10, h: 10 } },
    ];
    expect(marqueeHits(candidates, { x: 8, y: 8, w: 4, h: 50 })).toEqual(["a", "c"]);
  });
});
