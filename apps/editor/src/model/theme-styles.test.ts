import {
  createDeck,
  createSlide,
  DEFAULT_THEME,
  element,
  frame,
  type Theme,
  ThemeSchema,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  changedGroups,
  emToPercent,
  mergeDraft,
  newTokenValue,
  percentToEm,
  textStyleSummary,
  tokenNameError,
  tokenUses,
  withShadow,
  withTextStyle,
  withToken,
} from "./theme-styles.js";

const theme: Theme = DEFAULT_THEME;
const valid = (t: Theme) => ThemeSchema.safeParse(t).success;

describe("theme styles (D78)", () => {
  it("edits a text style's fields, drops optional ones, and stays a valid theme", () => {
    const bigger = withTextStyle(theme, "h1", {
      size: 96,
      letterSpacing: null,
      transform: "uppercase",
    });
    expect(bigger.text.h1).toEqual({
      font: "heading",
      size: 96,
      weight: 700,
      lineHeight: 1.1,
      transform: "uppercase",
    });
    expect(bigger.name).toBe("Veloce Light (custom)");
    expect(bigger.text.h2).toBe(theme.text.h2); // untouched styles are shared, not copied
    expect(valid(bigger)).toBe(true);
    expect(withTextStyle(theme, "nope", { size: 1 })).toBe(theme);
    expect(theme.text.h1?.size).toBe(80); // never mutates
  });

  it("adds, changes and removes scale tokens and shadows", () => {
    let t = withToken(theme, "space", "xxxl", 240);
    expect(t.space.xxxl).toBe(240);
    t = withToken(t, "radius", "sm", 4);
    expect(t.radius.sm).toBe(4);
    t = withToken(t, "space", "xs", null);
    expect(t.space).not.toHaveProperty("xs");
    t = withShadow(t, "md", { blur: 40, spread: 2 });
    expect(t.shadow.md).toEqual({ x: 0, y: 8, blur: 40, spread: 2, color: "#00000026" });
    t = withShadow(t, "md", { spread: null });
    expect(t.shadow.md).not.toHaveProperty("spread");
    expect(valid(t)).toBe(true);
    expect(t.name).toBe("Veloce Light (custom)"); // once
  });

  it("checks new token names: the token rule, and no duplicates", () => {
    expect(tokenNameError(theme, "text", "quote")).toBeNull();
    expect(tokenNameError(theme, "text", "h1")).toBe('"h1" already exists.');
    expect(tokenNameError(theme, "space", "2xl")).toMatch(/Start with a letter/);
    expect(tokenNameError(theme, "space", "big gap")).toMatch(/Start with a letter/);
    expect(tokenNameError(theme, "radius", "")).toBe("Give it a name.");
    expect(tokenNameError(theme, "shadow", "toString")).toBeNull(); // not an inherited key
  });

  it("starts new tokens from the selected one, else sensible values", () => {
    const copy = newTokenValue(theme, "text", "h2");
    expect(copy).toEqual(theme.text.h2);
    expect(copy).not.toBe(theme.text.h2);
    expect(newTokenValue(theme, "text")).toEqual(theme.text.body);
    expect(newTokenValue(theme, "space")).toBe(160);
    expect(newTokenValue(theme, "radius")).toBe(8);
    expect(newTokenValue(theme, "shadow")).toEqual(theme.shadow.md);
    expect(newTokenValue({ ...theme, space: {} }, "space")).toBe(0);
  });

  it("counts a token's uses in the slides (exact references only)", () => {
    const deck = createDeck({
      title: "T",
      slides: [
        createSlide({
          layout: { mode: "stack", gap: "$space.md", padding: "$space.lg" },
          children: [
            element("text", { content: "$space.md is a token", style: "$text.h1" }),
            frame({
              layout: { mode: "stack", padding: { x: "$space.md" } },
              style: { shadow: "$shadow.md" },
            }),
          ],
        }),
      ],
    });
    expect(tokenUses(deck, "space", "md")).toBe(2);
    expect(tokenUses(deck, "space", "lg")).toBe(1);
    expect(tokenUses(deck, "text", "h1")).toBe(1);
    expect(tokenUses(deck, "shadow", "md")).toBe(1);
    expect(tokenUses(deck, "radius", "md")).toBe(0);
  });

  it("saves only the groups the user changed, onto the current theme", () => {
    const draft = withToken(withTextStyle(theme, "body", { size: 30 }), "space", "md", 40);
    expect(changedGroups(theme, draft)).toEqual(["text", "space"]);
    // Meanwhile an agent recolored the deck and changed the radius scale.
    const current: Theme = {
      ...theme,
      colors: { ...theme.colors, primary: "#ff0000" },
      radius: { ...theme.radius, md: 20 },
    };
    const saved = mergeDraft(theme, draft, current);
    expect(saved?.colors.primary).toBe("#ff0000");
    expect(saved?.radius.md).toBe(20);
    expect(saved?.text.body?.size).toBe(30);
    expect(saved?.space.md).toBe(40);
    expect(saved?.name).toBe("Veloce Light (custom)");
    expect(saved && valid(saved)).toBe(true);
    expect(mergeDraft(theme, theme, current)).toBeNull();
  });

  it("shows letter spacing in %, stores em; summarizes a style", () => {
    expect(emToPercent(0.02)).toBe(2);
    expect(emToPercent(-0.01)).toBe(-1);
    expect(emToPercent(undefined)).toBeUndefined();
    expect(percentToEm(2.5)).toBe(0.025);
    expect(emToPercent(0.0123)).toBe(1.23);
    for (const em of [0.0123, -0.0005, 0.1, 0.0001]) {
      expect(percentToEm(emToPercent(em) ?? 0)).toBe(em); // lossless both ways
    }
    expect(textStyleSummary(theme.text.h1 as never)).toBe("80 · Bold");
    expect(textStyleSummary({ font: "body", size: 12, weight: 450, lineHeight: 1 })).toBe(
      "12 · 450",
    );
  });
});
