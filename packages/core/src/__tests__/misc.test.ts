import { describe, expect, it } from "vitest";
import { assetRef, assetUsage, collectAssetRefs, parseAssetRef, sha256Hex } from "../assets.js";
import { createDeck, createSlide, element } from "../builders.js";
import { DEFAULT_THEME } from "../default-theme.js";
import { createId, ID_PATTERN, randomId } from "../ids.js";
import { notFoundHint, suggest } from "../suggest.js";
import { parseTokenRef, resolveToken, themeToCssVariables, tokenCssVar } from "../tokens.js";
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
