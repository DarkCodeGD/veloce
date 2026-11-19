/**
 * Anchored free layers (D57) across the editor's op builders: gestures move them on screen
 * the way the pointer goes, switching anchors never moves them, and leaving a frame drops an
 * anchor that was about that frame.
 */
import { applyTransaction, createDeck, createSlide, type Deck, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { alignLayers, type LayerBox } from "./align.js";
import type { Command } from "./commands.js";
import { type GroupMeasure, groupLayers } from "./group.js";
import { dropInto, movedPosition, placeInFlow, setAnchor, switchLayout } from "./manipulate.js";
import { indexSlide } from "./slide-index.js";

const text = (id: string, extra = {}) => element("text", { content: id }, { id, ...extra });

/** root (column) > [card (absolute, 400×200) > [badge (pinned top-right, 16,16), dot], note] */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          frame({
            id: "card",
            width: 400,
            height: 200,
            layout: { mode: "absolute" },
            children: [
              text("badge", { anchor: { x: "end" }, position: { x: 16, y: 16 }, width: "hug" }),
              text("dot", { position: { x: 20, y: 100 } }),
            ],
          }),
          text("note", { positioning: "free", anchor: { y: "end" }, position: { x: 0, y: 0 } }),
        ],
      }),
    ],
  });
}

const deck = makeDeck();
const index = indexSlide(deck.slides[0] as never);
const node = (id: string) => index.nodes.get(id)?.node ?? text(id);

function apply(command: Command | null) {
  if (!command) throw new Error("no command");
  const result = applyTransaction(deck, { origin: "user", label: command.label, ops: command.ops });
  if (!result.ok) throw new Error(result.error.message);
  return indexSlide(result.deck.slides[0] as never);
}

describe("anchored layers in the editor", () => {
  it("moves a right-pinned layer the way the pointer goes", () => {
    // 10px right on screen = 10px less from the right edge.
    expect(movedPosition(node("badge"), { x: 10, y: 5 })).toEqual({ x: 6, y: 21 });
    // Unanchored layers: plain addition, as before.
    expect(movedPosition(node("dot"), { x: 10, y: 5 })).toEqual({ x: 30, y: 105 });
  });

  it("switches anchors without moving the layer", () => {
    // The badge is 60×30 in a 400×200 card: 16 from the right = 324 from the left.
    const measured = { size: { w: 60, h: 30 }, content: { w: 400, h: 200 } };
    const toStart = setAnchor(index, "badge", {}, measured);
    expect(toStart?.ops).toEqual([
      { op: "node.update", id: "badge", set: { anchor: null, position: { x: 324, y: 16 } } },
    ]);
    const after = apply(setAnchor(index, "badge", { x: "center", y: "end" }, measured));
    // Centre 324 + 30 = 354, the card's middle is 200: +154. Bottom: 200 - 16 - 30 = 154.
    expect(after.nodes.get("badge")?.node).toMatchObject({
      anchor: { x: "center", y: "end" },
      position: { x: 154, y: 154 },
    });
    expect(setAnchor(index, "badge", { x: "end" }, measured)).toBeNull(); // already
    expect(setAnchor(index, "card", { x: "end" }, measured)).toBeNull(); // in the flow
  });

  it("drops the anchor when a layer leaves its frame or the flow takes it back", () => {
    const out = apply(dropInto(index, "badge", { parentId: "root", index: 1 }));
    expect(out.nodes.get("badge")?.node.anchor).toBeUndefined();
    const back = placeInFlow(index, "note");
    expect(back?.ops[0]).toMatchObject({ set: { anchor: null, positioning: null } });
    // A Free frame becoming a stack: its children's positions and anchors go.
    const stacked = switchLayout(index, "card", "stack", () => null);
    expect(stacked?.ops).toContainEqual({
      op: "node.update",
      id: "badge",
      set: { position: null, anchor: null },
    });
    expect(stacked?.ops).toContainEqual({ op: "node.update", id: "dot", set: { position: null } });
  });

  it("aligns anchored layers on screen", () => {
    // Both to the left edge of their box: the badge (right-pinned) moves left by 304.
    const boxes = new Map<string, LayerBox>([
      ["badge", { rect: { x: 324, y: 16, w: 60, h: 30 } }],
      ["dot", { rect: { x: 20, y: 100, w: 80, h: 30 } }],
    ]);
    const after = apply(alignLayers(index, ["badge", "dot"], "left", boxes));
    expect(after.nodes.get("badge")?.node.position).toEqual({ x: 320, y: 16 });
    expect(after.nodes.get("dot")?.node.position).toEqual({ x: 20, y: 100 });
  });

  it("groups anchored layers from where they are on screen, unanchored in the group", () => {
    const measure: GroupMeasure = {
      size: (id) => (id === "badge" ? { w: 60, h: 30 } : { w: 80, h: 30 }),
      sizing: () => ({ width: "hug", height: "hug" }),
      positionIn: (id) => (id === "badge" ? { x: 324, y: 16 } : null),
    };
    const command = groupLayers(index, ["badge", "dot"], measure);
    const after = apply(command);
    const group = after.nodes.get(command?.select?.[0] ?? "")?.node;
    expect(group).toMatchObject({ position: { x: 20, y: 16 }, width: 364, height: 114 });
    expect(after.nodes.get("badge")?.node).toMatchObject({ position: { x: 304, y: 0 } });
    expect(after.nodes.get("badge")?.node.anchor).toBeUndefined();
  });
});
