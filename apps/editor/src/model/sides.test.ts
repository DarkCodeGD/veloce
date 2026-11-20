import {
  applyOp,
  createDeck,
  createSlide,
  type Deck,
  type FrameNode,
  frame,
  type Padding,
  type Space,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import {
  collapsePadding,
  mostCommon,
  paddingSides,
  type Side,
  setPaddingSide,
  uniformValue,
} from "./sides.js";

/** A deck with one frame "card" padded `padding`; commands run through the real ops. */
const deckWith = (padding?: Padding): Deck =>
  createDeck({
    title: "T",
    slides: [
      createSlide({
        id: "s1",
        children: [
          frame({
            id: "card",
            layout: { mode: "stack", ...(padding !== undefined && { padding }) },
          }),
        ],
      }),
    ],
  });

const apply = (deck: Deck, command: Command | null): Deck =>
  (command?.ops ?? []).reduce((d, op) => applyOp(d, op).deck, deck);

const padding = (deck: Deck) =>
  (deck.slides[0]?.root.children[0] as FrameNode | undefined)?.layout.padding;

/** Set one side on a card padded `start` and return the stored padding. */
const afterSide = (start: Padding | undefined, side: Side, value: Space | null) =>
  padding(apply(deckWith(start), setPaddingSide("card", start, side, value)));

describe("per-side padding (D75)", () => {
  it("reads every stored form as four sides", () => {
    expect(paddingSides(undefined)).toEqual({
      top: undefined,
      right: undefined,
      bottom: undefined,
      left: undefined,
    });
    expect(paddingSides("$space.md")).toEqual({
      top: "$space.md",
      right: "$space.md",
      bottom: "$space.md",
      left: "$space.md",
    });
    expect(paddingSides({ x: 40, y: 20 })).toEqual({ top: 20, right: 40, bottom: 20, left: 40 });
    expect(paddingSides({ x: 40 })).toEqual({
      top: undefined,
      right: 40,
      bottom: undefined,
      left: 40,
    });
    expect(paddingSides({ top: 8, left: "$space.sm" })).toEqual({
      top: 8,
      right: undefined,
      bottom: undefined,
      left: "$space.sm",
    });
  });

  it("one side spells out the four, keeping the others (from one value or x/y)", () => {
    expect(afterSide(32, "left", 80)).toEqual({ top: 32, right: 32, bottom: 32, left: 80 });
    expect(afterSide({ x: 40, y: 20 }, "top", 0)).toEqual({
      top: 0,
      right: 40,
      bottom: 20,
      left: 40,
    });
    expect(afterSide(undefined, "bottom", "$space.lg")).toEqual({ bottom: "$space.lg" });
  });

  it("edits a four-side padding in place; unsetting the last side clears it", () => {
    expect(afterSide({ top: 8, left: 16 }, "top", 24)).toEqual({ top: 24, left: 16 });
    expect(afterSide({ top: 8, left: 16 }, "top", null)).toEqual({ left: 16 });
    expect(afterSide({ left: 16 }, "left", null)).toBeUndefined();
    expect(setPaddingSide("card", { top: 8 }, "top", 8)).toBeNull();
  });

  it("collapsing keeps the value most sides have; one value is left alone", () => {
    const collapse = (start: Padding) =>
      padding(apply(deckWith(start), collapsePadding("card", start)));
    expect(collapse({ top: 32, right: 32, bottom: 32, left: 80 })).toBe(32);
    expect(collapse({ x: 40, y: 20 })).toBe(20); // a tie: the top's value
    expect(collapse({ left: "$space.md" })).toBe("$space.md");
    expect(collapse({ top: 0, right: 0, bottom: 0, left: 0 })).toBe(0);
    expect(collapsePadding("card", 32)).toBeNull();
    expect(collapsePadding("card", undefined)).toBeNull();
    expect(collapsePadding("card", {})).toEqual(
      expect.objectContaining({
        ops: [expect.objectContaining({ set: { layout: { padding: null } } })],
      }),
    );
  });

  it("generic helpers: uniform value and most common value", () => {
    expect(uniformValue({ a: 1, b: 1 })).toEqual({ value: 1 });
    expect(uniformValue({ a: undefined, b: undefined })).toEqual({ value: undefined });
    expect(uniformValue({ a: 1, b: 2 })).toBeNull();
    expect(uniformValue({ a: "$space.md", b: "$space.md" })).toEqual({ value: "$space.md" });
    expect(mostCommon([1, 2, 2, undefined])).toBe(2);
    expect(mostCommon([undefined, 3, 4])).toBe(3);
    expect(mostCommon([undefined, undefined])).toBeUndefined();
  });
});
