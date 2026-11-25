/**
 * Saved animation presets (D119): kept in the deck by ops with exact inverses, played by name
 * like a built-in effect, checked as what they stand for, and never removed from under the
 * animations that play them.
 */
import { describe, expect, it } from "vitest";
import type { ApplyContext } from "../checks.js";
import { VeloceError } from "../errors.js";
import { compileSlide, type EffectResolver } from "../evaluate.js";
import { deepEqual } from "../json.js";
import { applyOp } from "../ops/apply.js";
import { type Op, OpSchema } from "../ops/schema.js";
import {
  clearOverridesPatch,
  expandAnimation,
  inlinePresetOps,
  presetFromAnimation,
  presetOverrides,
  presetUses,
} from "../presets.js";
import type { Animation } from "../schema/animation.js";
import type { Deck } from "../schema/deck.js";
import { type Preset, PresetNameSchema } from "../schema/preset.js";
import { validateDeck } from "../validate.js";
import { restoreOps } from "../versions.js";
import { deepFreeze, fixtureDeck } from "./fixtures.js";

/** Knows "fade-in" (any `distance`), "slide-in" and "type" (text only), like a registry. */
const INSTALLED = new Set(["fade-in", "slide-in", "type"]);
const ctx: ApplyContext = {
  hasEffect: (name) => INSTALLED.has(name),
  validateEffect: (effect, target) => {
    if (!INSTALLED.has(effect.name)) {
      return { ok: false, reason: "unknown-effect", message: `Unknown effect "${effect.name}"` };
    }
    if (
      effect.name === "type" &&
      target &&
      !(target.kind === "element" && target.type === "text")
    ) {
      return { ok: false, reason: "wrong-target", message: '"type" plays on text elements' };
    }
    const bad = Object.keys(effect.params ?? {}).find((k) => k !== "distance");
    return bad
      ? { ok: false, reason: "invalid-params", message: `${bad}: not a param` }
      : { ok: true };
  },
};

/** Moves `opacity` from 0 over `distance` ms (default 300), so params show in the frames. */
const effects: EffectResolver = (effect) =>
  INSTALLED.has(effect.name)
    ? {
        tracks: { opacity: [{ at: 0, value: 0 }] },
        duration: Number(effect.params?.distance ?? 300),
        easing: "linear",
      }
    : null;

function apply(deck: Deck, ...ops: Op[]): Deck {
  let next = deck;
  for (const op of ops) next = deepFreeze(applyOp(next, OpSchema.parse(op), ctx).deck);
  return next;
}

/** Apply an op, then its inverse, and check we're back where we started. */
function roundTrip(deck: Deck, op: Op): Deck {
  const { deck: next, inverse } = applyOp(deck, OpSchema.parse(op), ctx);
  const { deck: restored } = applyOp(deepFreeze(next), inverse, ctx);
  expect(deepEqual(restored, deck)).toBe(true);
  return deepFreeze(next);
}

function failure(deck: Deck, op: Op): VeloceError {
  try {
    applyOp(deck, OpSchema.parse(op), ctx);
  } catch (error) {
    if (error instanceof VeloceError) return error;
    throw error;
  }
  throw new Error(`expected ${op.op} to fail`);
}

const save = (name: string, preset: Preset): Op => ({ op: "preset.save", name, preset });
const use = (id: string, target: string, extra: Partial<Animation> = {}): Op => ({
  op: "animation.insert",
  slideId: "intro",
  animation: { id, target, trigger: "withPrevious", effect: { name: "big-fade" }, ...extra },
});

const BIG_FADE: Preset = {
  title: "Big fade",
  effect: { name: "fade-in", params: { distance: 500 } },
  repeat: 2,
};

describe("saving and removing presets (D119)", () => {
  it("saves, replaces and removes one, each with an exact inverse", () => {
    let deck = roundTrip(fixtureDeck(), save("big-fade", BIG_FADE));
    expect(deck.presets).toEqual({ "big-fade": BIG_FADE });
    deck = roundTrip(deck, save("big-fade", { ...BIG_FADE, repeat: 3 }));
    expect(deck.presets?.["big-fade"]?.repeat).toBe(3);
    deck = roundTrip(deck, { op: "preset.remove", name: "big-fade" });
    expect(deck).not.toHaveProperty("presets"); // none left: the field goes
    expect(validateDeck(deck, ctx).ok).toBe(true);
  });

  it("takes lowercase names like the built-ins' and refuses an installed effect's", () => {
    expect(PresetNameSchema.safeParse("big-bounce-2").success).toBe(true);
    for (const bad of ["Big bounce", "acme.sparkle", "-x", "a--b"]) {
      expect(PresetNameSchema.safeParse(bad).success).toBe(false);
    }
    const taken = failure(fixtureDeck(), save("fade-in", BIG_FADE));
    expect([taken.code, taken.path]).toEqual(["CONFLICT", "name"]);
    expect(taken.hint).toContain('"my-fade-in"');
  });

  it("builds on an installed effect with valid settings, never another preset", () => {
    const unknown = failure(fixtureDeck(), save("x", { effect: { name: "fade-inn" } }));
    expect([unknown.code, unknown.path]).toEqual(["NOT_FOUND", "preset.effect.name"]);
    const params = failure(
      fixtureDeck(),
      save("x", { effect: { name: "fade-in", params: { speed: 2 } } }),
    );
    expect([params.code, params.path]).toEqual(["INVALID", "preset.effect.params"]);
    const deck = apply(fixtureDeck(), save("big-fade", BIG_FADE));
    const nested = failure(deck, save("bigger", { effect: { name: "big-fade" } }));
    expect(nested.hint).toBe(
      '"big-fade" is a preset too. A preset builds on an installed effect: use what "big-fade" plays ("fade-in").',
    );
  });

  it("refuses to remove one that animations play, and shows how to give them a copy", () => {
    const deck = apply(fixtureDeck(), save("big-fade", BIG_FADE), use("a1", "title"));
    const error = failure(deck, { op: "preset.remove", name: "big-fade" });
    expect([error.code, error.message]).toEqual([
      "FORBIDDEN",
      'Preset "big-fade" is still played by "a1"',
    ]);
    expect(error.hint).toContain(
      '"set": {"repeat":2,"effect":{"name":"fade-in","params":{"distance":500}}}',
    );
    const missing = failure(deck, { op: "preset.remove", name: "big-fad" });
    expect([missing.code, missing.hint]).toEqual(["NOT_FOUND", 'Did you mean "big-fade"?']);
  });
});

describe("playing a preset by name (D119)", () => {
  it("expands to its effect, settings merged, the animation's own timing winning", () => {
    const presets = { "big-fade": BIG_FADE };
    const animation: Animation = {
      id: "a",
      target: "t",
      delay: 100,
      repeat: 1,
      effect: { name: "big-fade", params: { extra: true } },
    };
    expect(expandAnimation(animation, presets)).toEqual({
      id: "a",
      target: "t",
      delay: 100,
      repeat: 1,
      effect: { name: "fade-in", params: { distance: 500, extra: true } },
    });
    const plain: Animation = { id: "b", target: "t", effect: { name: "fade-in" } };
    expect(expandAnimation(plain, presets)).toBe(plain);
  });

  it("plays exactly as the same animation written out in full", () => {
    const deck = apply(fixtureDeck(), save("big-fade", BIG_FADE), use("a1", "title"));
    const written = apply(fixtureDeck(), {
      op: "animation.insert",
      slideId: "intro",
      animation: {
        id: "a1",
        target: "title",
        trigger: "withPrevious",
        repeat: 2,
        effect: { name: "fade-in", params: { distance: 500 } },
      },
    });
    const frames = (d: Deck) => {
      const compiled = compileSlide(d, d.slides[0] as Deck["slides"][number], { effects });
      return [0, 250, 600, 999].map((time) => compiled.at({ time, clicks: [] }));
    };
    expect(frames(deck)).toEqual(frames(written));
    expect(frames(deck)[1]?.get("title")?.motion.opacity).toBe(0.5); // 500 ms, from the preset
  });

  it("changes every animation that plays it when it's replaced", () => {
    let deck = apply(fixtureDeck(), save("big-fade", BIG_FADE), use("a1", "title"));
    const step = (d: Deck) =>
      compileSlide(d, d.slides[0] as Deck["slides"][number], { effects }).steps[0]?.duration;
    expect(step(deck)).toBe(1000); // 500 ms × 2
    deck = apply(deck, save("big-fade", { ...BIG_FADE, repeat: 4 }));
    expect(step(deck)).toBe(2000);
  });

  it("is checked as what it stands for, on the layer that plays it", () => {
    const typer: Preset = { effect: { name: "type" }, duration: 900 };
    const deck = apply(
      fixtureDeck(),
      save("typer", typer),
      use("a1", "title", { effect: { name: "typer" } }),
    );
    const onFrame = failure(deck, use("a2", "card-1", { effect: { name: "typer" } }));
    expect([onFrame.path, onFrame.message]).toEqual([
      "animation.effect.name",
      'Animation "a2": "type" plays on text elements (in preset "typer")',
    ]);
    const params = failure(
      deck,
      use("a2", "card-1-text", { effect: { name: "typer", params: { speed: 1 } } }),
    );
    expect(params.path).toBe("animation.effect.params");
  });

  it("refuses a change that no longer suits a layer that plays it", () => {
    const deck = apply(fixtureDeck(), save("big-fade", BIG_FADE), use("a1", "card-1"));
    const error = failure(deck, save("big-fade", { effect: { name: "type" } }));
    expect(error.message).toContain('"type" plays on text elements');
    expect(error.hint).toContain('Animation "a1" on slide "intro" plays "big-fade"');
  });

  it("gives keyframe presets no settings, but lets the animation retime them", () => {
    const wiggle: Preset = { tracks: { rotate: [{ at: 0.5, value: 5 }] }, duration: 300 };
    const deck = apply(fixtureDeck(), save("wiggle", wiggle));
    const error = failure(
      deck,
      use("a1", "title", { effect: { name: "wiggle", params: { distance: 1 } } }),
    );
    expect([error.path, error.hint]).toEqual([
      "animation.effect.params",
      "Remove effect.params. Its timing (duration, easing, repeat) can still be set on the animation.",
    ]);
    const retimed = apply(deck, use("a1", "title", { effect: { name: "wiggle" }, duration: 600 }));
    const a1 = retimed.slides[0]?.animations?.[0] as Animation;
    expect(expandAnimation(a1, retimed.presets)).toMatchObject({
      duration: 600,
      tracks: wiggle.tracks,
    });
  });

  it("wins over an installed effect of the same name in a file: it means what it meant", () => {
    const deck: Deck = {
      ...fixtureDeck(),
      presets: { "fade-in": { effect: { name: "slide-in" } } },
    };
    expect(validateDeck(deck, ctx).ok).toBe(true);
    const animation: Animation = { id: "a", target: "title", effect: { name: "fade-in" } };
    expect(expandAnimation(animation, deck.presets).effect?.name).toBe("slide-in");
  });

  it("opens a file whose preset's plugin isn't installed, with a warning", () => {
    const deck: Deck = {
      ...fixtureDeck(),
      presets: { sparkly: { effect: { name: "acme.sparkle" } } },
    };
    const result = validateDeck(deck, ctx);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.path)).toEqual(["presets.sparkly.effect.name"]);
  });
});

describe("making, inlining and restoring presets (D119)", () => {
  it("makes one from a tuned animation: how it moves, never when", () => {
    const tuned: Animation = {
      id: "a",
      target: "title",
      trigger: "afterPrevious",
      delay: 200,
      duration: "$motion.slow",
      easing: "$motion.move",
      effect: { name: "fade-in", params: { distance: 80 } },
    };
    expect(
      presetFromAnimation(tuned, undefined, { title: " Slow fade ", description: "" }),
    ).toEqual({
      title: "Slow fade",
      effect: { name: "fade-in", params: { distance: 80 } },
      duration: "$motion.slow",
      easing: "$motion.move",
    });
    // From an animation that plays a preset: what it plays, its own changes folded in.
    const over: Animation = { id: "b", target: "t", duration: 100, effect: { name: "big-fade" } };
    expect(presetFromAnimation(over, { "big-fade": BIG_FADE })).toEqual({
      effect: { name: "fade-in", params: { distance: 500 } },
      duration: 100,
      repeat: 2,
    });
    expect(presetOverrides(over)).toEqual(["duration"]);
    expect(clearOverridesPatch(over)).toEqual({ duration: null });
  });

  it("gives every use its own copy, so removing the preset changes nothing on screen", () => {
    const deck = apply(
      fixtureDeck(),
      save("big-fade", BIG_FADE),
      use("a1", "title"),
      use("a2", "card-1", { repeat: 5, effect: { name: "big-fade", params: { distance: 50 } } }),
    );
    const inlined = apply(deck, ...inlinePresetOps(deck, "big-fade"), {
      op: "preset.remove",
      name: "big-fade",
    });
    expect(inlined).not.toHaveProperty("presets");
    expect(presetUses(inlined, "big-fade")).toEqual([]);
    expect(inlined.slides[0]?.animations?.[1]).toEqual({
      id: "a2",
      target: "card-1",
      trigger: "withPrevious",
      repeat: 5,
      effect: { name: "fade-in", params: { distance: 50 } },
    });
    const frames = (d: Deck) => {
      const compiled = compileSlide(d, d.slides[0] as Deck["slides"][number], { effects });
      return [0, 100, 400, 2500].map((time) => compiled.at({ time, clicks: [] }));
    };
    expect(frames(inlined)).toEqual(frames(deck));
  });

  it("inlines keyframe presets as tracks", () => {
    const wiggle: Preset = { tracks: { rotate: [{ at: 0.5, value: 5 }] }, easing: "ease" };
    const deck = apply(
      fixtureDeck(),
      save("wiggle", wiggle),
      use("a1", "title", { effect: { name: "wiggle" } }),
    );
    const inlined = apply(deck, ...inlinePresetOps(deck, "wiggle"));
    expect(inlined.slides[0]?.animations?.[0]).toEqual({
      id: "a1",
      target: "title",
      trigger: "withPrevious",
      easing: "ease",
      tracks: wiggle.tracks,
    });
  });

  it("restores a version's presets with its slides", () => {
    const saved = apply(fixtureDeck(), save("big-fade", BIG_FADE), use("a1", "title"));
    const now = apply(
      saved,
      ...inlinePresetOps(saved, "big-fade"),
      { op: "preset.remove", name: "big-fade" },
      save("other", { effect: { name: "slide-in" } }),
    );
    const restored = apply(now, ...restoreOps(now, saved));
    expect(restored.presets).toEqual(saved.presets);
    expect(restored.slides).toEqual(saved.slides);
  });
});
