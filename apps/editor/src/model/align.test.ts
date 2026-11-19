import { applyTransaction, createDeck, createSlide, type Deck, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { alignable, alignLayers, distributeLayers, type LayerBox } from "./align.js";
import type { Command } from "./commands.js";
import type { Rect } from "./geometry.js";
import { indexSlide } from "./slide-index.js";

const text = (id: string, extra = {}) => element("text", { content: id }, { id, ...extra });

/**
 * root (column) > [
 *   title (flow), pin (free @0,0),
 *   board (absolute) > [a @10,10, b @100,50, c @300,20],
 *   turned (absolute, 90°) > [t @0,0],
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
          text("pin", { positioning: "free", position: { x: 0, y: 0 } }),
          frame({
            id: "board",
            layout: { mode: "absolute" },
            children: [
              text("a", { position: { x: 10, y: 10 } }),
              text("b", { position: { x: 100, y: 50 } }),
              text("c", { position: { x: 300, y: 20 } }),
            ],
          }),
          frame({
            id: "turned",
            rotation: 90,
            layout: { mode: "absolute" },
            children: [text("t", { position: { x: 0, y: 0 } })],
          }),
        ],
      }),
    ],
  });
}

const deck = makeDeck();
const index = indexSlide(deck.slides[0] as never);

/** On-slide boxes: board's content box starts at 200,100 on the slide. */
const boxesOf = (entries: Array<[string, Rect]>) =>
  new Map<string, LayerBox>(entries.map(([id, rect]) => [id, { rect }]));
const rects = boxesOf([
  ["a", { x: 210, y: 110, w: 50, h: 20 }],
  ["b", { x: 300, y: 150, w: 100, h: 40 }],
  ["c", { x: 500, y: 120, w: 30, h: 30 }],
  ["pin", { x: 0, y: 0, w: 40, h: 40 }],
  ["t", { x: 800, y: 600, w: 20, h: 60 }],
]);

function apply(command: Command | null) {
  if (!command) throw new Error("no command");
  const tx = { origin: "user", label: command.label, ops: command.ops };
  const result = applyTransaction(deck, tx);
  if (!result.ok) throw new Error(result.error.message);
  return indexSlide(result.deck.slides[0] as never);
}
const position = (i: ReturnType<typeof apply>, id: string) => i.nodes.get(id)?.node.position;

describe("alignable", () => {
  it("is every selected layer, when all of them are free", () => {
    expect(alignable(index, ["a", "pin"])).toEqual(["a", "pin"]);
    expect(alignable(index, ["a", "title"])).toEqual([]); // title is in the flow
    expect(alignable(index, ["root"])).toEqual([]);
    expect(alignable(index, ["board", "a"])).toEqual([]); // board covers a; board is in the flow
  });
});

describe("align", () => {
  it("lines layers up on an edge of their combined box", () => {
    const command = alignLayers(index, ["a", "b", "c"], "left", rects);
    expect(command?.label).toBe("Align 3 layers left");
    expect(command?.ops).toHaveLength(2); // a is already on the left edge
    const after = apply(command);
    expect(position(after, "b")).toEqual({ x: 10, y: 50 });
    expect(position(after, "c")).toEqual({ x: 10, y: 20 });
  });

  it("aligns centers and far edges", () => {
    // Combined box: x 210..530 (center 370), y 110..190 (center 150).
    const centered = apply(alignLayers(index, ["a", "b", "c"], "center", rects));
    expect(position(centered, "a")).toEqual({ x: 145, y: 10 }); // left edge 370 - 25 = 345: +135
    const bottom = apply(alignLayers(index, ["a", "b", "c"], "bottom", rects));
    expect(position(bottom, "a")).toEqual({ x: 10, y: 70 });
    expect(position(bottom, "b")?.y).toBe(50); // already the bottom one
    const middle = apply(alignLayers(index, ["a", "b", "c"], "middle", rects));
    expect(position(middle, "c")).toEqual({ x: 300, y: 35 }); // center 135 → 150
  });

  it("aligns a single layer to its frame's content box", () => {
    const container = { x: 200, y: 100, w: 800, h: 400 };
    const command = alignLayers(index, ["b"], "right", rects, container);
    expect(command?.label).toBe('Align "b" right');
    expect(position(apply(command), "b")).toEqual({ x: 700, y: 50 });
    expect(alignLayers(index, ["b"], "right", rects)).toBeNull(); // nothing to align to
  });

  it("turns the shift into the parent's space under a rotated frame", () => {
    // `turned` is rotated 90°, so moving left on the slide is moving "down" (+y) inside it.
    const command = alignLayers(index, ["t", "pin"], "left", rects);
    expect(position(apply(command), "t")).toEqual({ x: 0, y: 800 });
  });

  it("does nothing for layers in a flow, or when everything is already aligned", () => {
    expect(alignLayers(index, ["a", "title"], "left", rects)).toBeNull();
    const lined = new Map(rects);
    lined.set("b", { rect: { x: 210, y: 150, w: 100, h: 40 } });
    expect(alignLayers(index, ["a", "b"], "left", lined)).toBeNull();
  });

  it("keeps the size of a layer that fills its frame on the axis it moves along", () => {
    // b and c fill the frame's width (text's default): moving them left would stretch them.
    const filled = new Map(rects);
    filled.set("b", { rect: { x: 300, y: 150, w: 700, h: 40 }, fill: { width: 700 } });
    filled.set("c", { rect: { x: 500, y: 120, w: 500, h: 30 }, fill: { width: 500 } });
    const command = alignLayers(index, ["a", "b", "c"], "left", filled);
    expect(command?.ops).toContainEqual({
      op: "node.update",
      id: "b",
      set: { position: { x: 10, y: 50 }, width: 700 },
    });
    // Moving only vertically leaves the width alone.
    const top = alignLayers(index, ["a", "b", "c"], "top", filled);
    expect(top?.ops).toContainEqual({
      op: "node.update",
      id: "b",
      set: { position: { x: 100, y: 10 } },
    });
  });
});

describe("distribute", () => {
  it("makes the gaps between neighbours equal, keeping the outer layers in place", () => {
    // a 210..260, b 300..400, c 500..530: 320 span, 180 filled → 70 gaps.
    const command = distributeLayers(index, ["c", "a", "b"], "horizontal", rects);
    expect(command?.label).toBe("Distribute 3 layers horizontally");
    const after = apply(command);
    expect(position(after, "a")).toEqual({ x: 10, y: 10 });
    expect(position(after, "b")).toEqual({ x: 130, y: 50 }); // 260 + 70 = 330 on the slide
    expect(position(after, "c")).toEqual({ x: 300, y: 20 });
  });

  it("works vertically, and needs three layers", () => {
    // By y: a 110..130, c 120..150, b 150..190: 80 span, 90 filled → gaps of -5.
    const after = apply(distributeLayers(index, ["a", "b", "c"], "vertical", rects));
    expect(position(after, "c")).toEqual({ x: 300, y: 25 }); // 110 + 20 - 5 = 125: +5
    expect(distributeLayers(index, ["a", "b"], "vertical", rects)).toBeNull();
  });
});
