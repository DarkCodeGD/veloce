import { createBuiltinRegistry } from "@veloce/builtins";
import {
  type Animation,
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  expandAnimation,
  frame,
  motionTokens,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  addEffect,
  changeEffect,
  deletePreset,
  describeWithPresets,
  effectGallery,
  galleryPreview,
  moveAnimation,
  presetName,
  removeLayerAnimations,
  SPEEDS,
  savedPresets,
  savePreset,
  setEffectParam,
  setMotionLevel,
  setSpace,
  setStagger,
  setStaggerGap,
  setTrigger,
  soloAnimations,
  spaceChoice,
  speedLabel,
  stepsList,
  updatePreset,
} from "./animate.js";
import type { Command } from "./commands.js";
import { indexSlide } from "./slide-index.js";

const registry = createBuiltinRegistry();
const effects = registry.describeEffects();
const describe_ = (name: string) => registry.describeEffect(name);
const effect = (name: string) => {
  const found = describe_(name);
  if (!found) throw new Error(name);
  return found;
};

const title = element("text", { content: "Q3 results" }, { id: "title", name: "Title" });
const box = element("shape", { shape: "rect" }, { id: "box" });

function deckWith(animations: Animation[] = []): Deck {
  return createDeck({
    title: "t",
    slides: [createSlide({ id: "s", children: [title, box], animations })],
  });
}

/** Applies a command like the server would, with the real plugins' checks. */
function apply(deck: Deck, command: Command | null): Deck {
  if (!command) throw new Error("no command");
  const result = applyTransaction(
    deck,
    { origin: "user", label: command.label, ops: command.ops },
    registry.applyContext(),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.deck;
}
const slideOf = (deck: Deck) => deck.slides[0] as NonNullable<Deck["slides"][0]>;

describe("the effect gallery (D118)", () => {
  it("groups effects as PowerPoint does: entrance, emphasis, exit", () => {
    const groups = effectGallery(effects, [title]);
    expect(groups.map((g) => g.title)).toEqual(["Entrance", "Emphasis", "Exit"]);
    expect(groups[0]?.effects.map((e) => e.name)).toContain("typewriter");
  });

  it("offers only what suits every selected layer: no typewriter on a shape", () => {
    const names = effectGallery(effects, [title, box]).flatMap((g) => g.effects.map((e) => e.name));
    expect(names).toContain("fade-in");
    expect(names).not.toContain("typewriter");
    expect(names).not.toContain("count-up");
  });
});

describe("adding and tuning animations (D118)", () => {
  it("adds one on a click, and several selected layers move together", () => {
    const added = addEffect(slideOf(deckWith()), ["title", "box"], effect("fade-in"));
    const deck = apply(deckWith(), added?.command ?? null);
    const animations = slideOf(deck).animations ?? [];
    expect(animations.map((a) => [a.target, a.trigger, a.effect?.name])).toEqual([
      ["title", undefined, "fade-in"],
      ["box", "withPrevious", "fade-in"],
    ]);
    expect(added?.ids).toEqual(animations.map((a) => a.id));
  });

  it("puts new ones right after the animation being tuned", () => {
    const deck = deckWith([
      { id: "a1", target: "title", effect: { name: "fade-in" } },
      { id: "a2", target: "box", effect: { name: "fade-in" } },
    ]);
    const added = addEffect(slideOf(deck), ["box"], effect("pulse"), "a1");
    const next = apply(deck, added?.command ?? null);
    expect(slideOf(next).animations?.map((a) => a.id)).toEqual(["a1", added?.ids[0], "a2"]);
  });

  it("changes the effect and drops the old one's settings", () => {
    const animation: Animation = {
      id: "a1",
      target: "box",
      duration: "$motion.slow",
      effect: { name: "slide-in", params: { direction: "left" } },
    };
    const next = apply(deckWith([animation]), changeEffect(animation, effect("zoom-in")));
    expect(slideOf(next).animations?.[0]).toEqual({
      id: "a1",
      target: "box",
      duration: "$motion.slow", // timing you chose stays
      effect: { name: "zoom-in" },
    });
    expect(changeEffect(animation, effect("slide-in"))).toBeNull();
  });

  it("stores on click as no trigger, the default", () => {
    const animation: Animation = { id: "a1", target: "box", trigger: "afterPrevious" };
    expect(setTrigger(animation, "onClick")?.ops[0]).toMatchObject({ set: { trigger: null } });
    expect(setTrigger(animation, "afterPrevious")).toBeNull();
  });

  it("sets and resets one effect setting, keeping the others", () => {
    const animation: Animation = {
      id: "a1",
      target: "box",
      effect: { name: "slide-in", params: { direction: "left", fade: false } },
    };
    let deck = apply(deckWith([animation]), setEffectParam(animation, "direction", "down"));
    expect(slideOf(deck).animations?.[0]?.effect?.params).toEqual({
      direction: "down",
      fade: false,
    });
    deck = apply(deck, setEffectParam(slideOf(deck).animations?.[0] as Animation, "fade", null));
    expect(slideOf(deck).animations?.[0]?.effect?.params).toEqual({ direction: "down" });
    deck = apply(
      deck,
      setEffectParam(slideOf(deck).animations?.[0] as Animation, "direction", null),
    );
    expect(slideOf(deck).animations?.[0]?.effect).toEqual({ name: "slide-in" }); // no empty {}
    expect(setEffectParam(slideOf(deck).animations?.[0] as Animation, "fade", null)).toBeNull();
  });

  it("moves earlier and later, and not past either end", () => {
    const deck = deckWith([
      { id: "a1", target: "title" },
      { id: "a2", target: "box" },
    ]);
    const later = apply(deck, moveAnimation(slideOf(deck), "a1", 1));
    expect(slideOf(later).animations?.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(moveAnimation(slideOf(deck), "a1", -1)).toBeNull();
    expect(moveAnimation(slideOf(deck), "a2", 1)).toBeNull();
  });

  it("removes every animation of the selected layers at once", () => {
    const deck = deckWith([
      { id: "a1", target: "title" },
      { id: "a2", target: "box" },
      { id: "a3", target: "title", trigger: "withPrevious" },
    ]);
    const command = removeLayerAnimations(slideOf(deck), ["title"]);
    expect(command?.label).toBe("Remove 2 animations");
    expect(slideOf(apply(deck, command)).animations?.map((a) => a.id)).toEqual(["a2"]);
    expect(removeLayerAnimations(slideOf(deck), ["nothing"])).toBeNull();
  });

  it("stores subtle, the default level, as none", () => {
    expect(setMotionLevel("subtle").ops).toEqual([{ op: "deck.setMotionLevel", level: null }]);
    expect(apply(deckWith(), setMotionLevel("absurd")).motionLevel).toBe("absurd");
  });

  it("names speeds with their length at the level", () => {
    const fast = SPEEDS[0];
    expect(speedLabel(fast, motionTokens(undefined, "subtle"))).toBe("Fast · 200 ms");
    expect(speedLabel(fast, motionTokens(undefined, "calm"))).toMatch(/^Fast · \d+ ms$/);
  });
});

describe("the steps list (D118)", () => {
  it("groups animations by when they play, naming layers and effects", () => {
    const deck = deckWith([
      { id: "a1", target: "title", trigger: "withPrevious", effect: { name: "typewriter" } },
      { id: "a2", target: "box", effect: { name: "pop-in" } },
      { id: "a3", target: "title", trigger: "afterPrevious", effect: { name: "acme.sparkle" } },
      { id: "a4", target: "box", tracks: { x: [{ at: 0, value: 10 }] } },
    ]);
    const slide = slideOf(deck);
    const steps = stepsList(slide, indexSlide(slide), describe_);
    expect(steps.map((s) => s.title)).toEqual(["As the slide appears", "Click 1", "Click 2"]);
    expect(steps.map((s) => s.rows.map((r) => [r.layer, r.effect, r.kind, r.index]))).toEqual([
      [["Title", "Typewriter", "entrance", 0]],
      [
        ["Shape", "Pop in", "entrance", 1],
        ["Title", "acme.sparkle", "missing", 2],
      ],
      [["Shape", "Custom", "custom", 3]],
    ]);
  });

  it("leaves out an empty first step", () => {
    const deck = deckWith([{ id: "a1", target: "box", effect: { name: "fade-in" } }]);
    const slide = slideOf(deck);
    expect(stepsList(slide, indexSlide(slide), describe_).map((s) => s.title)).toEqual(["Click 1"]);
  });
});

describe("previews (D118)", () => {
  it("plays only the previewed animations, the first at once", () => {
    const deck = deckWith([
      { id: "a1", target: "title", effect: { name: "fade-in" } },
      { id: "a2", target: "box", delay: 300, effect: { name: "zoom-in" } },
    ]);
    const tuned = slideOf(deck).animations?.[1] as Animation;
    const preview = soloAnimations(deck, "s", [tuned]);
    expect(slideOf(preview).animations).toEqual([
      { id: "a2", target: "box", trigger: "withPrevious", effect: { name: "zoom-in" } },
    ]);
    expect(slideOf(deck).animations).toHaveLength(2); // the document is untouched
  });

  it("previews a hovered effect on every selected layer together", () => {
    const animations = galleryPreview(["title", "box"], effect("pop-in"));
    expect(animations.map((a) => [a.target, a.trigger, a.effect?.name])).toEqual([
      ["title", "withPrevious", "pop-in"],
      ["box", "withPrevious", "pop-in"],
    ]);
  });
});

describe("saved presets (D119)", () => {
  const tuned: Animation = {
    id: "a1",
    target: "title",
    trigger: "withPrevious",
    delay: 100,
    duration: "$motion.slow",
    repeat: 2,
    effect: { name: "slide-in", params: { direction: "left" } },
  };
  const ctx = registry.applyContext();

  it("names a preset like the built-ins, never taking an installed effect's or another's", () => {
    const taken = (n: string) => registry.hasEffect(n) || n === "big-bounce";
    expect(presetName("Big bounce!", taken)).toBe("big-bounce-2");
    expect(presetName("Crème brûlée", taken)).toBe("creme-brulee");
    expect(presetName("Fade in", taken)).toBe("fade-in-2");
    expect(presetName("2024 intro", taken)).toBe("preset-2024-intro");
    expect(presetName("🎉", taken)).toBe("preset");
  });

  it("saves the tuned animation, which then plays the preset, as one undo step", () => {
    const deck = deckWith([tuned]);
    const { command, name } = savePreset(deck, tuned, { title: "Swoop" }, registry.hasEffect);
    expect(command.ops).toHaveLength(2);
    const next = apply(deck, command);
    expect(name).toBe("swoop");
    expect(next.presets?.swoop).toEqual({
      title: "Swoop",
      effect: { name: "slide-in", params: { direction: "left" } },
      duration: "$motion.slow",
      repeat: 2,
    });
    const a1 = slideOf(next).animations?.[0] as Animation;
    // When it plays stays the animation's; how it moves is the preset's now.
    expect(a1).toEqual({
      id: "a1",
      target: "title",
      trigger: "withPrevious",
      delay: 100,
      effect: { name: "swoop" },
    });
    expect(expandAnimation(a1, next.presets)).toEqual(tuned);
  });

  it("offers presets first in the gallery, only where they fit, and names them in the steps", () => {
    const typer = { title: "Slow type", effect: { name: "typewriter" } };
    const deck = { ...deckWith([{ id: "a1", target: "title", effect: { name: "slow-type" } }]) };
    const withPreset: Deck = { ...deck, presets: { "slow-type": typer } };
    const saved = savedPresets(withPreset, slideOf(withPreset), describe_, ctx);
    expect(saved.map((p) => [p.name, p.title, p.kind])).toEqual([
      ["slow-type", "Slow type", "entrance"],
    ]);
    const onText = effectGallery(effects, [title], saved);
    expect(onText[0]?.title).toBe("Saved");
    expect(onText[0]?.effects.map((e) => e.name)).toEqual(["slow-type"]);
    expect(effectGallery(effects, [box], saved)[0]?.title).toBe("Entrance"); // no typing a shape
    const rows = stepsList(
      slideOf(withPreset),
      indexSlide(slideOf(withPreset)),
      describeWithPresets(saved, describe_),
    );
    expect(rows[0]?.rows[0]).toMatchObject({ effect: "Slow type", kind: "entrance" });
  });

  it("updates the preset from an animation's own changes, for every one that plays it", () => {
    let deck = apply(
      deckWith([tuned]),
      savePreset(deckWith([tuned]), tuned, { title: "Swoop" }, registry.hasEffect).command,
    );
    const a1 = () => slideOf(deck).animations?.[0] as Animation;
    expect(updatePreset(deck, a1())).toBeNull(); // plays it as saved: nothing to push
    deck = apply(deck, {
      label: "tune",
      ops: [
        {
          op: "animation.update",
          id: "a1",
          set: { duration: 900, effect: { params: { direction: "up" } } },
        },
      ],
    });
    deck = apply(deck, updatePreset(deck, a1()));
    expect(deck.presets?.swoop).toMatchObject({
      title: "Swoop",
      duration: 900,
      effect: { params: { direction: "up" } },
    });
    expect(a1()).toEqual({
      id: "a1",
      target: "title",
      trigger: "withPrevious",
      delay: 100,
      effect: { name: "swoop" },
    });
  });

  it("deletes a preset, its animations keeping their own copy, as one undo step", () => {
    const deck = apply(
      deckWith([tuned]),
      savePreset(deckWith([tuned]), tuned, { title: "Swoop" }, registry.hasEffect).command,
    );
    const command = deletePreset(deck, "swoop");
    expect(command?.label).toBe("Delete preset “Swoop”");
    const next = apply(deck, command);
    expect(next).not.toHaveProperty("presets");
    expect(slideOf(next).animations?.[0]).toEqual(tuned);
    expect(deletePreset(next, "swoop")).toBeNull();
  });
});

describe("layout: one by one, make room, close the gap (D120)", () => {
  const list = frame({
    id: "list",
    layout: { mode: "stack", direction: "column" },
    children: [
      element("text", { content: "One" }, { id: "one" }),
      element("text", { content: "Two" }, { id: "two" }),
    ],
  });
  const deckOf = (animations: Animation[]) =>
    createDeck({
      title: "t",
      slides: [
        createSlide({ id: "s", layout: { mode: "absolute" }, children: [list, box], animations }),
      ],
    });
  const fade = (id: string, target: string, name = "fade-in"): Animation => ({
    id,
    target,
    effect: { name },
  });

  it("offers make room to entrances and close the gap to exits, only for layers in a stack", () => {
    const deck = deckOf([fade("a1", "two"), fade("a2", "two", "fade-out"), fade("a3", "box")]);
    const index = indexSlide(slideOf(deck));
    const [a1, a2, a3] = slideOf(deck).animations ?? [];
    expect(spaceChoice(a1 as Animation, "entrance", index)).toBe("makeRoom");
    expect(spaceChoice(a2 as Animation, "exit", index)).toBe("collapse");
    expect(spaceChoice(a2 as Animation, "emphasis", index)).toBeNull();
    expect(spaceChoice(a3 as Animation, "entrance", index)).toBeNull(); // box is free
    const made = apply(deck, setSpace(a2 as Animation, "collapse"));
    expect(slideOf(made).animations?.[1]?.space).toBe("collapse");
    const again = slideOf(made).animations?.[1] as Animation;
    expect(setSpace(again, "collapse")).toBeNull();
    expect(slideOf(apply(made, setSpace(again, null))).animations?.[1]).not.toHaveProperty("space");
  });

  it("plays a frame's animation on its children one by one, and back together", () => {
    let deck = deckOf([fade("a1", "list")]);
    const a1 = () => slideOf(deck).animations?.[0] as Animation;
    deck = apply(deck, setStagger(a1(), "start"));
    expect(a1().stagger).toEqual({});
    deck = apply(deck, setStaggerGap(a1(), 120));
    deck = apply(deck, setStagger(a1(), "end"));
    expect(a1().stagger).toEqual({ each: 120, from: "end" });
    expect(stepsList(slideOf(deck), indexSlide(slideOf(deck)), describe_)[0]?.rows[0]?.effect).toBe(
      "Fade in · one by one",
    );
    deck = apply(deck, setStagger(a1(), null));
    expect(a1()).not.toHaveProperty("stagger");
  });
});
