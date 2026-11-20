import { applyTransaction, createDeck, createSlide, type Deck, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { addAutoLayout, guessFlow } from "./auto-layout.js";
import type { Command } from "./commands.js";
import type { GroupMeasure } from "./group.js";
import { indexSlide, type SlideIndex } from "./slide-index.js";

const text = (id: string, extra = {}) => element("text", { content: id }, { id, ...extra });
const at = (x: number, y: number) => ({ position: { x, y } });

/**
 * A slide made by hand (root Free) > [
 *   h1 @100,100, h2 @100,180, h3 @100,260 (fill width): a column, 30px apart,
 *   c3 @380,500, c1 @100,500, c2 @240,500: a row, 40px apart (document order scrambled),
 *   panel (Free, 600×400) > [z @200,40, x @60,40, ghost (hidden)],
 *   list (stack) > [a, b],
 * ]
 * Plus a stack slide with two layers taken out of its flow.
 */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        layout: { mode: "absolute" },
        children: [
          text("h1", at(100, 100)),
          text("h2", at(100, 180)),
          text("h3", { ...at(100, 260), width: "fill" }),
          text("c3", at(380, 500)),
          text("c1", at(100, 500)),
          text("c2", at(240, 500)),
          frame({
            id: "panel",
            layout: { mode: "absolute" },
            width: 600,
            height: 400,
            ...at(900, 100),
            children: [text("z", at(200, 40)), text("x", at(60, 40)), text("ghost", at(0, 0))],
          }),
          frame({ id: "list", layout: { mode: "stack" }, children: [text("a"), text("b")] }),
        ],
      }),
      createSlide({
        id: "s2",
        rootId: "root2",
        children: [
          text("flow"),
          text("f1", { positioning: "free", ...at(10, 10) }),
          text("f2", { positioning: "free", ...at(10, 70) }),
        ],
      }),
    ],
  });
}

const deck = makeDeck();
const index = indexSlide(deck.slides[0] as never);
const index2 = indexSlide(deck.slides[1] as never);

/** A fake canvas: the sizes the layers render at (ghost is hidden: no size). */
function measureFor(i: SlideIndex): GroupMeasure {
  const sizes: Record<string, { w: number; h: number }> = {
    h1: { w: 200, h: 50 },
    h2: { w: 200, h: 50 },
    h3: { w: 300, h: 50 },
    panel: { w: 600, h: 400 },
  };
  return {
    size: (id) => (id === "ghost" ? null : (sizes[id] ?? { w: 100, h: 40 })),
    sizing: (id) => {
      const node = i.nodes.get(id)?.node;
      return { width: node?.width ?? "auto", height: node?.height ?? "auto" };
    },
    positionIn: () => null,
  };
}

function apply(command: Command | null, slide = 0) {
  if (!command) throw new Error("no command");
  const tx = { id: "tx", origin: "user" as const, label: command.label, ops: command.ops };
  const result = applyTransaction(deck, tx);
  if (!result.ok) throw new Error(result.error.message);
  return indexSlide(result.deck.slides[slide] as never);
}
const kids = (i: SlideIndex, id: string) => {
  const node = i.nodes.get(id)?.node;
  return node?.kind === "frame" ? node.children.map((c) => c.id) : [];
};
const nodeOf = (i: SlideIndex, id: string) => i.nodes.get(id)?.node;

describe("guessFlow", () => {
  const box = (id: string, x0: number, y0: number, w = 100, h = 40) => ({
    id,
    x0,
    y0,
    x1: x0 + w,
    y1: y0 + h,
  });

  it("reads a row left to right and a column top to bottom, with the average gap", () => {
    expect(guessFlow([box("b", 150, 0), box("a", 0, 0), box("c", 320, 5)])).toEqual({
      direction: "row",
      order: ["a", "b", "c"],
      gap: 60, // (50 + 70) / 2
    });
    expect(guessFlow([box("b", 0, 90), box("a", 0, 0)])).toEqual({
      direction: "column",
      order: ["a", "b"],
      gap: 50,
    });
  });

  it("a single layer is a column; overlaps never give a negative gap", () => {
    expect(guessFlow([box("a", 0, 0)])).toEqual({ direction: "column", order: ["a"], gap: 0 });
    expect(guessFlow([box("a", 0, 0), box("b", 0, 10)]).gap).toBe(0);
  });
});

describe("add auto layout (D83)", () => {
  it("wraps free layers in a hugging column at their corner, in reading order", () => {
    const command = addAutoLayout(index, ["h3", "h1", "h2"], measureFor(index));
    expect(command?.label).toBe("Add auto layout");
    const after = apply(command);
    const id = command?.select?.[0] ?? "";
    const stack = nodeOf(after, id);
    expect(stack).toMatchObject({
      kind: "frame",
      name: "Auto layout",
      layout: { mode: "stack", direction: "column", gap: 30, align: "start" },
      position: { x: 100, y: 100 },
      width: "hug",
      height: "hug",
    });
    expect(stack).not.toHaveProperty("positioning"); // the slide is Free already
    expect(kids(after, id)).toEqual(["h1", "h2", "h3"]);
    // The stack places them now; the width that filled the slide is kept as pixels.
    expect(nodeOf(after, "h1")).not.toHaveProperty("position");
    expect(nodeOf(after, "h3")).toMatchObject({ width: 300 });
    // In front of what h3 was in front of: right after it.
    expect(kids(after, "root").slice(0, 2)).toEqual([id, "c3"]);
  });

  it("layers spread sideways become a row, left to right whatever their layer order", () => {
    const command = addAutoLayout(index, ["c3", "c1", "c2"], measureFor(index));
    const after = apply(command);
    const id = command?.select?.[0] ?? "";
    expect(nodeOf(after, id)).toMatchObject({
      layout: { direction: "row", gap: 40 },
      position: { x: 100, y: 500 },
    });
    expect(kids(after, id)).toEqual(["c1", "c2", "c3"]);
  });

  it("a Free frame becomes a stack in place, padded by where its children sat", () => {
    const command = addAutoLayout(index, ["panel"], measureFor(index));
    expect(command?.select).toEqual(["panel"]);
    const after = apply(command);
    expect(nodeOf(after, "panel")).toMatchObject({
      layout: {
        mode: "stack",
        direction: "row",
        gap: 40,
        align: "start",
        padding: { top: 40, right: 300, bottom: 320, left: 60 },
      },
      width: 600,
      height: 400,
      position: { x: 900, y: 100 },
    });
    // Reading order, the hidden layer last; nobody keeps a position.
    expect(kids(after, "panel")).toEqual(["x", "z", "ghost"]);
    for (const id of ["x", "z", "ghost"]) expect(nodeOf(after, id)).not.toHaveProperty("position");
  });

  it("layers taken out of a stack get a frame that stays out of it too", () => {
    const command = addAutoLayout(index2, ["f2", "f1"], measureFor(index2));
    const after = apply(command, 1);
    const id = command?.select?.[0] ?? "";
    expect(nodeOf(after, id)).toMatchObject({ positioning: "free", position: { x: 10, y: 10 } });
    expect(kids(after, id)).toEqual(["f1", "f2"]);
    expect(nodeOf(after, "f1")).not.toHaveProperty("positioning");
  });

  it("layers already in a flow are grouped with that flow; mixed frames are refused", () => {
    const command = addAutoLayout(index, ["a", "b"], measureFor(index));
    expect(command?.label).toBe("Add auto layout");
    const after = apply(command);
    const id = command?.select?.[0] ?? "";
    expect(nodeOf(after, id)).toMatchObject({ layout: { mode: "stack" } });
    expect(kids(after, id)).toEqual(["a", "b"]);
    expect(addAutoLayout(index, ["a", "h1"], measureFor(index))).toBeNull();
    expect(addAutoLayout(index, [], measureFor(index))).toBeNull();
  });
});
