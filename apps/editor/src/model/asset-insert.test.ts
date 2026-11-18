import {
  type AssetInfo,
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  frame,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  addFonts,
  fitSize,
  frameAt,
  type Imported,
  insertImages,
  type Rect,
  replaceAsset,
  splitImports,
} from "./asset-insert.js";
import type { Command } from "./commands.js";
import { indexSlide } from "./slide-index.js";

const sha = (c: string) => c.repeat(64);
const png = (c: string, width = 800, height = 600, name = `${c}.png`): Imported => ({
  id: sha(c),
  info: { mime: "image/png", bytes: 10, width, height, name },
});
const font: Imported = {
  id: sha("f"),
  info: { mime: "font/woff2", bytes: 10, name: "Acme.woff2", font: { family: "Acme" } },
};

/** root (absolute, the slide) > [stack > [t], locked (absolute, locked) > [inner (frame)]] */
function makeDeck(): Deck {
  return createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s1",
        rootId: "root",
        layout: { mode: "absolute" },
        children: [
          frame({ id: "stack", children: [element("text", { content: "Hi" }, { id: "t" })] }),
          frame({
            id: "locked",
            locked: true,
            layout: { mode: "absolute" },
            children: [frame({ id: "inner" })],
          }),
        ],
      }),
    ],
  });
}

const STAGE: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
const RECTS: Record<string, Rect> = {
  root: STAGE,
  stack: { x: 100, y: 100, w: 600, h: 400 },
  locked: { x: 1000, y: 100, w: 600, h: 600 },
  inner: { x: 1100, y: 200, w: 200, h: 200 },
};
const rectOf = (id: string) => RECTS[id] ?? null;
const indexOf = (deck: Deck) => indexSlide(deck.slides[0] as never);

function apply(deck: Deck, command: Command | null) {
  if (!command) throw new Error("no command");
  const result = applyTransaction(deck, { origin: "user", label: command.label, ops: command.ops });
  if (!result.ok) throw new Error(result.error.message);
  return result.deck;
}

describe("asset insertion", () => {
  it("sizes images to their pixels, scaled down to 60% of the frame at most, never up", () => {
    const info = (width: number, height: number): AssetInfo => ({
      mime: "image/png",
      bytes: 1,
      width,
      height,
    });
    expect(fitSize(info(400, 200), { w: 1920, h: 1080 })).toEqual({ width: 400, height: 200 });
    expect(fitSize(info(4000, 3000), { w: 1920, h: 1080 })).toEqual({ width: 864, height: 648 });
    expect(fitSize({ mime: "image/svg+xml", bytes: 1 }, { w: 1920, h: 1080 })).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("drops into the deepest frame under the pointer that isn't locked", () => {
    const index = indexOf(makeDeck());
    expect(frameAt(index, { x: 200, y: 200 }, rectOf)).toBe("stack");
    expect(frameAt(index, { x: 1150, y: 250 }, rectOf)).toBe("root"); // inside a locked frame
    expect(frameAt(index, { x: 50, y: 900 }, rectOf)).toBe("root");
  });

  it("centres dropped images on the point in a free frame, registering each file once", () => {
    const deck = makeDeck();
    const command = insertImages(
      indexOf(deck),
      [png("a"), png("b", 4000, 3000), png("a")],
      new Set(),
      {
        parentId: "root",
        parentRect: STAGE,
        center: { x: 960, y: 540 },
      },
    );
    expect(command?.label).toBe("Add 3 images");
    expect(command?.ops.filter((o) => o.op === "asset.add")).toHaveLength(2);
    const after = apply(deck, command);
    expect(Object.keys(after.assets).sort()).toEqual([sha("a"), sha("b")]);
    const added = command?.select?.map((id) => indexOf(after).nodes.get(id)?.node) ?? [];
    expect(added.map((n) => [n?.name, n?.width, n?.height, n?.position])).toEqual([
      ["a", 800, 600, { x: 560, y: 240 }],
      ["b", 864, 648, { x: 552, y: 240 }], // cascaded by 24, sized to the frame
      ["a", 800, 600, { x: 608, y: 288 }],
    ]);
    expect(added[0]).toMatchObject({
      type: "image",
      props: { asset: `asset:${sha("a")}`, alt: "" },
    });
  });

  it("appends to a stack without a position, sized to the stack, in one undoable step", () => {
    const deck = makeDeck();
    const known = new Set([sha("a")]);
    const command = insertImages(indexOf(deck), [png("a", 1000, 1000, "Team photo.jpg")], known, {
      parentId: "stack",
      parentRect: RECTS.stack as Rect,
      index: 0,
    });
    expect(command?.label).toBe('Add image "Team photo.jpg"');
    expect(command?.ops.map((o) => o.op)).toEqual(["node.insert"]); // the deck has the file
    const node = command?.ops[0]?.op === "node.insert" ? command.ops[0].node : undefined;
    expect(node).toMatchObject({ name: "Team photo", width: 240, height: 240 });
    expect(node?.position).toBeUndefined();
  });

  it("replaces a picture in one step, dropping the old file only when nothing else uses it", () => {
    let deck = makeDeck();
    const first = insertImages(indexOf(deck), [png("a"), png("a")], new Set(), {
      parentId: "root",
      parentRect: STAGE,
    });
    deck = apply(deck, first);
    const [one, two] = first?.select ?? [];
    if (!one || !two) throw new Error("no images");
    // "a" is still used by the other image: it stays.
    const keep = replaceAsset(deck, one, "asset", `asset:${sha("a")}`, png("b"));
    expect(keep.label).toBe('Replace image with "b.png"');
    expect(keep.ops.map((o) => o.op)).toEqual(["asset.add", "node.update"]);
    deck = apply(deck, keep);
    // The last user of "a" moves to "b" too: "a" goes.
    const drop = replaceAsset(deck, two, "asset", `asset:${sha("a")}`, png("b"));
    expect(drop.ops.map((o) => o.op)).toEqual(["node.update", "asset.remove"]);
    deck = apply(deck, drop);
    expect(Object.keys(deck.assets)).toEqual([sha("b")]);
  });

  it("registers fonts on their own, once", () => {
    expect(splitImports([png("a"), font])).toEqual({ images: [png("a")], fonts: [font] });
    const command = addFonts([font, font], new Set());
    expect(command).toEqual({
      label: 'Add font "Acme"',
      ops: [{ op: "asset.add", id: sha("f"), asset: font.info }],
    });
    expect(Object.keys(apply(makeDeck(), command).assets)).toEqual([sha("f")]);
    expect(addFonts([font], new Set([sha("f")]))).toBeNull();
  });
});
