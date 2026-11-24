import { describe, expect, it } from "vitest";
import { mixColors, rgbaToHex } from "../color-mix.js";
import { CSS_EASING_CURVES, cubicBezier, easingFunction, linear, springEasing } from "../easing.js";

/**
 * Points on a Bézier curve by its parameter, computed directly: the truth to solve back.
 * `steep` marks where the curve's x barely moves (a vertical tangent): there y changes like
 * the cube root of x, so even a perfect float64 solve can't pin y to a millionth.
 */
function curvePoints(x1: number, y1: number, x2: number, y2: number, n = 400) {
  const at = (p1: number, p2: number, u: number) =>
    3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u ** 2 * p2 + u ** 3;
  const slope = (p1: number, p2: number, u: number) =>
    3 * (1 - u) ** 2 * p1 + 6 * (1 - u) * u * (p2 - p1) + 3 * u ** 2 * (1 - p2);
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    return { x: at(x1, x2, u), y: at(y1, y2, u), steep: Math.abs(slope(x1, x2, u)) < 0.01 };
  });
}

describe("cubic Bézier easing (D114)", () => {
  it("matches CSS's curves, ends exact", () => {
    const ease = easingFunction("ease");
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.8024033877, 8); // cubic-bezier(0.25, 0.1, 0.25, 1) at 50%
    const inOut = easingFunction("ease-in-out");
    for (const x of [0.1, 0.25, 0.4]) expect(inOut(x) + inOut(1 - x)).toBeCloseTo(1, 9);
    expect(easingFunction("linear")).toBe(linear);
  });

  it("solves every kind of curve to within a millionth, flat ends and overshoot included", () => {
    const curves: [number, number, number, number][] = [
      ...Object.values(CSS_EASING_CURVES).map((c) => [...c] as [number, number, number, number]),
      [0.16, 1, 0.3, 1], // Veloce's enter
      [1, 0, 0, 1], // x stalls mid-curve: Newton can't step there, bisection finishes
      [0, 0.5, 1, 0.5], // x stalls at both ends
      [0.34, 1.56, 0.64, 1], // overshoots
      [0.7, -0.6, 0.3, 1.6], // undershoots, then overshoots
    ];
    for (const curve of curves) {
      const fn = cubicBezier(...curve);
      for (const { x, y, steep } of curvePoints(...curve)) {
        if (x <= 0 || x >= 1) continue;
        expect(Math.abs(fn(x) - y), `${curve} at ${x}`).toBeLessThan(steep ? 0.01 : 1e-6);
      }
    }
    expect(Math.max(...curvePoints(0.34, 1.56, 0.64, 1).map((p) => p.y))).toBeGreaterThan(1);
  });

  it("is the identity when the control points sit on the diagonal", () => {
    expect(cubicBezier(0.3, 0.3, 0.8, 0.8)).toBe(linear);
  });
});

describe("springs that settle in their duration (D114)", () => {
  const samples = (fn: (p: number) => number, n = 1000) =>
    Array.from({ length: n + 1 }, (_, i) => fn(i / n));

  it("starts at 0 and ends exactly on 1, with no jump at the end", () => {
    for (const bounce of [0, 0.15, 0.3, 0.6, 1]) {
      const fn = springEasing(bounce);
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
      expect(Math.abs(fn(1 - 1e-9) - 1)).toBeLessThan(1e-6);
      // Settled: in the last 2% of its duration it's within 0.2% of the end.
      for (const p of [0.98, 0.99, 0.995]) expect(Math.abs(fn(p) - 1)).toBeLessThan(0.002);
    }
  });

  it("bounce 0 never overshoots; more bounce overshoots further", () => {
    const calm = samples(springEasing(0));
    expect(Math.max(...calm)).toBeLessThanOrEqual(1);
    calm.slice(1).forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(calm[i] ?? 0);
    });
    const peaks = [0.2, 0.4, 0.6, 0.8].map((b) => Math.max(...samples(springEasing(b))));
    for (const peak of peaks) expect(peak).toBeGreaterThan(1);
    peaks.slice(1).forEach((peak, i) => {
      expect(peak).toBeGreaterThan(peaks[i] ?? 0);
    });
  });

  it("gives the same curve every time: pinned values, since exports replay them", () => {
    expect(springEasing(0)(0.25)).toBeCloseTo(0.6713175, 7);
    expect(springEasing(0.3)(0.25)).toBeCloseTo(0.8508905, 7);
    // How far each bounce overshoots: tasteful at Ember's 0.3, wild at 1 (absurd).
    const peak = (b: number) => Math.max(...samples(springEasing(b), 2000));
    expect([0.3, 0.5, 1].map((b) => Number(peak(b).toFixed(3)))).toEqual([1.035, 1.126, 1.729]);
    expect(easingFunction({ spring: { bounce: 0.3 } })).toBe(
      easingFunction({ spring: { bounce: 0.3 } }),
    );
    expect(easingFunction({ spring: {} })(0.25)).toBe(springEasing(0)(0.25));
  });
});

describe("colors in between (D114)", () => {
  it("keeps the ends exact and blends through OKLab", () => {
    const black = [0, 0, 0, 1] as const;
    const white = [255, 255, 255, 1] as const;
    expect(mixColors(black, white, 0)).toBe(black);
    expect(mixColors(black, white, 1)).toBe(white);
    // OKLab's middle grey is perceptually halfway: #636363, not sRGB's #808080.
    expect(rgbaToHex(mixColors(black, white, 0.5))).toBe("#636363");
    // Red to green passes through a warm yellow-brown, not grey.
    const [r, g, b] = mixColors([255, 0, 0, 1], [0, 255, 0, 1], 0.5);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeLessThan(40);
  });

  it("fades to transparent without changing hue (alpha is premultiplied)", () => {
    const mid = mixColors([255, 0, 0, 1], [0, 0, 0, 0], 0.5);
    expect(rgbaToHex(mid)).toBe("#ff000080");
    expect(mixColors([0, 0, 0, 0], [0, 0, 0, 0], 0.5)).toEqual([0, 0, 0, 0]);
  });

  it("writes hex a document accepts, clamped", () => {
    expect(rgbaToHex([255, 128, 0, 1])).toBe("#ff8000");
    expect(rgbaToHex([300, -5, 0.4, 0.5])).toBe("#ff000080");
  });
});
