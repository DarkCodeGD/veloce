import { applyTransaction, createDeck, createSlide, type Deck, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import type { Point } from "./geometry.js";
import {
  type GroupMeasure,
  groupBlocker,
  groupLayers,
  ungroupable,
  ungroupLayers,
} from "./group.js";
import { indexSlide, type SlideIndex } from "./slide-index.js";

const text = (id: string, extra = {}) => element("text", { content: id }, { id, ...extra });

/**
 * root (column) > [
 *   title,
 *   list (row, gap 24, align center) > [a, b (fill), c],
 *   board (absolute, padding 20) > [p @10,20, q @200,100 turned 90°],
 *   cells (grid, 3 columns, gap 8) > [g1, g2, g3],
 *   pin (free @5,5), tag (free @50,60),
 * ]
 */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          text("title"),
          frame({
            id: "list",
            name: "List",
            layout: { mode: "stack", direction: "row", gap: 24, align: "center" },
            children: [text("a"), text("b", { width: "fill" }), text("c")],
          }),
          frame({
            id: "board",
            name: "Board",
            layout: { mode: "absolute", padding: 20 },
            children: [
              text("p", { position: { x: 10, y: 20 } }),
              text("q", { position: { x: 200, y: 100 }, rotation: 90 }),
            ],
          }),
          frame({
            id: "cells",
            layout: { mode: "grid", columns: 3, gap: 8 },
            children: [text("g1"), text("g2"), text("g3")],
          }),
          text("pin", { positioning: "free", position: { x: 5, y: 5 } }),
          text("tag", { positioning: "free", position: { x: 50, y: 60 }, width: "fill" }),
        ],
      }),
    ],
  });
}

const deck = makeDeck();
const index = indexSlide(deck.slides[0] as never);

/** A fake canvas: fixed sizes, and on-screen spots for ungrouping. */
function measureWith(spots: Record<string, Point> = {}): GroupMeasure {
  const sizes: Record<string, { w: number; h: number }> = {
    p: { w: 100, h: 40 },
    q: { w: 60, h: 20 },
    pin: { w: 30, h: 30 },
    tag: { w: 400, h: 50 },
  };
  return {
    size: (id) => sizes[id] ?? { w: 80, h: 30 },
    sizing: (id) => {
      const node = index.nodes.get(id)?.node;
      return { width: node?.width ?? "auto", height: node?.height ?? "auto" };
    },
    positionIn: (id) => spots[id] ?? null,
  };
}

function apply(command: Command | null, from: Deck = deck) {
  if (!command) throw new Error("no command");
  const tx = { id: "tx", origin: "user" as const, label: command.label, ops: command.ops };
  const result = applyTransaction(from, tx);
  if (!result.ok) throw new Error(result.error.message);
  return { deck: result.deck, index: indexSlide(result.deck.slides[0] as never), tx: result };
}
const kids = (i: SlideIndex, id: string) => {
  const node = i.nodes.get(id)?.node;
  return node?.kind === "frame" ? node.children.map((c) => c.id) : [];
};
const nodeOf = (i: SlideIndex, id: string) => i.nodes.get(id)?.node;

describe("group", () => {
  it("wraps flow layers in a frame with the parent's flow, in the first layer's slot", () => {
    const command = groupLayers(index, ["c", "a"], measureWith());
    expect(command?.label).toBe("Group 2 layers");
    const { index: after } = apply(command);
    const groupId = command?.select?.[0] ?? "";
    expect(kids(after, "list")).toEqual([groupId, "b"]);
    expect(kids(after, groupId)).toEqual(["a", "c"]);
    expect(nodeOf(after, groupId)).toMatchObject({
      name: "Group",
      layout: { mode: "stack", direction: "row", gap: 24, align: "center" },
    });
    expect(nodeOf(after, groupId)?.width).toBeUndefined(); // fits its content along the row
  });

  it("lets a flow group fill the main axis when a member fills it", () => {
    const command = groupLayers(index, ["b", "c"], measureWith());
    const { index: after } = apply(command);
    expect(nodeOf(after, command?.select?.[0] ?? "")?.width).toBe("fill");
  });

  it("keeps a grid a grid, with only as many columns as it has items", () => {
    const command = groupLayers(index, ["g2", "g3"], measureWith());
    const { index: after } = apply(command);
    const groupId = command?.select?.[0] ?? "";
    expect(kids(after, "cells")).toEqual(["g1", groupId]);
    expect(nodeOf(after, groupId)).toMatchObject({ layout: { mode: "grid", columns: 2, gap: 8 } });
  });

  it("cuts a free group to the members' box, rotation included, and rebases them", () => {
    // p: 10,20 100×40. q: 60×20 at 200,100 turned 90°, so it covers 220..240 × 80..140.
    const command = groupLayers(index, ["q", "p"], measureWith());
    const { index: after } = apply(command);
    const groupId = command?.select?.[0] ?? "";
    expect(kids(after, "board")).toEqual([groupId]);
    expect(nodeOf(after, groupId)).toMatchObject({
      layout: { mode: "absolute" },
      position: { x: 10, y: 20 },
      width: 230,
      height: 120,
    });
    expect(nodeOf(after, groupId)?.positioning).toBeUndefined(); // absolute parent
    expect(nodeOf(after, "p")?.position).toEqual({ x: 0, y: 0 });
    expect(nodeOf(after, "q")?.position).toEqual({ x: 190, y: 80 });
  });

  it("groups free layers of a stack into a free group in front, baking filled sizes", () => {
    const command = groupLayers(index, ["pin", "tag"], measureWith());
    const { index: after } = apply(command);
    const groupId = command?.select?.[0] ?? "";
    expect(kids(after, "root").at(-1)).toBe(groupId); // where the frontmost member was
    expect(nodeOf(after, groupId)).toMatchObject({
      positioning: "free",
      position: { x: 5, y: 5 },
      width: 445,
      height: 105,
    });
    expect(nodeOf(after, "tag")).toMatchObject({ position: { x: 45, y: 55 }, width: 400 });
    expect(nodeOf(after, "tag")?.positioning).toBeUndefined();
    expect(nodeOf(after, "pin")?.positioning).toBeUndefined();
  });

  it("is one exact undo step", () => {
    for (const ids of [
      ["pin", "tag"],
      ["a", "c"],
      ["p", "q"],
    ]) {
      const { deck: grouped, tx } = apply(groupLayers(index, ids, measureWith()));
      if (!tx.ok) throw new Error("not applied");
      const undo = { origin: "user", label: "Undo", ops: tx.inverse };
      const undone = applyTransaction(grouped, undo);
      expect(undone.ok && undone.deck).toEqual(deck);
    }
  });

  it("says why a selection can't be grouped", () => {
    expect(groupBlocker(index, ["a", "p"])).toMatch(/same frame/);
    expect(groupBlocker(index, ["title", "pin"])).toMatch(/not a mix/);
    expect(groupLayers(index, ["title", "pin"], measureWith())).toBeNull();
    expect(groupBlocker(index, ["root"])).toBeNull();
    expect(groupLayers(index, ["root"], measureWith())).toBeNull();
    // A layer and its own frame: the frame covers it.
    expect(groupLayers(index, ["list", "a"], measureWith())?.label).toBe('Group "List"');
  });
});

describe("ungroup", () => {
  it("puts a flow frame's children in its slot, in order, and selects them", () => {
    const command = ungroupLayers(index, ["list"], measureWith());
    expect(command?.label).toBe('Ungroup "List"');
    expect(command?.select).toEqual(["a", "b", "c"]);
    const { index: after } = apply(command);
    expect(kids(after, "root")).toEqual(["title", "a", "b", "c", "board", "cells", "pin", "tag"]);
    expect(after.nodes.has("list")).toBe(false);
  });

  it("keeps a free frame's children where they are on the slide", () => {
    // board is a flow child of the root column; its children were free inside it.
    const spots = { p: { x: 30, y: 140 }, q: { x: 220, y: 220 } };
    const { index: after } = apply(ungroupLayers(index, ["board"], measureWith(spots)));
    expect(nodeOf(after, "p")).toMatchObject({ positioning: "free", position: { x: 30, y: 140 } });
    expect(nodeOf(after, "q")).toMatchObject({ positioning: "free", rotation: 90 });
  });

  it("round-trips a free group: group, then ungroup, puts every layer back", () => {
    const grouped = apply(groupLayers(index, ["q", "p"], measureWith()));
    const groupId = grouped.index.nodes.get("p")?.parentId ?? "";
    const spots = { p: { x: 10, y: 20 }, q: { x: 200, y: 100 } };
    const command = ungroupLayers(grouped.index, [groupId], measureWith(spots));
    const { index: after } = apply(command, grouped.deck);
    expect(kids(after, "board")).toEqual(["p", "q"]);
    expect(nodeOf(after, "p")).toEqual(nodeOf(index, "p"));
    expect(nodeOf(after, "q")).toEqual(nodeOf(index, "q"));
  });

  it("carries the frame's rotation, opacity and hidden state to its children", () => {
    const turned = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s1",
          rootId: "root",
          layout: { mode: "absolute" },
          children: [
            frame({
              id: "f",
              rotation: 170,
              opacity: 0.5,
              hidden: true,
              layout: { mode: "stack" },
              children: [text("k", { rotation: 20, opacity: 0.5 })],
            }),
          ],
        }),
      ],
    });
    const i = indexSlide(turned.slides[0] as never);
    const measure: GroupMeasure = {
      size: () => ({ w: 80, h: 30 }),
      sizing: () => ({ width: "auto", height: "auto" }),
      positionIn: () => ({ x: 7, y: 9 }),
    };
    const { index: after } = apply(ungroupLayers(i, ["f"], measure), turned);
    expect(nodeOf(after, "k")).toMatchObject({
      position: { x: 7, y: 9 },
      rotation: -170,
      opacity: 0.25,
      hidden: true,
      width: 80, // the column stretched it; outside the flow it keeps its width
      height: "hug",
    });
    expect(nodeOf(after, "k")?.positioning).toBeUndefined(); // absolute parent
  });

  it("only ungroups frames, never the root, and the outermost of nested picks", () => {
    expect(ungroupable(index, ["a", "root", "list"])).toEqual(["list"]);
    expect(ungroupLayers(index, ["a"], measureWith())).toBeNull();
    expect(ungroupLayers(index, ["root"], measureWith())).toBeNull();
    const both = ungroupLayers(index, ["list", "cells"], measureWith());
    expect(both?.label).toBe("Ungroup 2 frames");
    const { index: after } = apply(both);
    expect(kids(after, "root")).toEqual([
      "title",
      "a",
      "b",
      "c",
      "board",
      "g1",
      "g2",
      "g3",
      "pin",
      "tag",
    ]);
  });
});
