import { createSlide, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { depthScale, toLayerSpace } from "./manipulate.js";
import { indexSlide } from "./slide-index.js";

const box = (id: string, extra = {}) => element("shape", { shape: "rect" }, { id, ...extra });

/** root (perspective 1000) > [near (depth 200), card (depth 500, perspective 800) > [inner (depth 400)], flat] */
const slide = createSlide({
  rootId: "root",
  layout: { mode: "absolute" },
  children: [
    box("near", { depth: 200 }),
    frame({
      id: "card",
      layout: { mode: "absolute" },
      depth: 500,
      perspective: 800,
      rotation: 90,
      children: [box("inner", { depth: 400 })],
    }),
    box("flat"),
  ],
});
const index = indexSlide({ ...slide, root: { ...slide.root, perspective: 1000 } });

describe("2.5D in the editor's gestures (D112)", () => {
  it("knows how much bigger depth draws a layer, its frames' depth included", () => {
    expect(depthScale(index, "near")).toBeCloseTo(1.25);
    expect(depthScale(index, "flat")).toBe(1);
    expect(depthScale(index, "card")).toBeCloseTo(2);
    // Inside a card drawn 2×, at depth 400 in the card's perspective 800: 2 × 2.
    expect(depthScale(index, "inner")).toBeCloseTo(4);
  });

  it("turns a drawn drag into the position change that keeps the layer under the cursor", () => {
    expect(toLayerSpace(index, "near", { x: 125, y: -25 })).toEqual({ x: 100, y: -20 });
    expect(toLayerSpace(index, "flat", { x: 7, y: 3 })).toEqual({ x: 7, y: 3 });
    // Rotation undone as before, then the depth: the card is turned 90°, drawn 4× for inner.
    const d = toLayerSpace(index, "inner", { x: 40, y: 0 });
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(-10);
  });
});
