import { describe, expect, it } from "vitest";
import { createDeck, createSlide, element, frame } from "../builders.js";
import { lintDeck } from "../lint.js";
import { type Node, NodeSchema } from "../schema/node.js";

const box = (id: string, extra = {}) => element("shape", { shape: "rect" }, { id, ...extra });
const lint = (children: Node[], perspective?: number) => {
  const slide = createSlide({ id: "s", rootId: "root", children });
  if (perspective) slide.root = { ...slide.root, perspective };
  return lintDeck(createDeck({ title: "t", slides: [slide] })).filter(
    (i) => i.rule === "flat-depth" || i.rule === "depth-behind-viewer",
  );
};

describe("2.5D: depth and perspective (D112)", () => {
  it("takes depth on any layer and perspective on frames only", () => {
    expect(NodeSchema.safeParse(box("a", { depth: -300 })).success).toBe(true);
    expect(NodeSchema.safeParse(frame({ id: "f", perspective: 1200 })).success).toBe(true);
    expect(NodeSchema.safeParse(frame({ id: "f", perspective: 10 })).success).toBe(false);
    expect(NodeSchema.safeParse({ ...box("a"), perspective: 1200 }).success).toBe(false);
  });

  it("warns when depth shows nothing, and errors when a layer is behind the viewer", () => {
    const [flat] = lint([box("a", { depth: 200 })]);
    expect(flat).toMatchObject({ rule: "flat-depth", severity: "warning", nodeIds: ["a"] });
    expect(flat?.message).toMatch(/the slide has no perspective/);
    expect(flat?.fix).toMatch(/root frame "root" a perspective.*"depth": null/);

    expect(lint([box("a", { depth: 200 }), box("b", { depth: -5000 })], 1000)).toEqual([]);
    const [behind] = lint([box("a", { depth: 1000 })], 1000);
    expect(behind).toMatchObject({ rule: "depth-behind-viewer", severity: "error" });
    expect(behind?.fix).toMatch(/well under 1000 \(e\.g\. 250\)/);
    // Hidden layers and depth 0 say nothing; a nested frame needs its own perspective.
    expect(lint([box("a", { depth: 0 }), box("b", { depth: 900, hidden: true })])).toEqual([]);
    const nested = lint([frame({ id: "card", children: [box("in", { depth: 50 })] })], 1000);
    expect(nested[0]?.message).toMatch(/frame "card" has no perspective/);
  });
});
