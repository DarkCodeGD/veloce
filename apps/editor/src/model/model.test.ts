import {
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  frame,
  type Op,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  addSlide,
  deleteNodes,
  deleteSlide,
  duplicateNodes,
  duplicateSlide,
  moveSlide,
  moveSlideTo,
  reorderNode,
} from "./commands.js";
import {
  editableText,
  pick,
  pruneSelection,
  selectFirstChild,
  selectParents,
  selectSiblings,
} from "./selection.js";
import { chainOf, editLabel, indexSlide, nodeLabel, topmost } from "./slide-index.js";

const text = (id: string, content: string, extra = {}) =>
  element("text", { content }, { id, ...extra });

/** Slide: root > [card > [title, body], footer, locked > [inner]] */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          frame({ id: "card", children: [text("title", "Hello world"), text("body", "Body")] }),
          text("footer", "Footer"),
          frame({ id: "locked", locked: true, children: [text("inner", "Inner")] }),
        ],
      }),
    ],
  });
}

const apply = (deck: Deck, ops: Op[]) => {
  const result = applyTransaction(deck, { origin: "user", label: "test", ops });
  if (!result.ok) throw new Error(result.error.message);
  return result.deck;
};

describe("selection", () => {
  const deck = makeDeck();
  const index = indexSlide(deck.slides[0] as never);

  it("indexes the tree and labels nodes", () => {
    expect(chainOf(index, "title")).toEqual(["root", "card", "title"]);
    expect(topmost(index, ["title", "card", "footer"])).toEqual(["card", "footer"]);
    expect(nodeLabel(index.nodes.get("title")?.node as never)).toBe("Hello world");
    expect(nodeLabel(index.nodes.get("card")?.node as never)).toBe("Frame");
  });

  it("labels a text edit by the layer's name, else by its new text", () => {
    expect(editLabel("Title", "Edited by me")).toBe("Title");
    expect(editLabel(undefined, "Edited   by\nme")).toBe("Edited by me");
    expect(editLabel(undefined, "x".repeat(50))).toBe(`${"x".repeat(39)}…`);
    expect(editLabel(undefined, "  ")).toBe("Text");
  });

  it("picks the top-level layer first, then drills in with double-click", () => {
    expect(pick(index, "title", [])).toEqual(["card"]);
    expect(pick(index, "title", ["card"])).toEqual(["card"]); // keep (lets you drag it later)
    expect(pick(index, "title", ["card"], { deep: true })).toEqual(["title"]);
    // Inside the card: clicks pick the card's children.
    expect(pick(index, "body", ["title"])).toEqual(["body"]);
    // Clicking elsewhere returns to the top level.
    expect(pick(index, "footer", ["title"])).toEqual(["footer"]);
    expect(pick(index, "root", ["footer"])).toEqual([]);
    expect(pick(index, null, ["footer"])).toEqual([]);
  });

  it("toggles with shift and passes through locked layers", () => {
    expect(pick(index, "footer", ["card"], { additive: true })).toEqual(["card", "footer"]);
    expect(pick(index, "footer", ["card", "footer"], { additive: true })).toEqual(["card"]);
    expect(pick(index, "inner", [])).toEqual([]);
  });

  it("navigates with Esc / Enter / select all and prunes removed IDs", () => {
    expect(selectParents(index, ["title", "body"])).toEqual(["card"]);
    expect(selectParents(index, ["card"])).toEqual([]);
    expect(selectFirstChild(index, ["card"])).toEqual(["title"]);
    expect(selectSiblings(index, ["footer"])).toEqual(["card", "footer"]); // not the locked one
    expect(pruneSelection(index, ["card", "gone"])).toEqual(["card"]);
  });

  it("knows which layers can be typed into on the canvas", () => {
    expect(editableText(index, "title")).toBe(true);
    expect(editableText(index, "card")).toBe(false); // a frame
    expect(editableText(index, "inner")).toBe(false); // inside a locked frame
    expect(editableText(index, "gone")).toBe(false);
    expect(editableText(index, undefined)).toBe(false);
  });
});

describe("commands produce valid, undoable ops", () => {
  it("deletes topmost layers only", () => {
    const deck = makeDeck();
    const command = deleteNodes(indexSlide(deck.slides[0] as never), ["title", "card", "root"]);
    expect(command?.label).toBe('Delete "Frame"');
    const after = apply(deck, command?.ops ?? []);
    expect(indexSlide(after.slides[0] as never).nodes.has("title")).toBe(false);
  });

  it("duplicates next to the original with fresh IDs", () => {
    const deck = makeDeck();
    const command = duplicateNodes(indexSlide(deck.slides[0] as never), ["card", "footer"]);
    const after = apply(deck, command?.ops ?? []);
    const children = after.slides[0]?.root.children.map((c) => c.id) ?? [];
    expect(children).toHaveLength(5);
    expect(children[0]).toBe("card");
    expect(children[2]).toBe("footer");
    expect(command?.select).toEqual([children[1], children[3]]);
    expect(new Set(children).size).toBe(5);
  });

  it("reorders among siblings and clamps at the ends", () => {
    const deck = makeDeck();
    const index = indexSlide(deck.slides[0] as never);
    expect(reorderNode(index, "card", -1)).toBeNull();
    const after = apply(deck, reorderNode(index, "card", 1)?.ops ?? []);
    expect(after.slides[0]?.root.children.map((c) => c.id)).toEqual(["footer", "card", "locked"]);
  });

  it("adds, duplicates, moves and deletes slides", () => {
    let deck = makeDeck();
    const added = addSlide(0);
    deck = apply(deck, added.ops);
    expect(deck.slides.map((s) => s.id)).toEqual(["s1", added.select?.[0]]);
    const copy = duplicateSlide(deck.slides[0] as never, 0);
    deck = apply(deck, copy.ops);
    expect(deck.slides[1]?.root.children).toHaveLength(3);
    expect(deck.slides[1]?.root.id).not.toBe("root");
    deck = apply(deck, moveSlide(deck.slides, "s1", 2)?.ops ?? []);
    expect(deck.slides.at(-1)?.id).toBe("s1");
    expect(moveSlide(deck.slides, "s1", 1)).toBeNull(); // already last
    const toFront = moveSlideTo(deck.slides, "s1", -5); // clamped
    expect(toFront?.label).toBe("Move slide 3 to position 1");
    deck = apply(deck, toFront?.ops ?? []);
    expect(deck.slides[0]?.id).toBe("s1");
    expect(moveSlideTo(deck.slides, "s1", 0)).toBeNull();
    deck = apply(deck, moveSlideTo(deck.slides, "s1", 2)?.ops ?? []);
    deck = apply(deck, deleteSlide(deck.slides.at(-1) as never).ops);
    expect(deck.slides).toHaveLength(2);
  });
});
