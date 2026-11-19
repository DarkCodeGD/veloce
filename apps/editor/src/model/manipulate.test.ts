import { applyTransaction, createDeck, createSlide, type Deck, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import {
  ancestorRotation,
  dropInto,
  freeSizing,
  isFree,
  moveTo,
  placeFreely,
  placeInFlow,
  resizeTo,
  rotateTo,
} from "./manipulate.js";
import { indexSlide } from "./slide-index.js";

const text = (id: string, extra = {}) => element("text", { content: id }, { id, ...extra });

/** root (column) > [free (absolute) > [a, b], row (row) > [c1, c2, c3], turned (45°) > [x]] */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          frame({
            id: "free",
            layout: { mode: "absolute" },
            children: [text("a", { position: { x: 10, y: 20 } }), text("b")],
          }),
          frame({
            id: "row",
            name: "Row",
            layout: { mode: "stack", direction: "row" },
            children: [text("c1"), text("c2"), text("c3")],
          }),
          frame({
            id: "turned",
            rotation: 45,
            layout: { mode: "absolute" },
            children: [text("x")],
          }),
        ],
      }),
    ],
  });
}

const deck = makeDeck();
const index = indexSlide(deck.slides[0] as (typeof deck.slides)[0]);

/** Apply a command like the server does and return the new slide index. */
function apply(command: Command | null) {
  if (!command) throw new Error("no command");
  const result = applyTransaction(deck, { origin: "user", label: command.label, ops: command.ops });
  if (!result.ok) throw new Error(result.error.message);
  return indexSlide(result.deck.slides[0] as (typeof deck.slides)[0]);
}
const childIds = (i: ReturnType<typeof apply>, id: string) => {
  const n = i.nodes.get(id)?.node;
  return n?.kind === "frame" ? n.children.map((c) => c.id) : [];
};

describe("manipulate", () => {
  it("knows which layers are placed freely, and how their parent space is turned", () => {
    expect(isFree(index, "a")).toBe(true);
    expect(isFree(index, "c1")).toBe(false);
    expect(ancestorRotation(index, "x")).toBe(45);
    expect(ancestorRotation(index, "a")).toBe(0);
  });

  it("moves free layers only, rounding to two decimals, in one command", () => {
    const command = moveTo(
      index,
      new Map([
        ["a", { x: 15.004, y: 20 }],
        ["b", { x: -3, y: 7.5 }],
        ["c1", { x: 1, y: 1 }], // in a stack: skipped
      ]),
    );
    expect(command?.label).toBe("Move 2 layers");
    const after = apply(command);
    expect(after.nodes.get("a")?.node.position).toEqual({ x: 15, y: 20 });
    expect(after.nodes.get("b")?.node.position).toEqual({ x: -3, y: 7.5 });
    expect(moveTo(index, new Map([["a", { x: 10, y: 20 }]]))).toBeNull(); // unchanged
  });

  it("reorders within a stack (index counted without the moved layer)", () => {
    const command = dropInto(index, "c1", { parentId: "row", index: 2 });
    expect(command?.label).toBe('Reorder "c1"');
    expect(childIds(apply(command), "row")).toEqual(["c2", "c3", "c1"]);
    expect(dropInto(index, "c2", { parentId: "row", index: 1 })).toBeNull(); // same slot
  });

  it("moves a layer into another frame, setting or dropping its position", () => {
    const intoFree = apply(dropInto(index, "c2", { parentId: "free", position: { x: 40, y: 50 } }));
    expect(childIds(intoFree, "free")).toEqual(["a", "b", "c2"]);
    expect(intoFree.nodes.get("c2")?.node.position).toEqual({ x: 40, y: 50 });

    const command = dropInto(index, "a", { parentId: "row", index: 0 });
    expect(command?.label).toBe('Move "a" into "Row"');
    const intoRow = apply(command);
    expect(childIds(intoRow, "row")).toEqual(["a", "c1", "c2", "c3"]);
    expect(intoRow.nodes.get("a")?.node.position).toBeUndefined(); // meaningless in a stack
  });

  it("moves within a free frame with a position update only", () => {
    const command = dropInto(index, "a", { parentId: "free", position: { x: 1, y: 2 } });
    expect(command?.ops).toEqual([
      { op: "node.update", id: "a", set: { position: { x: 1, y: 2 } } },
    ]);
  });

  it("resizes to whole pixels, moving free layers whose top/left side moved", () => {
    const after = apply(
      resizeTo(index, "a", { width: 120.4, height: 0.2, position: { x: 5, y: 20 } }),
    );
    const a = after.nodes.get("a")?.node;
    expect([a?.width, a?.height, a?.position]).toEqual([120, 1, { x: 5, y: 20 }]);
    // In a stack, the layout places it: only the size changes.
    expect(resizeTo(index, "c1", { width: 80, position: { x: 9, y: 9 } })?.ops).toEqual([
      { op: "node.update", id: "c1", set: { width: 80 } },
    ]);
  });

  it("rotates, and 0° resets the field", () => {
    expect(apply(rotateTo(index, "a", 30)).nodes.get("a")?.node.rotation).toBe(30);
    expect(apply(rotateTo(index, "turned", 0)).nodes.get("turned")?.node.rotation).toBeUndefined();
    expect(rotateTo(index, "a", 0)).toBeNull();
  });
});

describe("free positioning in stacks and grids", () => {
  /** root (column) > [title, badge (free at 600,40), card (stack) > [inner]] */
  const freeDeck = createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        children: [
          text("title"),
          text("badge", { positioning: "free", position: { x: 600, y: 40 } }),
          frame({ id: "card", layout: { mode: "stack" }, children: [text("inner")] }),
        ],
      }),
    ],
  });
  const fx = indexSlide(freeDeck.slides[0] as (typeof freeDeck.slides)[0]);
  const run = (command: Command | null) => {
    if (!command) throw new Error("no command");
    const result = applyTransaction(freeDeck, {
      origin: "user",
      label: command.label,
      ops: command.ops,
    });
    if (!result.ok) throw new Error(result.error.message);
    return indexSlide(result.deck.slides[0] as (typeof freeDeck.slides)[0]);
  };
  const nodeOf = (i: ReturnType<typeof run>, id: string) => i.nodes.get(id)?.node;

  it("treats free layers in a stack like children of a free frame", () => {
    expect(isFree(fx, "badge")).toBe(true);
    expect(isFree(fx, "title")).toBe(false);
    expect(isFree(fx, "root")).toBe(false);
    // Moves and nudges change their position; flow layers are skipped.
    const moved = moveTo(
      fx,
      new Map([
        ["badge", { x: 610.004, y: 52 }],
        ["title", { x: 1, y: 1 }],
      ]),
    );
    expect(moved?.ops).toEqual([
      { op: "node.update", id: "badge", set: { position: { x: 610, y: 52 } } },
    ]);
  });

  it("bakes stretched sizes when a layer leaves the flow, and keeps fitted ones fitting", () => {
    const column = { mode: "stack" } as const;
    const rendered = { w: 1600.4, h: 72 };
    // Text in a column: fill width → its pixels; hug height stays hug.
    expect(freeSizing(column, { width: "fill", height: "hug" }, rendered)).toEqual({
      width: 1600,
    });
    // A frame (auto both): stretched across the column → baked; along it → hug.
    expect(freeSizing(column, { width: "auto", height: "auto" }, rendered)).toEqual({
      width: 1600,
      height: "hug",
    });
    // Centered column: nothing stretches it.
    expect(
      freeSizing({ mode: "stack", align: "center" }, { width: "auto", height: "auto" }, rendered),
    ).toEqual({ width: "hug", height: "hug" });
    // A row stretches heights.
    expect(
      freeSizing({ mode: "stack", direction: "row" }, { width: "auto", height: "auto" }, rendered),
    ).toEqual({ width: "hug", height: 72 });
    // Grid cells stretch the width, and the height unless aligned.
    const grid = { mode: "grid", columns: 2 } as const;
    expect(freeSizing(grid, { width: "auto", height: "auto" }, rendered)).toEqual({
      width: 1600,
      height: 72,
    });
    expect(
      freeSizing({ ...grid, align: "start" }, { width: "auto", height: "auto" }, rendered),
    ).toEqual({ width: 1600, height: "hug" });
    // Fixed sizes stay.
    expect(freeSizing(column, { width: 300, height: 200 }, rendered)).toEqual({});
  });

  it("frees a layer in one step, and puts it back in the flow", () => {
    const freed = placeFreely(fx, "title", { x: 120.333, y: 64 }, { width: 1600, height: "hug" });
    expect(freed?.label).toBe('Place "title" freely');
    expect(freed?.ops).toEqual([
      {
        op: "node.update",
        id: "title",
        set: { positioning: "free", position: { x: 120.33, y: 64 }, width: 1600, height: "hug" },
      },
    ]);
    const after = run(freed);
    expect(nodeOf(after, "title")).toMatchObject({ positioning: "free", width: 1600 });
    // Already free, or in an absolute frame: nothing to do.
    expect(placeFreely(fx, "badge", { x: 0, y: 0 })).toBeNull();
    expect(placeFreely(index, "a", { x: 0, y: 0 })).toBeNull();

    const back = placeInFlow(fx, "badge");
    expect(back?.label).toBe('Put "badge" back in the layout');
    const flowing = nodeOf(run(back), "badge");
    expect(flowing?.positioning).toBeUndefined();
    expect(flowing?.position).toBeUndefined();
    expect(placeInFlow(fx, "title")).toBeNull();
  });

  it("moves a free layer within its stack by position, and resets it when it changes frames", () => {
    const within = dropInto(fx, "badge", { parentId: "root", position: { x: 700, y: 40 } });
    expect(within?.label).toBe('Move "badge"');
    expect(within?.ops).toEqual([
      { op: "node.update", id: "badge", set: { position: { x: 700, y: 40 } } },
    ]);
    // Into another stack: it joins that flow, without its now meaningless position.
    const into = dropInto(fx, "badge", { parentId: "card", index: 0 });
    const after = run(into);
    expect(childIds(after, "card")).toEqual(["badge", "inner"]);
    expect(nodeOf(after, "badge")?.positioning).toBeUndefined();
    expect(nodeOf(after, "badge")?.position).toBeUndefined();
  });
});
