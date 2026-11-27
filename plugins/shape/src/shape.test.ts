// @vitest-environment happy-dom
import { checkElementConformance } from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import { type ShapeProps, ShapePropsSchema, shapeElement } from "./index.js";

function mount(props: ShapeProps): HTMLElement {
  const container = document.createElement("div");
  shapeElement.mount(container, props, { assetUrl: () => "" });
  return container.firstElementChild as HTMLElement;
}

describe("shape element", () => {
  it("passes the plugin conformance kit", async () => {
    const report = await checkElementConformance(shapeElement, {
      updates: [
        {
          shape: "ellipse",
          fill: "#ff0000",
          stroke: { color: "$color.border", width: 2, style: "dashed" },
        },
        {
          shape: "rect",
          radius: "$radius.md",
          fill: {
            type: "linear-gradient",
            angle: 45,
            stops: [
              { offset: 0, color: "#000" },
              { offset: 1, color: "#fff" },
            ],
          },
        },
        { shape: "star", points: 6, innerRadius: 0.4, stroke: { color: "#ffffff", width: 3 } },
        { shape: "arrow", headLength: 0.3, shaftWidth: 0.4 },
        { shape: "rect" },
      ],
    });
    expect(report.failures).toEqual([]);
  });

  it("clips outline kinds to their corners, with the stroke inside the outline", () => {
    const container = document.createElement("div");
    const instance = shapeElement.mount(
      container,
      { shape: "triangle", stroke: { color: "#ff0000", width: 4 } },
      { assetUrl: () => "" },
    );
    const fill = container.firstElementChild as HTMLElement;
    expect(fill.style.clipPath).toBe("polygon(50% 0%, 100% 100%, 0% 100%)");
    expect(fill.style.border).toBe("");
    const polygon = container.querySelector("polygon");
    expect(polygon?.getAttribute("points")).toBe("0.5,0 1,1 0,1");
    expect(polygon?.getAttribute("stroke-width")).toBe("8"); // half clipped away: 4 inside
    expect(polygon?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    // Back to a rect: the outline goes, the border comes back.
    instance.update({ shape: "rect", stroke: { color: "#ff0000", width: 4 } });
    expect(container.querySelector("svg")).toBeNull();
    expect(fill.style.clipPath).toBe("");
    instance.dispose();
    expect(container.childElementCount).toBe(0);
  });

  it("draws ellipses and rounded rects", () => {
    expect(mount({ shape: "ellipse" }).style.borderRadius).toBe("50%");
    expect(mount({ shape: "rect", radius: 12 }).style.borderRadius).toBe("12px");
  });

  it("validates its props", () => {
    expect(ShapePropsSchema.safeParse({ shape: "star", points: 5 }).success).toBe(true);
    expect(ShapePropsSchema.safeParse({ shape: "hexagon" }).success).toBe(false);
    expect(ShapePropsSchema.safeParse({ shape: "polygon", sides: 2 }).success).toBe(false);
    expect(ShapePropsSchema.safeParse({ shape: "rect", fill: "red" }).success).toBe(false); // hex or token only
  });
});
