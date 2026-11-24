import { describe, expect, it } from "vitest";
import { createDeck, createSlide, element, frame } from "../builders.js";
import { lintDeck } from "../lint.js";
import { duplicateMatchKeys, matchKeyOf, morphPairs, slideMatchKeys } from "../morph.js";
import { MatchKeySchema, NodeSchema } from "../schema/node.js";

const text = (id: string, extra = {}) => element("text", { content: id }, { id, ...extra });
const shape = (id: string, extra = {}) => element("shape", { shape: "rect" }, { id, ...extra });
const pairs = (a: ReturnType<typeof createSlide>, b: ReturnType<typeof createSlide>) =>
  morphPairs(a, b).map((p) => `${p.from.id}→${p.to.id} (${p.by})`);

describe("morph match keys (D109)", () => {
  it("keys a layer by its matchKey, else its ID", () => {
    expect(matchKeyOf(text("a"))).toBe("a");
    expect(matchKeyOf(text("a", { matchKey: "logo" }))).toBe("logo");
  });

  it("validates keys with errors that say how to fix them", () => {
    expect(MatchKeySchema.safeParse("hero title").success).toBe(true);
    const empty = MatchKeySchema.safeParse("");
    expect(empty.error?.issues[0]?.message).toMatch(/"matchKey": null/);
    for (const bad of [" logo", "logo ", "two\nlines"]) {
      expect(MatchKeySchema.safeParse(bad).error?.issues[0]?.message).toMatch(/one line/);
    }
    expect(NodeSchema.safeParse(text("a", { matchKey: "logo" })).success).toBe(true);
  });

  it("pairs a duplicated slide's copies with their originals by key, nested layers too", () => {
    const original = createSlide({
      children: [text("title"), frame({ id: "card", children: [shape("dot")] })],
    });
    // What Duplicate slide makes: fresh IDs, each keyed by its original's ID.
    const copy = createSlide({
      children: [
        frame({ id: "card2", matchKey: "card", children: [shape("dot2", { matchKey: "dot" })] }),
        text("title2", { matchKey: "title" }),
      ],
    });
    expect(pairs(original, copy)).toEqual([
      "title→title2 (key)",
      "card→card2 (key)",
      "dot→dot2 (key)",
    ]);
    // And a duplicate of the duplicate still pairs with both.
    const third = createSlide({ children: [text("title3", { matchKey: "title" })] });
    expect(pairs(copy, third)).toEqual(["title2→title3 (key)"]);
  });

  it("falls back to name and type for layers no key pairs, each layer once", () => {
    const a = createSlide({
      children: [
        shape("s1", { name: "Logo" }),
        text("t1", { name: "Logo" }),
        shape("s2", { name: "Logo" }),
        text("lonely"),
      ],
    });
    const b = createSlide({
      children: [text("t2", { name: "Logo" }), shape("s3", { name: "Logo" }), text("other")],
    });
    // Same name, same type, in order; the second "Logo" shape has no partner left.
    expect(pairs(a, b)).toEqual(["s1→s3 (name)", "t1→t2 (name)"]);
  });

  it("pairs by key before name, and never pairs the slide's root frame", () => {
    const a = createSlide({
      rootId: "root-a",
      children: [shape("x", { matchKey: "hero", name: "Box" }), shape("y", { name: "Box" })],
    });
    const b = createSlide({
      rootId: "root-a2",
      children: [shape("z", { name: "Box" }), shape("w", { matchKey: "hero" })],
    });
    expect(pairs(a, b)).toEqual(["x→w (key)", "y→z (name)"]);
    expect(slideMatchKeys(a)).toEqual(new Set(["hero", "y"]));
  });

  it("uses the first layer when a key repeats on a slide, and lint says so", () => {
    const slide = createSlide({
      id: "s",
      children: [
        text("a", { matchKey: "logo" }),
        text("b", { matchKey: "logo" }),
        text("c", { matchKey: "a" }), // no clash: layer "a" goes by "logo", not its ID
      ],
    });
    const next = createSlide({ children: [text("d", { matchKey: "logo" })] });
    expect(pairs(slide, next)).toEqual(["a→d (key)"]);
    expect(duplicateMatchKeys(slide)).toEqual(new Map([["logo", ["a", "b"]]]));

    const deck = createDeck({ title: "t", slides: [slide] });
    const issue = lintDeck(deck).find((i) => i.rule === "duplicate-match-key");
    expect(issue).toMatchObject({ severity: "warning", nodeIds: ["a", "b"] });
    expect(issue?.message).toContain('share the match key "logo"');
    expect(issue?.fix).toContain('"matchKey": null');
  });
});
