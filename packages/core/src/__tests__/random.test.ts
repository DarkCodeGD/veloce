import { describe, expect, it } from "vitest";
import { easingFunction } from "../easing.js";
import { createRandom, hashSeed, randomAt, staggerDelays } from "../random.js";

describe("seeded randomness (D114)", () => {
  it("gives the same number for the same seed and index, in [0, 1)", () => {
    expect(randomAt(42, 7)).toBe(randomAt(42, 7));
    expect(randomAt(42, 7)).not.toBe(randomAt(43, 7));
    expect(randomAt(42, 7)).not.toBe(randomAt(42, 8));
    const draws = Array.from({ length: 20_000 }, (_, i) => randomAt(9, i));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...draws)).toBeLessThan(1);
    // Even: each tenth of [0, 1) gets close to a tenth of the draws.
    const buckets = new Array<number>(10).fill(0);
    for (const d of draws) buckets[Math.floor(d * 10)] = (buckets[Math.floor(d * 10)] ?? 0) + 1;
    for (const count of buckets) expect(Math.abs(count - 2000)).toBeLessThan(200);
  });

  it("never changes between versions: exported videos replay these exact numbers", () => {
    expect(hashSeed("an-sparkle")).toBe(hashSeed("an-sparkle"));
    expect([hashSeed("an-sparkle"), randomAt(42, 0), randomAt(42, 1)]).toMatchInlineSnapshot(`
      [
        2001211718,
        0.6275841607712209,
        0.04238911787979305,
      ]
    `);
  });

  it("seeds from any parts, telling their types and boundaries apart", () => {
    expect(hashSeed("a", "b")).not.toBe(hashSeed("ab"));
    expect(hashSeed(1)).not.toBe(hashSeed("1"));
    expect(hashSeed()).toBe(hashSeed());
  });

  it("draws in turn the same numbers it gives by index", () => {
    const next = createRandom(5);
    expect([next(), next(), next()]).toEqual([0, 1, 2].map((i) => randomAt(5, i)));
  });
});

describe("stagger (D114)", () => {
  it("delays items one after another from where it starts", () => {
    expect(staggerDelays(3, 80)).toEqual([0, 80, 160]);
    expect(staggerDelays(3, 80, { from: "end" })).toEqual([160, 80, 0]);
    expect(staggerDelays(5, 80, { from: "center" })).toEqual([160, 80, 0, 80, 160]);
    expect(staggerDelays(4, 80, { from: "center" })).toEqual([80, 0, 0, 80]);
    expect(staggerDelays(5, 80, { from: "edges" })).toEqual([0, 80, 160, 80, 0]);
    expect(staggerDelays(4, 80, { from: 1 })).toEqual([80, 0, 80, 160]);
    expect(staggerDelays(0, 80)).toEqual([]);
    expect(staggerDelays(1, 80)).toEqual([0]);
  });

  it("shuffles the same way for the same seed", () => {
    const a = staggerDelays(8, 10, { from: "random", seed: 1 });
    expect([...a].sort((x, y) => x - y)).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    expect(staggerDelays(8, 10, { from: "random", seed: 1 })).toEqual(a);
    expect(staggerDelays(8, 10, { from: "random", seed: 2 })).not.toEqual(a);
  });

  it("spreads delays along an easing, keeping their order and span", () => {
    const eased = staggerDelays(5, 100, { easing: easingFunction("ease-in") });
    expect(eased[0]).toBe(0);
    expect(eased[4]).toBe(400);
    eased.slice(1).forEach((d, i) => {
      expect(d).toBeGreaterThan(eased[i] ?? 0);
    });
    expect(eased[2]).toBeLessThan(200); // ease-in: bunched at the start
  });
});
