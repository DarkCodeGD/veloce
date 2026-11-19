import { applyTransaction, createDeck, createSlide, type Deck, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import { type LayerRow, layerDropAt, moveLayers } from "./layer-drop.js";
import { indexSlide } from "./slide-index.js";

const text = (id: string, extra = {}) => element("text", { content: id }, { id, ...extra });

/** root > [title, card (stack) > [a, b], board (absolute) > [x @5,5], locked (locked) > [], foot] */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          text("title"),
          frame({ id: "card", name: "Card", children: [text("a"), text("b")] }),
          frame({
            id: "board",
            name: "Board",
            layout: { mode: "absolute" },
            children: [text("x", { position: { x: 5, y: 5 } })],
          }),
          frame({ id: "locked", locked: true }),
          text("foot", { positioning: "free", position: { x: 9, y: 9 } }),
        ],
      }),
    ],
  });
}

const deck = makeDeck();
const index = indexSlide(deck.slides[0] as never);
/** The panel with everything expanded. */
const rows: LayerRow[] = [
  { id: "title", depth: 0 },
  { id: "card", depth: 0 },
  { id: "a", depth: 1 },
  { id: "b", depth: 1 },
  { id: "board", depth: 0 },
  { id: "x", depth: 1 },
  { id: "locked", depth: 0 },
  { id: "foot", depth: 0 },
];
const at = (id: string) => rows.findIndex((r) => r.id === id);
const drop = (dragged: string[], id: string, fraction: number, depth = 9) =>
  layerDropAt(index, rows, dragged, { row: at(id), fraction, depth });

function apply(command: Command | null) {
  if (!command) throw new Error("no command");
  const result = applyTransaction(deck, { origin: "user", label: command.label, ops: command.ops });
  if (!result.ok) throw new Error(result.error.message);
  return indexSlide(result.deck.slides[0] as never);
}
const kids = (i: ReturnType<typeof apply>, id: string) => {
  const node = i.nodes.get(id)?.node;
  return node?.kind === "frame" ? node.children.map((c) => c.id) : [];
};

describe("layer drop zones", () => {
  it("puts a drop before or after a row, by which half the pointer is in", () => {
    expect(drop(["foot"], "title", 0.2)).toMatchObject({ parentId: "root", beforeId: "title" });
    expect(drop(["foot"], "a", 0.7)).toMatchObject({
      parentId: "card",
      beforeId: "b",
      indicator: { kind: "line", edge: "bottom", depth: 1 },
    });
  });

  it("drops into a frame from the middle of its row; above its first child from the bottom", () => {
    expect(drop(["title"], "card", 0.5)).toMatchObject({
      parentId: "card",
      beforeId: null,
      indicator: { kind: "into" },
    });
    expect(drop(["title"], "card", 0.9)).toMatchObject({ parentId: "card", beforeId: "a" });
    expect(drop(["title"], "card", 0.1)).toMatchObject({ parentId: "root", beforeId: "card" });
  });

  it("lets the pointer's x choose the level after the last row of a frame", () => {
    // Below "b" (last in card): deep = after b in card, shallow = after card in the root.
    expect(drop(["title"], "b", 0.8, 1)).toMatchObject({ parentId: "card", beforeId: null });
    expect(drop(["title"], "b", 0.8, 0)).toMatchObject({
      parentId: "root",
      beforeId: "board",
      indicator: { depth: 0 },
    });
    expect(drop(["title"], "b", 0.8, -3)?.parentId).toBe("root"); // clamped
    // Not last: no choice.
    expect(drop(["title"], "a", 0.8, 0)).toMatchObject({ parentId: "card", beforeId: "b" });
  });

  it("refuses locked frames and dropping a layer into itself", () => {
    expect(drop(["title"], "locked", 0.5)).toBeNull();
    expect(drop(["card"], "card", 0.5)).toBeNull();
    expect(drop(["card"], "a", 0.2)).toBeNull(); // into its own child list
    expect(drop(["card"], "locked", 0.1)).toMatchObject({ parentId: "root" }); // beside is fine
  });
});

describe("moving layers", () => {
  it("reorders within a frame, before the anchor", () => {
    const moved = moveLayers(index, ["title"], "root", "locked");
    expect(moved?.label).toBe('Reorder "title"');
    expect(kids(apply(moved), "root")).toEqual(["card", "board", "title", "locked", "foot"]);
    expect(moveLayers(index, ["title"], "root", "card")).toBeNull(); // already there
    expect(moveLayers(index, ["title"], "root", "title")).toBeNull(); // before itself
  });

  it("moves several layers in document order, whatever order they were selected in", () => {
    const moved = moveLayers(index, ["b", "title"], "card", "a");
    expect(moved?.label).toBe('Move 2 layers into "Card"');
    expect(moved?.select).toEqual(["title", "b"]);
    const after = apply(moved);
    expect(kids(after, "card")).toEqual(["title", "b", "a"]);
    expect(kids(after, "root")).toEqual(["card", "board", "locked", "foot"]);
    // A child of a moved frame isn't moved separately.
    expect(moveLayers(index, ["card", "a"], "root", null)?.ops).toHaveLength(1);
  });

  it("applies the canvas rules when layers change frames", () => {
    // Into an absolute frame: at the measured spot; the free flag goes.
    const into = moveLayers(index, ["foot"], "board", null, new Map([["foot", { x: 40, y: 50 }]]));
    const a = apply(into);
    expect(kids(a, "board")).toEqual(["x", "foot"]);
    expect(a.nodes.get("foot")?.node).toMatchObject({ position: { x: 40, y: 50 } });
    expect(a.nodes.get("foot")?.node.positioning).toBeUndefined();
    // Out into a stack: the position goes.
    const out = apply(moveLayers(index, ["x"], "card", null));
    expect(out.nodes.get("x")?.node.position).toBeUndefined();
    // Locked targets and moving into yourself are refused.
    expect(moveLayers(index, ["title"], "locked", null)).toBeNull();
    expect(moveLayers(index, ["card"], "card", null)).toBeNull();
  });
});
