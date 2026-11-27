/**
 * Motion lint (D126): motion that plays without error but quietly doesn't show, found by
 * agents testing the animation tools. Each rule names the layer and the fix.
 */
import { describe, expect, it } from "vitest";
import { createDeck, createSlide, element } from "../builders.js";
import type { EffectResolver } from "../evaluate.js";
import { type LintIssue, lintDeck } from "../lint.js";
import type { Animation } from "../schema/animation.js";
import type { Deck, Slide } from "../schema/deck.js";

/** A tiny effect set: an entrance, a flip and a loop, like the built-ins. */
const effects: EffectResolver = (effect): ReturnType<EffectResolver> => {
  switch (effect.name) {
    case "fade-in":
      return {
        duration: 400,
        tracks: {
          opacity: [
            { at: 0, value: 0 },
            { at: 1, value: 1 },
          ],
        },
      };
    case "flip-in":
      return {
        duration: 400,
        tracks: {
          rotateX: [
            { at: 0, value: -45 },
            { at: 1, value: 0 },
          ],
        },
      };
    case "float":
      return {
        duration: 1000,
        tracks: {
          y: [
            { at: 0, value: 0 },
            { at: 0.5, value: -10 },
            { at: 1, value: 0 },
          ],
        },
      };
    case "count-up":
      return {
        duration: 400,
        tracks: {
          opacity: [
            { at: 0, value: 0 },
            { at: 1, value: 1 },
          ],
        },
      };
    default:
      return null;
  }
};
const effectWarning = (effect: { name: string }, target: { id: string }) =>
  effect.name === "count-up" && target.id === "words"
    ? { message: "count-up has no number to count", fix: "Use another entrance." }
    : undefined;

const text = (id: string, content: string, extra: Record<string, unknown> = {}) =>
  element("text", { content, style: "$text.h1" }, { id, ...extra });
const anim = (
  id: string,
  target: string,
  effect: string,
  extra: Partial<Animation> = {},
): Animation => ({
  id,
  target,
  trigger: "withPrevious",
  effect: { name: effect },
  ...extra,
});
const withAnimations = (slide: Slide, animations: Animation[]): Slide => ({ ...slide, animations });
const lint = (deck: Deck): LintIssue[] =>
  lintDeck(deck, { motion: { effects, effectWarning } }).filter((i) =>
    ["morph-blocked", "flat-turn", "effect-misfit"].includes(i.rule),
  );

describe("motion lint (D126)", () => {
  const one = createSlide({ id: "one", children: [text("a-star", "★", { matchKey: "star" })] });
  const two = createSlide({
    id: "two",
    transition: { type: "morph" },
    children: [text("b-star", "★", { matchKey: "star" })],
  });

  it("flags a morph partner with its own entrance, or a loop as its slide leaves", () => {
    const deck = createDeck({
      title: "Motion",
      slides: [
        withAnimations(one, [anim("a1", "a-star", "float", { repeat: "forever" })]),
        withAnimations(two, [anim("b1", "b-star", "fade-in")]),
      ],
    });
    const issues = lint(deck);
    expect(issues.map((i) => [i.slideId, i.nodeIds[0]])).toEqual([
      ["one", "a-star"],
      ["two", "b-star"],
    ]);
    expect(issues[0]?.message).toMatch(/loops as slide "one" ends/);
    expect(issues[1]?.message).toMatch(/has its own entrance/);
    expect(issues[1]?.fix).toMatch(/Remove "b-star"'s entrance/);
    // Without a morph, the same animations are fine.
    const cut = createDeck({
      title: "Motion",
      slides: [
        one,
        withAnimations({ ...two, transition: { type: "fade" } }, [anim("b1", "b-star", "fade-in")]),
      ],
    });
    expect(lint(cut)).toEqual([]);
  });

  it("flags a 3D turn without perspective, from an effect or a track", () => {
    const flat = createSlide({ id: "flat", children: [text("t", "Hi")] });
    const deck = createDeck({
      title: "Motion",
      slides: [
        withAnimations(flat, [
          anim("f1", "t", "flip-in"),
          {
            id: "f2",
            target: "t",
            trigger: "afterPrevious",
            tracks: {
              rotateY: [
                { at: 0, value: 0 },
                { at: 1, value: 30 },
              ],
            },
          },
        ]),
      ],
    });
    const issues = lint(deck);
    expect(issues.map((i) => i.rule)).toEqual(["flat-turn", "flat-turn"]);
    expect(issues[0]?.fix).toMatch(/"perspective": 1200/);
    const deep = createDeck({
      title: "Motion",
      slides: [
        withAnimations(
          { ...flat, root: { ...flat.root, perspective: 1200 } },
          flat.animations ?? [],
        ),
      ],
    });
    expect(
      lint({
        ...deep,
        slides: [withAnimations(deep.slides[0] as Slide, [anim("f1", "t", "flip-in")])],
      }),
    ).toEqual([]);
  });

  it("passes on an effect's own warning about its layer", () => {
    const s = createSlide({
      id: "s",
      children: [text("words", "We are star stuff"), text("num", "75 %")],
    });
    const deck = createDeck({
      title: "Motion",
      slides: [withAnimations(s, [anim("c1", "words", "count-up"), anim("c2", "num", "count-up")])],
    });
    const issues = lint(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: "effect-misfit", nodeIds: ["words"] });
    expect(issues[0]?.message).toMatch(/Animation "c1": count-up has no number/);
  });

  it("runs only with the installed effects (a document-only lint skips it)", () => {
    const deck = createDeck({
      title: "Motion",
      slides: [withAnimations(two, [anim("b1", "b-star", "fade-in")]), one],
    });
    expect(lintDeck(deck).some((i) => i.rule === "morph-blocked")).toBe(false);
  });
});
