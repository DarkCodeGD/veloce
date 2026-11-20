import { describe, expect, it } from "vitest";
import { colorAt, parseGradient, rangesUnder, samplesIn } from "./gradient-sample.js";

const red = "rgb(255, 0, 0)";
const clear = "rgba(255, 0, 0, 0)";
const near = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 2);
  expect(a[1]).toBeCloseTo(b[1], 2);
};

describe("gradient sampling for contrast (agent report B4)", () => {
  it("parses what Chromium reports, defaults included", () => {
    expect(parseGradient(`linear-gradient(${red} 0%, ${clear} 100%)`)).toMatchObject({
      kind: "linear",
      angle: 180,
      stops: [{ at: 0 }, { at: 1 }],
    });
    expect(parseGradient(`linear-gradient(to right, ${red}, ${clear})`)?.angle).toBe(90);
    expect(
      parseGradient(`radial-gradient(farthest-side at 28% 42%, ${red} 0%, ${clear} 100%)`),
    ).toMatchObject({ kind: "radial", center: { x: 0.28, y: 0.42 } });
    const conic = parseGradient(
      `conic-gradient(from 45deg at 30% 70%, color(srgb 1 0 0 / 0.3) 0%, ${red} 100%)`,
    );
    expect(conic).toMatchObject({ kind: "conic", angle: 45, center: { x: 0.3, y: 0.7 } });
    expect(conic?.stops[0]?.color[3]).toBeCloseTo(0.3);
    expect(parseGradient(`url("x.png")`)).toBeNull();
    // A sized ellipse (D88), as Chromium reports it.
    expect(
      parseGradient(`radial-gradient(60% 25% at -10% 30%, ${red} 0%, ${clear} 100%)`),
    ).toMatchObject({ center: { x: -0.1, y: 0.3 }, radius: { x: 0.6, y: 0.25 } });
  });

  it("radial: a sized ellipse ends where it was sized, not at the farthest side", () => {
    const g = parseGradient(`radial-gradient(25% 25% at 50% 50%, ${red} 0%, ${clear} 100%)`);
    if (!g) throw new Error("no gradient");
    // 400×400 box, radius 100: a text box 50–100 px right of the centre spans t 0.5–1.
    near(
      rangesUnder(g, 400, 400, { left: 250, top: 195, right: 300, bottom: 205 })[0] as [
        number,
        number,
      ],
      [0.5, 1],
    );
  });

  it("linear: only the stretch the text box covers", () => {
    const g = parseGradient(`linear-gradient(180deg, ${red} 0%, ${clear} 100%)`);
    if (!g) throw new Error("no gradient");
    // A 400 px tall card, text in its bottom fifth: the nearly transparent end.
    const [range] = rangesUnder(g, 600, 400, { left: 40, top: 320, right: 560, bottom: 380 });
    near(range as [number, number], [0.8, 0.95]);
    const alphas = samplesIn(g, [range as [number, number]]).map((c) => c[3]);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.2 + 1e-9);
    // 90°: left to right.
    const across = parseGradient(`linear-gradient(90deg, ${red} 0%, ${clear} 100%)`);
    if (!across) throw new Error("no gradient");
    near(
      rangesUnder(across, 1000, 100, { left: 0, top: 0, right: 250, bottom: 100 })[0] as [
        number,
        number,
      ],
      [0, 0.25],
    );
  });

  it("radial: from the nearest to the farthest point of the box", () => {
    const g = parseGradient(`radial-gradient(farthest-side at 50% 50%, ${red} 0%, ${clear} 100%)`);
    if (!g) throw new Error("no gradient");
    near(
      rangesUnder(g, 200, 200, { left: 90, top: 90, right: 110, bottom: 110 })[0] as [
        number,
        number,
      ],
      [0, Math.SQRT2 / 10],
    );
    near(
      rangesUnder(g, 200, 200, { left: 150, top: 90, right: 200, bottom: 110 })[0] as [
        number,
        number,
      ],
      [0.5, 1],
    );
  });

  it("conic: the angles the box spans, all of them around the centre", () => {
    const g = parseGradient(`conic-gradient(from 0deg at 50% 50%, ${red} 0%, ${clear} 100%)`);
    if (!g) throw new Error("no gradient");
    expect(rangesUnder(g, 200, 200, { left: 50, top: 50, right: 150, bottom: 150 })).toEqual([
      [0, 1],
    ]);
    // The top-right quarter: 0°–90° clockwise from the top.
    near(
      rangesUnder(g, 200, 200, { left: 100.5, top: 0, right: 200, bottom: 99.5 })[0] as [
        number,
        number,
      ],
      [0, 0.25],
    );
    // Straddling the start (straight up, left and right of the centre line): wraps.
    const ranges = rangesUnder(g, 200, 200, { left: 80, top: 0, right: 120, bottom: 40 });
    expect(ranges).toHaveLength(2);
    expect(ranges[0]?.[1]).toBe(1);
    expect(ranges[1]?.[0]).toBe(0);
  });

  it("interpolates between stops", () => {
    const g = parseGradient(`linear-gradient(rgb(0, 0, 0) 0%, rgb(200, 100, 0) 50%, ${red} 100%)`);
    if (!g) throw new Error("no gradient");
    expect(colorAt(g, 0.25)).toEqual([100, 50, 0, 1]);
    expect(colorAt(g, 1.5)).toEqual([255, 0, 0, 1]);
  });
});
