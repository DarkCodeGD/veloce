// @vitest-environment happy-dom
import { parsePathData } from "@veloce/core";
import { checkElementConformance } from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import { pathParser, VectorPropsSchema, vectorElement, vectorGeometry } from "./vector.js";

const segments = (d: string) => {
  const r = parsePathData(d);
  if (!r.ok) throw new Error(r.message);
  return r.segments;
};
const icon = { x: 0, y: 0, width: 24, height: 24 };

/** Mount in a box of a given layout size (happy-dom doesn't lay anything out). */
function mountIn(width: number, height: number, props: Parameters<typeof vectorElement.mount>[1]) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: width });
  Object.defineProperty(container, "clientHeight", { value: height });
  document.body.append(container);
  const instance = vectorElement.mount(container, props, {
    assetUrl: (id) => `/assets/${id}`,
  } as Parameters<typeof vectorElement.mount>[2]);
  return { container, instance };
}

describe("vector element (D127)", () => {
  it("passes the plugin conformance kit", async () => {
    const report = await checkElementConformance(vectorElement, {
      updates: [
        { d: "M0 0 L10 0 L5 8 Z", fill: "#ff0000", fit: "stretch" },
        {
          d: "M4 12 L9 17 L20 6",
          viewBox: icon,
          fill: "transparent",
          stroke: { color: "$color.primary", width: 3, style: "dashed" },
          cap: "butt",
          join: "miter",
        },
        { d: "M0 0 H10 V10 H0 Z M2 2 H8 V8 H2 Z", fillRule: "evenodd" },
      ],
    });
    expect(report.failures).toEqual([]);
  });

  it("contain keeps the drawing's proportions, centered; the fill covers only the drawing", () => {
    const g = vectorGeometry(segments("M0 0 H24 V24 H0 Z"), 200, 100, { viewBox: icon });
    expect(g.area).toEqual({ x: 50, y: 0, width: 100, height: 100 });
    expect(g.outline).toBe("M50 0L150 0L150 100L50 100Z");
    expect(g.clip).toBe("M0 0L100 0L100 100L0 100Z"); // relative to the painted area
  });

  it("stretch fills the box; no viewBox means the path's own bounds", () => {
    const g = vectorGeometry(segments("M10 10 L20 10 L20 20 Z"), 300, 100, { fit: "stretch" });
    expect(g.area).toEqual({ x: 0, y: 0, width: 300, height: 100 });
    expect(g.outline).toBe("M0 0L300 0L300 100Z");
  });

  it("keeps an icon's margins when its viewBox is given", () => {
    // A check mark drawn on a 24-unit canvas: it doesn't touch the edges of a 48 px box.
    const g = vectorGeometry(segments("M4 12 L9 17 L20 6"), 48, 48, { viewBox: icon });
    expect(g.outline).toBe("M8 24L18 34L40 12");
  });

  it("parses each path once while it doesn't change", () => {
    const parse = pathParser();
    const a = parse("M0 0 L1 1");
    expect(parse("M0 0 L1 1")).toBe(a);
    expect(parse("M0 0 L2 2")).not.toBe(a);
  });

  it("paints the fill clipped to the path, strokes on top, and cleans up", () => {
    const { container, instance } = mountIn(200, 200, {
      d: "M0 0 H10 V10 H0 Z M2 2 H8 V8 H2 Z",
      fillRule: "evenodd",
      fill: "$color.accent",
      stroke: { color: "#112233", width: 2 },
    });
    const paint = container.querySelector<HTMLElement>(".v-vector");
    expect(paint?.style.clipPath).toContain("evenodd");
    expect(paint?.style.clipPath).toContain("M0 0L200 0");
    const path = container.querySelector("path");
    expect(path?.getAttribute("d")).toMatch(/^M0 0L200 0/);
    expect(path?.getAttribute("stroke-linejoin")).toBe("round");

    // Outline only: no painted box; no stroke: no SVG.
    instance.update({ d: "M0 0 L10 10", fill: "transparent" });
    expect(paint?.style.display).toBe("none");
    expect(container.querySelector("svg")?.style.display).toBe("none");

    instance.dispose();
    expect(container.children).toHaveLength(0);
  });

  it("refuses path data that isn't a path, saying where", () => {
    const bad = VectorPropsSchema.safeParse({ d: "M0 0 L10 <script>" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/at character/);
    expect(VectorPropsSchema.safeParse({}).success).toBe(false); // `d` is required
    expect(VectorPropsSchema.safeParse({ d: "M0 0 L1 1", color: "#fff" }).success).toBe(false);
  });
});
