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
      ],
    });
    expect(report.failures).toEqual([]);
  });

  it("draws ellipses and rounded rects", () => {
    expect(mount({ shape: "ellipse" }).style.borderRadius).toBe("50%");
    expect(mount({ shape: "rect", radius: 12 }).style.borderRadius).toBe("12px");
  });

  it("validates its props", () => {
    expect(ShapePropsSchema.safeParse({ shape: "star" }).success).toBe(false);
    expect(ShapePropsSchema.safeParse({ shape: "rect", fill: "red" }).success).toBe(false); // hex or token only
  });
});
