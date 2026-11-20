import {
  applyOp,
  createDeck,
  createSlide,
  DEFAULT_THEME,
  type Deck,
  type FrameNode,
  frame,
  type Theme,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import {
  addBorder,
  addShadow,
  CUSTOM,
  defaultShadow,
  FALLBACK_SHADOW,
  removeBorder,
  removeShadow,
  setShadowPreset,
  shadowColor,
  shadowPreset,
  shadowValues,
} from "./frame-style.js";

const theme: Theme = DEFAULT_THEME;

/** A deck whose one slide holds an empty frame "card"; commands run through the real ops. */
const deckWithCard = (): Deck =>
  createDeck({
    title: "T",
    theme,
    slides: [
      createSlide({ id: "s1", children: [frame({ id: "card", layout: { mode: "stack" } })] }),
    ],
  });

const apply = (deck: Deck, command: Command | null): Deck =>
  (command?.ops ?? []).reduce((d, op) => applyOp(d, op).deck, deck);

const style = (deck: Deck) => (deck.slides[0]?.root.children[0] as FrameNode | undefined)?.style;

describe("frame border and shadow (D74)", () => {
  it("adds a border in the theme's border color, edits it in place, and removes it", () => {
    let deck = apply(deckWithCard(), addBorder("card"));
    expect(style(deck)?.stroke).toEqual({ color: "$color.border", width: 2 });
    // Fields patch one key; the rest of the border stays (nested objects merge).
    deck = apply(deck, {
      label: "w",
      ops: [{ op: "node.update", id: "card", set: { style: { stroke: { width: 6 } } } }],
    });
    expect(style(deck)?.stroke).toEqual({ color: "$color.border", width: 6 });
    deck = apply(deck, removeBorder("card"));
    expect(style(deck)?.stroke).toBeUndefined();
  });

  it("adds the theme's md shadow; falls back to the first token, then explicit values", () => {
    expect(defaultShadow(theme)).toBe("$shadow.md");
    expect(defaultShadow({ ...theme, shadow: { soft: FALLBACK_SHADOW } })).toBe("$shadow.soft");
    expect(defaultShadow({ ...theme, shadow: {} })).toEqual(FALLBACK_SHADOW);
    let deck = apply(deckWithCard(), addShadow("card", theme));
    expect(style(deck)?.shadow).toBe("$shadow.md");
    deck = apply(deck, removeShadow("card"));
    expect(style(deck)?.shadow).toBeUndefined();
  });

  it("Custom copies the token's values; a token replaces explicit values", () => {
    let deck = apply(deckWithCard(), addShadow("card", theme));
    expect(shadowPreset("$shadow.md")).toBe("$shadow.md");
    expect(setShadowPreset("card", theme, "$shadow.md", "$shadow.md")).toBeNull();
    deck = apply(deck, setShadowPreset("card", theme, "$shadow.md", CUSTOM));
    expect(style(deck)?.shadow).toEqual(theme.shadow.md);
    expect(shadowPreset(theme.shadow.md as never)).toBe(CUSTOM);
    deck = apply(deck, setShadowPreset("card", theme, theme.shadow.md as never, "$shadow.lg"));
    expect(style(deck)?.shadow).toBe("$shadow.lg");
  });

  it("reads a token's values, without sharing the theme's object", () => {
    const values = shadowValues(theme, "$shadow.sm");
    expect(values).toEqual(theme.shadow.sm);
    expect(values).not.toBe(theme.shadow.sm);
    expect(shadowValues(theme, "$shadow.nope")).toEqual(FALLBACK_SHADOW);
    expect(shadowValues(theme, "$shadow.toString")).toEqual(FALLBACK_SHADOW);
  });

  it("stores shadow colors as hex: theme colors resolve, with their opacity", () => {
    expect(shadowColor(theme, "#ff000080")).toBe("#ff000080");
    expect(shadowColor(theme, "$color.primary")).toBe("#4f46e5");
    expect(shadowColor(theme, "$color.primary/50")).toBe("#4f46e580");
    expect(shadowColor(theme, "$color.nope")).toBeNull();
    expect(shadowColor(theme, "red")).toBeNull();
    expect(shadowColor(theme, null)).toBeNull();
  });
});
