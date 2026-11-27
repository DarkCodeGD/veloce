// @vitest-environment happy-dom
import { checkElementConformance } from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import { headLength, LinePropsSchema, lineElement, lineGeometry } from "./line.js";

const r = (n: number) => Math.round(n * 100) / 100;
const pts = (points: { x: number; y: number }[]) => points.map((p) => [r(p.x), r(p.y)]);

describe("line element (D127)", () => {
  it("passes the plugin conformance kit", async () => {
    const report = await checkElementConformance(lineElement, {
      updates: [
        { start: "circle", end: "arrow", color: "#ff0000", width: 6, dash: "dashed" },
        { from: { x: 0, y: 1 }, to: { x: 1, y: 0 }, end: "square", cap: "butt" },
        {},
      ],
    });
    expect(report.failures).toEqual([]);
  });

  it("runs between its ends as fractions of the box", () => {
    const { shaft, heads } = lineGeometry(200, 40, {});
    expect(shaft && pts(shaft)).toEqual([
      [0, 20],
      [200, 20],
    ]);
    expect(heads).toEqual([]);
    const diagonal = lineGeometry(100, 50, { from: { x: 0, y: 1 }, to: { x: 1, y: 0 } });
    expect(diagonal.shaft && pts(diagonal.shaft)).toEqual([
      [0, 50],
      [100, 0],
    ]);
  });

  it("puts a filled head's tip on the end and stops the shaft under it", () => {
    const { shaft, heads } = lineGeometry(200, 40, { end: "triangle", width: 4 });
    const head = heads[0];
    expect(head?.kind).toBe("polygon");
    expect(head?.kind === "polygon" && pts(head.points)[0]).toEqual([200, 20]); // the tip
    const length = headLength(4);
    expect(shaft && r(shaft[1].x)).toBe(r(200 - length * 0.9));
    // An open arrow is stroked over the shaft, which runs to the tip.
    const open = lineGeometry(200, 40, { end: "arrow" });
    expect(open.heads[0]?.kind).toBe("polyline");
    expect(open.shaft && r(open.shaft[1].x)).toBe(200);
  });

  it("points heads both ways and keeps them from overlapping on a short line", () => {
    const both = lineGeometry(200, 40, { start: "triangle", end: "triangle" });
    const [start, end] = both.heads;
    expect(start?.kind === "polygon" && pts(start.points)[0]).toEqual([0, 20]);
    expect(end?.kind === "polygon" && pts(end.points)[0]).toEqual([200, 20]);
    // A 20px line with two heads: each gets half of it, so their bases meet in the middle.
    const short = lineGeometry(20, 10, { start: "triangle", end: "triangle", width: 8 });
    const bases = short.heads.map((h) => (h.kind === "polygon" ? r(h.points[1]?.x ?? 0) : null));
    expect(bases).toEqual([10, 10]);
    // A line with no length draws nothing (no NaN anywhere).
    expect(lineGeometry(100, 100, { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 } })).toEqual({
      shaft: null,
      heads: [],
    });
  });

  it("draws plain SVG made by name, and cleans up", () => {
    const container = document.createElement("div");
    // happy-dom lays nothing out: give the box the size the renderer would.
    Object.defineProperty(container, "clientWidth", { value: 200 });
    Object.defineProperty(container, "clientHeight", { value: 40 });
    const instance = lineElement.mount(
      container,
      { end: "triangle", start: "circle", dash: "dashed", width: 2 },
      { assetUrl: () => "" },
    );
    const svg = container.querySelector("svg");
    expect(svg?.querySelector("line")?.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(svg?.querySelectorAll("polygon, circle")).toHaveLength(2);
    instance.update({ end: "none" });
    expect(svg?.querySelectorAll("polygon, circle")).toHaveLength(0);
    instance.dispose();
    expect(container.childElementCount).toBe(0);
  });

  it("validates its props", () => {
    expect(LinePropsSchema.safeParse({ end: "arrow", width: 3 }).success).toBe(true);
    expect(LinePropsSchema.safeParse({ end: "harpoon" }).success).toBe(false);
    expect(LinePropsSchema.safeParse({ width: 0 }).success).toBe(false);
    expect(LinePropsSchema.safeParse({ color: "red" }).success).toBe(false);
  });
});
