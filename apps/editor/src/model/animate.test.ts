import { createBuiltinRegistry } from "@veloce/builtins";
import {
  type Animation,
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  motionTokens,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  addEffect,
  changeEffect,
  effectGallery,
  galleryPreview,
  moveAnimation,
  removeLayerAnimations,
  SPEEDS,
  setEffectParam,
  setMotionLevel,
  setTrigger,
  soloAnimations,
  speedLabel,
  stepsList,
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
