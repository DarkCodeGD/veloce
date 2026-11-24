import { describe, expect, it } from "vitest";
import { createSlide, element, frame } from "../builders.js";
import type { ApplyContext } from "../checks.js";
import { DEFAULT_THEME } from "../default-theme.js";
import { VeloceError } from "../errors.js";
import { deepEqual } from "../json.js";
import {
  DEFAULT_THEME_MOTION,
  type MotionTokens,
  motionTokens,
  resolveEasing,
  slideMotionLevel,
  slideMotionTokens,
} from "../motion-tokens.js";
import { applyOp } from "../ops/apply.js";
import { type Op, OpSchema } from "../ops/schema.js";
import { type Animation, AnimationSchema } from "../schema/animation.js";
import type { Deck } from "../schema/deck.js";
import { MotionLevelSchema } from "../schema/motion.js";
import { type Theme, ThemeSchema } from "../schema/theme.js";
import {
  BUILTIN_THEMES,
  EMBER_THEME,
  MIDNIGHT_THEME,
  PAPER_THEME,
  STUDIO_THEME,
} from "../themes.js";
import { scheduleSlide } from "../timeline.js";
import { collectIds } from "../tree.js";
import { validateDeck } from "../validate.js";
import { deepFreeze, fixtureDeck } from "./fixtures.js";

/** Apply an op, then its inverse, and check we're back where we started. */
function roundTrip(deck: Deck, op: Op, ctx?: ApplyContext): Deck {
  const { deck: next, inverse } = applyOp(deck, OpSchema.parse(op), ctx);
  const { deck: restored } = applyOp(deepFreeze(next), inverse, ctx);
  expect(deepEqual(restored, deck)).toBe(true);
  return deepFreeze(next);
}

function failure(deck: Deck, op: Op, ctx?: ApplyContext): VeloceError {
  try {
    applyOp(deck, OpSchema.parse(op), ctx);
  } catch (error) {
    if (error instanceof VeloceError) return error;
    throw error;
  }
  throw new Error(`expected ${op.op} to fail`);
}

const fadeIn = (id: string, target: string, extra: Partial<Animation> = {}): Animation => ({
  id,
  target,
  effect: { name: "fade-in" },
  ...extra,
});
const insert = (animation: Animation, slideId = "intro", index?: number): Op => ({
  op: "animation.insert",
  slideId,
  animation,
  ...(index !== undefined && { index }),
});
const order = (deck: Deck, slide = 0) => deck.slides[slide]?.animations?.map((a) => a.id) ?? [];

/** The fixture with three animations on "intro": a1 (title), a2 (card-1), a3 (card-1-text). */
function animated(): Deck {
  let deck = fixtureDeck();
  for (const a of [fadeIn("a1", "title"), fadeIn("a2", "card-1"), fadeIn("a3", "card-1-text")]) {
    deck = applyOp(deck, OpSchema.parse(insert(a))).deck;
  }
  return deepFreeze(deck);
}

/** Shapes take a color `fill`; a number there is refused, as the shape plugin would. */
const ctx: ApplyContext = {
  validateElement: (type, props) =>
    type === "shape" && props.fill !== undefined && typeof props.fill !== "string"
      ? { ok: false, reason: "invalid-props", message: "fill: Expected a color" }
      : { ok: true },
};

describe("animation schema (D110)", () => {
  it("takes an effect or keyframe tracks, never both or neither", () => {
    expect(AnimationSchema.safeParse(fadeIn("a", "t")).success).toBe(true);
    const tracks = { id: "a", target: "t", tracks: { opacity: [{ at: 0, value: 0 }] } };
    expect(AnimationSchema.safeParse(tracks).success).toBe(true);
    const both = AnimationSchema.safeParse({ ...tracks, effect: { name: "fade-in" } });
    expect(both.error?.issues[0]?.message).toMatch(/not both/);
    const neither = AnimationSchema.safeParse({ id: "a", target: "t" });
    expect(neither.error?.issues[0]?.message).toMatch(/needs an "effect"/);
  });

  it("checks tracks: known channels with numbers, property paths, keyframes in time order", () => {
    const parse = (tracks: unknown) =>
      AnimationSchema.safeParse({ id: "a", target: "t", tracks }).error?.issues[0]?.message;
    expect(
      parse({ x: [{ at: 0, value: -200 }], "props.fill": [{ at: 1, value: "#f00" }] }),
    ).toBeUndefined();
    expect(parse({ opacity: [{ at: 0, value: "0" }] })).toMatch(/"opacity" is a number: 0/);
    expect(parse({ wobble: [{ at: 0, value: 1 }] })).toMatch(/motion channel.*"props.fill"/);
    expect(
      parse({
        x: [
          { at: 0.5, value: 1 },
          { at: 0.5, value: 2 },
        ],
      }),
    ).toMatch(/in time order/);
    expect(parse({})).toMatch(/at least one track/);
  });

  it("takes easing as a name, a cubic Bézier or a spring", () => {
    for (const easing of [
      "ease-out",
      { cubicBezier: [0.2, 1.4, 0.4, 1] },
      { spring: { bounce: 0.3 } },
    ]) {
      expect(AnimationSchema.safeParse(fadeIn("a", "t", { easing } as never)).success).toBe(true);
    }
    expect(AnimationSchema.safeParse(fadeIn("a", "t", { easing: "bouncy" } as never)).success).toBe(
      false,
    );
  });
});

describe("animation ops: one animation at a time, each with an exact inverse (D101 §2.1)", () => {
  it("insert, move, update and remove", () => {
    let deck = animated();
    expect(order(deck)).toEqual(["a1", "a2", "a3"]);
    deck = roundTrip(deck, insert(fadeIn("a0", "title", { trigger: "withPrevious" }), "intro", 0));
    expect(order(deck)).toEqual(["a0", "a1", "a2", "a3"]);
    deck = roundTrip(deck, { op: "animation.move", id: "a0", index: 3 });
    expect(order(deck)).toEqual(["a1", "a2", "a3", "a0"]);
    deck = roundTrip(deck, {
      op: "animation.update",
      id: "a1",
      set: { duration: 800, effect: null, tracks: { y: [{ at: 0, value: 40 }] } },
    });
    expect(deck.slides[0]?.animations?.[0]).toEqual({
      id: "a1",
      target: "title",
      duration: 800,
      tracks: { y: [{ at: 0, value: 40 }] },
    });
    deck = roundTrip(deck, { op: "animation.remove", id: "a2" });
    expect(order(deck)).toEqual(["a1", "a3", "a0"]);
  });

  it("leaves no empty list behind, and counts animation IDs in the deck's one ID space", () => {
    let deck = roundTrip(fixtureDeck(), insert(fadeIn("only", "box"), "outro"));
    expect(collectIds(deck).has("only")).toBe(true);
    deck = roundTrip(deck, { op: "animation.remove", id: "only" });
    expect(deck.slides[1]).not.toHaveProperty("animations");
    // An animation can't reuse a node's ID, nor a node an animation's.
    expect(failure(animated(), insert(fadeIn("title", "title"))).code).toBe("CONFLICT");
    const node = element("text", { content: "x" }, { id: "a1" });
    expect(failure(animated(), { op: "node.insert", parentId: "intro-root", node }).code).toBe(
      "CONFLICT",
    );
  });

  it("refuses targets that aren't a layer on the same slide, saying what to do", () => {
    const deck = animated();
    const elsewhere = failure(deck, insert(fadeIn("x", "box")));
    expect(elsewhere.message).toMatch(/targets "box", which isn't on slide "intro"/);
    expect(elsewhere.path).toBe("animation.target");
    const root = failure(deck, insert(fadeIn("x", "intro-root")));
    expect(root.message).toMatch(/root frame/);
    expect(root.hint).toMatch(/withPrevious/);
    const retarget = failure(deck, { op: "animation.update", id: "a1", set: { target: "box" } });
    expect(retarget.code).toBe("NOT_FOUND");
  });

  it("keeps the list out of slide.update and points at the right op for a wrong ID", () => {
    const deck = animated();
    const patched = failure(deck, { op: "slide.update", id: "intro", set: { animations: [] } });
    expect(patched.hint).toMatch(/animation\.insert/);
    expect(failure(deck, { op: "animation.remove", id: "title" }).hint).toMatch(
      /"title" is a node.*target is "title"/,
    );
    expect(failure(deck, { op: "animation.remove", id: "a4" }).hint).toMatch(/Did you mean/);
    expect(failure(deck, { op: "node.remove", id: "a1" }).hint).toMatch(
      /is an animation on slide "intro"/,
    );
  });

  it("checks props and style tracks against the target's own schema (golden rule 5)", () => {
    const deck = fixtureDeck();
    const color = (target: string, key: string, value: unknown) =>
      insert({ id: "c", target, tracks: { [key]: [{ at: 1, value }] } } as Animation, "outro");
    expect(() =>
      applyOp(deck, OpSchema.parse(color("box", "props.fill", "#ff0000")), ctx),
    ).not.toThrow();
    const bad = failure(deck, color("box", "props.fill", 3), ctx);
    expect(bad.message).toMatch(/"props.fill" can't be 3 on "box": fill: Expected a color/);
    expect(bad.path).toBe("animation.tracks.props.fill[0].value");
    // Frames animate their style; elements have no style, frames no props.
    const onFrame = (key: string, value: unknown) =>
      insert({ id: "f", target: "card-1", tracks: { [key]: [{ at: 1, value }] } } as Animation);
    expect(() =>
      applyOp(deck, OpSchema.parse(onFrame("style.fill", "$color.accent"))),
    ).not.toThrow();
    expect(failure(deck, onFrame("props.fill", "#fff")).hint).toMatch(/"style\.\*"/);
    expect(failure(deck, color("box", "style.fill", "#fff")).hint).toMatch(/"props\.\*"/);
  });
});

describe("removing and moving animated layers (D101 §2.3)", () => {
  it("removes a node's animations, its children's too, in the same op; undo puts them back", () => {
    const deck = animated();
    // card-1 has a2, and its child card-1-text has a3.
    const { deck: next, inverse } = applyOp(deck, { op: "node.remove", id: "card-1" });
    expect(order(next)).toEqual(["a1"]);
    expect(inverse).toMatchObject({
      op: "node.insert",
      animations: [
        { index: 1, animation: { id: "a2" } },
        { index: 2, animation: { id: "a3" } },
      ],
    });
    const { deck: restored } = applyOp(deepFreeze(next), inverse);
    expect(deepEqual(restored, deck)).toBe(true);
    // Removing the last animated layer leaves no empty list.
    const bare = applyOp(next, { op: "node.remove", id: "title" }).deck;
    expect(bare.slides[0]).not.toHaveProperty("animations");
  });

  it("puts animations back in their exact places among the others", () => {
    let deck = animated();
    deck = applyOp(deck, OpSchema.parse(insert(fadeIn("a4", "title")))).deck; // a1 a2 a3 a4
    const { deck: next, inverse } = applyOp(deck, { op: "node.remove", id: "title" });
    expect(order(next)).toEqual(["a2", "a3"]);
    expect(order(applyOp(next, inverse).deck)).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("moves an animated layer within its slide, and refuses another slide with a hint", () => {
    const deck = animated();
    roundTrip(deck, { op: "node.move", id: "card-1-text", parentId: "intro-root" });
    const away = failure(deck, { op: "node.move", id: "card-1", parentId: "outro-root" });
    expect(away.message).toMatch(/"a2", "a3" on slide "intro" animate it/);
    expect(away.hint).toMatch(/animation\.remove/);
    // Not animated: moves anywhere.
    roundTrip(deck, { op: "node.move", id: "box", parentId: "intro-root" });
  });

  it("carries a slide's animations with slide.insert and slide.remove", () => {
    const slide = createSlide({
      id: "new",
      rootId: "new-root",
      children: [frame({ id: "n1" })],
      animations: [fadeIn("n-a", "n1")],
    });
    const deck = roundTrip(animated(), { op: "slide.insert", slide });
    roundTrip(deck, { op: "slide.remove", id: "new" });
    const dangling = createSlide({
      id: "bad",
      rootId: "bad-root",
      animations: [fadeIn("b", "nope")],
    });
    expect(failure(animated(), { op: "slide.insert", slide: dangling }).path).toBe(
      "slide.animations[0].target",
    );
  });
});

describe("whole decks with animations", () => {
  it("reports dangling targets and IDs used twice", () => {
    const deck = animated();
    const intro = deck.slides[0];
    if (!intro) throw new Error("no slide");
    const broken = {
      ...deck,
      slides: [
        { ...intro, animations: [fadeIn("a1", "ghost"), fadeIn("title", "title")] },
        ...deck.slides.slice(1),
      ],
    };
    const result = validateDeck(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => [e.code, e.path])).toEqual([
      ["NOT_FOUND", "slides[0].animations[0].target"],
      ["CONFLICT", "slides[0].animations[1].id"],
    ]);
    expect(validateDeck(deck).ok).toBe(true);
  });
});

describe("the schedule: steps from order and triggers, never stored (D101 §2.2)", () => {
  const at = (animations: Animation[], tokens?: MotionTokens) =>
    scheduleSlide({ animations }, tokens).map((step) => ({
      duration: step.duration,
      plays: step.animations.map((s) => `${s.animation.id}@${s.start}-${s.end}`),
    }));

  it("plays the first animations on entry and starts a step on every click", () => {
    expect(scheduleSlide({})).toEqual([{ animations: [], duration: 0 }]);
    expect(
      at([
        fadeIn("intro", "t", { trigger: "withPrevious" }),
        fadeIn("c1", "t"),
        fadeIn("w", "t", { trigger: "withPrevious", delay: 100 }),
        fadeIn("after", "t", { trigger: "afterPrevious", duration: 200 }),
        fadeIn("c2", "t", { delay: 50, duration: 1000 }),
      ]),
    ).toEqual([
      // No duration: "$motion.normal", 400 ms in Veloce's own motion at "subtle".
      { duration: 400, plays: ["intro@0-400"] },
      { duration: 700, plays: ["c1@0-400", "w@100-500", "after@500-700"] },
      { duration: 1050, plays: ["c2@50-1050"] },
    ]);
  });

  it("counts repeats, and forever as one play so what follows still starts", () => {
    expect(
      at([
        fadeIn("twice", "t", { repeat: 2, duration: 300 }),
        fadeIn("loop", "t", { trigger: "afterPrevious", repeat: "forever", duration: 400 }),
        fadeIn("next", "t", { trigger: "afterPrevious" }),
      ]),
    ).toEqual([
      { duration: 0, plays: [] },
      { duration: 1400, plays: ["twice@0-600", "loop@600-1000", "next@1000-1400"] },
    ]);
    expect(
      scheduleSlide({ animations: [fadeIn("f", "t", { repeat: "forever" })] })[1]?.animations[0]
        ?.forever,
    ).toBe(true);
  });
});

describe("motion levels and $motion tokens (D111)", () => {
  const schedule = (animations: Animation[], tokens: MotionTokens) =>
    scheduleSlide({ animations }, tokens)
      .flatMap((step) => step.animations)
      .map((s) => `${s.animation.id}@${s.start}-${s.end}`);

  it("plays tokens at the theme's values, scaled by the level; explicit ms never scale", () => {
    const animations = [
      fadeIn("a", "t", { duration: "$motion.slow" }),
      fadeIn("b", "t", { trigger: "afterPrevious", delay: "$motion.stagger" }),
      fadeIn("c", "t", { trigger: "afterPrevious", duration: 300 }),
    ];
    // Midnight is slow and smooth: slow 900, normal 550, stagger 120.
    expect(schedule(animations, motionTokens(MIDNIGHT_THEME))).toEqual([
      "a@0-900",
      "b@1020-1570",
      "c@1570-1870",
    ]);
    // Calm takes 1.25× as long and staggers 1.5× wider; absurd is 0.7× and 0.4×.
    expect(schedule(animations, motionTokens(MIDNIGHT_THEME, "calm"))).toEqual([
      "a@0-1125",
      "b@1305-1993",
      "c@1993-2293",
    ]);
    expect(schedule(animations, motionTokens(MIDNIGHT_THEME, "absurd"))).toEqual([
      "a@0-630",
      "b@678-1063",
      "c@1063-1363",
    ]);
  });

  it("scales spring bounce with the level: calm never bounces, nothing passes 1", () => {
    expect(motionTokens(EMBER_THEME).enter).toEqual({ spring: { bounce: 0.3 } });
    expect(motionTokens(EMBER_THEME, "calm").enter).toEqual({ spring: {} });
    expect(motionTokens(EMBER_THEME, "absurd").enter).toEqual({ spring: { bounce: 0.6 } });
    const wild = { motion: { ...DEFAULT_THEME_MOTION, move: { spring: { bounce: 0.8 } } } };
    expect(motionTokens(wild, "absurd").move).toEqual({ spring: { bounce: 1 } });
    // Curves aren't springs: unchanged at every level.
    expect(motionTokens(MIDNIGHT_THEME, "absurd").enter).toEqual(MIDNIGHT_THEME.motion?.enter);
    expect(resolveEasing("$motion.exit", motionTokens(PAPER_THEME))).toBe("ease-in");
    expect(resolveEasing("linear", motionTokens(PAPER_THEME))).toBe("linear");
  });

  it("moves a slide at its own level, else the deck's, else subtle; themes without motion use Veloce's", () => {
    expect(slideMotionLevel({}, {})).toBe("subtle");
    expect(slideMotionLevel({ motionLevel: "intense" }, {})).toBe("intense");
    expect(slideMotionLevel({ motionLevel: "intense" }, { motionLevel: "calm" })).toBe("calm");
    const { motion: _, ...old } = DEFAULT_THEME;
    expect(motionTokens(old as Theme).normal).toBe(DEFAULT_THEME_MOTION.normal);
    expect(slideMotionTokens({ theme: STUDIO_THEME, motionLevel: "lively" }, {})).toMatchObject({
      level: "lively",
      normal: 288, // Studio's crisp 320 at 0.9×
      distance: 1.6,
    });
  });

  it("checks levels and tokens, with errors that list the valid ones", () => {
    const bad = (extra: Partial<Record<string, unknown>>) =>
      AnimationSchema.safeParse({ ...fadeIn("a", "t"), ...extra }).error?.issues[0]?.message;
    expect(bad({ duration: "$motion.fast" })).toBeUndefined();
    expect(bad({ easing: "$motion.move" })).toBeUndefined();
    expect(bad({ duration: "$motion.quick" })).toMatch(/"\$motion.fast", "\$motion.normal"/);
    expect(bad({ easing: "$motion.bounce" })).toMatch(/"\$motion.enter"/);
    expect(MotionLevelSchema.safeParse("wild").error?.issues[0]?.message).toMatch(
      /"calm", "subtle", "lively", "intense", "absurd"/,
    );
    for (const theme of Object.values(BUILTIN_THEMES)) {
      expect(ThemeSchema.safeParse(theme).success).toBe(true);
      expect(theme.motion).toBeDefined();
    }
  });

  it("sets the deck's level with one undoable op, and a slide's with slide.update", () => {
    let deck = roundTrip(fixtureDeck(), { op: "deck.setMotionLevel", level: "absurd" });
    expect(deck.motionLevel).toBe("absurd");
    deck = roundTrip(deck, { op: "deck.setMotionLevel", level: null });
    expect(deck).not.toHaveProperty("motionLevel");
    deck = roundTrip(deck, { op: "slide.update", id: "outro", set: { motionLevel: "calm" } });
    expect(deck.slides[1]?.motionLevel).toBe("calm");
    expect(validateDeck(deck).ok).toBe(true);
  });
});
