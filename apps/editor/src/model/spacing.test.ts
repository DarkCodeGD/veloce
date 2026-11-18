import { describe, expect, it } from "vitest";
import { measureBetween, spacingAround } from "./spacing.js";

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("spacingAround", () => {
  const container = r(0, 0, 1000, 600);

  it("measures to the nearest facing neighbour on each side", () => {
    const moving = r(300, 200, 100, 100);
    const neighbours = [
      r(100, 220, 50, 50), // left, gap 150
      r(200, 250, 40, 100), // left and nearer, gap 60
      r(450, 0, 50, 210), // right, overlaps y 200..210
      r(100, 400, 50, 50), // below but not facing (diagonal)
    ];
    const ms = spacingAround(moving, neighbours, container);
    expect(ms).toContainEqual({ dir: "h", from: 240, to: 300, at: 275, value: 60 });
    expect(ms).toContainEqual({ dir: "h", from: 400, to: 450, at: 205, value: 50 });
    // No facing neighbour above or below: the container edges.
    expect(ms).toContainEqual({ dir: "v", from: 0, to: 200, at: 350, value: 200 });
    expect(ms).toContainEqual({ dir: "v", from: 300, to: 600, at: 350, value: 300 });
    expect(ms).toHaveLength(4);
  });

  it("leaves out zero gaps and container edges the layer sticks out of", () => {
    const ms = spacingAround(r(0, 50, 100, 100), [], container);
    expect(ms.map((m) => m.value)).toEqual([900, 50, 450]);
    expect(spacingAround(r(-10, 50, 100, 100), [], container)).toEqual([]);
  });
});

describe("measureBetween", () => {
  it("measures the four inner gaps when one is inside the other", () => {
    const ms = measureBetween(r(10, 20, 30, 40), r(0, 0, 100, 100));
    expect(ms.map((m) => m.value)).toEqual([10, 60, 20, 40]);
    // Same, the other way round.
    expect(measureBetween(r(0, 0, 100, 100), r(10, 20, 30, 40)).map((m) => m.value)).toEqual([
      10, 60, 20, 40,
    ]);
  });

  it("measures horizontal and vertical gaps between layers apart", () => {
    expect(measureBetween(r(0, 0, 10, 10), r(30, 5, 10, 10))).toEqual([
      { dir: "h", from: 10, to: 30, at: 7.5, value: 20 },
    ]);
    expect(measureBetween(r(0, 0, 10, 10), r(30, 40, 10, 10)).map((m) => m.value)).toEqual([
      20, 30,
    ]);
    expect(measureBetween(r(0, 0, 10, 10), r(5, 5, 10, 10))).toEqual([]); // overlapping
  });
});
