import { describe, expect, it } from "vitest";
import { assetRef, assetUsage, collectAssetRefs, parseAssetRef, sha256Hex } from "../assets.js";
import { createDeck, createSlide, element } from "../builders.js";
import { DEFAULT_THEME } from "../default-theme.js";
import { createId, ID_PATTERN, randomId } from "../ids.js";
import { ColorSchema } from "../schema/primitives.js";
import { notFoundHint, suggest } from "../suggest.js";
import {
  colorCss,
  parseColorToken,
  parseTokenRef,
  resolveColor,
  resolveToken,
  themeToCssVariables,
  tokenCssVar,
} from "../tokens.js";
import { validateDeck } from "../validate.js";
import { fixtureDeck, IMAGE_ID } from "./fixtures.js";

describe("ids", () => {
  it("generates prefixed, valid, unique IDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId("nd")));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^nd_[0-9a-z]{10}$/);
    expect(randomId(32)).toMatch(ID_PATTERN);
  });
});

describe("suggest", () => {
  it("finds near misses and lists valid IDs otherwise", () => {
    expect(suggest("titel", ["title", "cards", "box"])).toEqual(["title"]);
    // Only the best match, not every sibling that's merely close…
    expect(suggest("card-2-titel", ["card-1-title", "card-2-title", "card-3-title"])).toEqual([
      "card-2-title",
    ]);
    // …but genuine ties are all shown.
    expect(suggest("card-x", ["card-1", "card-2"])).toEqual(["card-1", "card-2"]);
    expect(notFoundHint("zzzzzz", ["a", "b"], "node")).toBe('Valid node IDs: "a", "b".');
    expect(notFoundHint("x", [], "slide")).toBe("There are no slides yet.");
  });
});

describe("tokens", () => {
  it("parses and resolves token references", () => {
    expect(parseTokenRef("$color.on-primary")).toEqual({ group: "color", name: "on-primary" });
    expect(parseTokenRef("$colour.primary")).toBeNull();
    expect(resolveToken(DEFAULT_THEME, "$space.md")).toBe(32);
    expect(resolveToken(DEFAULT_THEME, "$color.nope")).toBeUndefined();
  });

  it("maps a theme to CSS variables and tokens to var() references", () => {
    const vars = themeToCssVariables(DEFAULT_THEME);
    expect(vars["--v-color-primary"]).toBe("#4f46e5");
    expect(vars["--v-text-h1-size"]).toBe("80px");
    expect(vars["--v-text-h1-font"]).toBe("var(--v-font-heading)");
    expect(vars["--v-shadow-sm"]).toBe("0px 2px 6px 0px #0000001a");
    expect(tokenCssVar("$text.h1", "size")).toBe("var(--v-text-h1-size)");
  });

  it("takes a theme color at an opacity: $color.name/NN", () => {
    expect(parseColorToken("$color.secondary/30")).toEqual({
      token: "$color.secondary",
      name: "secondary",
      opacity: 30,
    });
    expect(parseColorToken("$color.primary")?.opacity).toBe(100);
    expect(parseColorToken("$color.primary/101")).toBeNull();
    expect(parseColorToken("#4f46e5")).toBeNull();
    expect(parseColorToken("$space.md")).toBeNull();
    // Valid colors, for the schema too (and nothing looser).
    for (const ok of ["$color.primary/0", "$color.on-primary/5", "$color.accent/100"]) {
      expect(ColorSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      "$color.primary/101",
      "$color.primary/30%",
      "$color.primary/",
      "$space.md/30",
    ]) {
      expect(ColorSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("renders a color at an opacity as the theme variable mixed with transparent", () => {
    expect(colorCss("$color.secondary/30")).toBe(
      "color-mix(in srgb, var(--v-color-secondary) 30%, transparent)",
    );
    expect(colorCss("$color.secondary/100")).toBe("var(--v-color-secondary)");
    expect(colorCss("$color.secondary")).toBe("var(--v-color-secondary)");
    expect(colorCss("#4f46e5")).toBe("#4f46e5");
    expect(colorCss("transparent")).toBe("transparent");
  });

  it("resolves a color at an opacity to a concrete hex, keeping the theme color's alpha", () => {
    expect(resolveColor(DEFAULT_THEME, "$color.primary")).toBe("#4f46e5");
    expect(resolveColor(DEFAULT_THEME, "$color.primary/50")).toBe("#4f46e580");
    const glassy = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, glass: "#ffffff80" } };
    expect(resolveColor(glassy, "$color.glass/50")).toBe("#ffffff40"); // 50% of 50%
    expect(resolveColor(DEFAULT_THEME, "$color.nope/50")).toBeUndefined();
    expect(resolveColor(DEFAULT_THEME, "#123456")).toBe("#123456");
  });
});

describe("assets", () => {
  it("hashes bytes with SHA-256", async () => {
    // Known vector: SHA-256("abc").
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("finds asset references anywhere in plugin props", () => {
    const ref = assetRef(IMAGE_ID);
    expect(parseAssetRef(ref)).toBe(IMAGE_ID);
    expect([...collectAssetRefs({ a: [{ deep: ref }], b: "asset:nope" })]).toEqual([IMAGE_ID]);
    const deck = createDeck({
      title: "x",
      slides: [
        createSlide({
          id: "s",
          background: { type: "image", asset: ref },
          children: [element("image", { asset: ref }, { id: "i" })],
        }),
      ],
    });
    expect(assetUsage(deck).get(IMAGE_ID)).toEqual(["s", "i"]);
  });
});

describe("validateDeck", () => {
  it("accepts a valid deck", () => {
    const result = validateDeck(fixtureDeck());
    expect(result.ok).toBe(true);
  });

  it("collects every problem: duplicate IDs, missing assets, wrong format version", () => {
    const deck = fixtureDeck();
    const broken = {
      ...deck,
      formatVersion: 99,
      slides: [
        ...deck.slides,
        createSlide({ id: "intro", children: [element("image", { asset: `asset:${IMAGE_ID}` })] }),
      ],
    };
    const result = validateDeck(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => e.code).sort();
    expect(codes).toEqual(["CONFLICT", "INVALID", "NOT_FOUND"]);
  });

  it("treats unknown element types as warnings (missing plugin) and bad props as errors", () => {
    const validateElement = (type: string) =>
      type === "shape"
        ? ({ ok: false, reason: "unknown-type", message: "no plugin" } as const)
        : ({ ok: true } as const);
    const result = validateDeck(fixtureDeck(), { validateElement });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it("reports schema errors with paths", () => {
    const result = validateDeck({ ...fixtureDeck(), stage: { width: 10, height: 10 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe("stage.width");
  });
});
