import { createBuiltinRegistry } from "@veloce/builtins";
import {
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  element,
  MIDNIGHT_THEME,
  type Slide,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import {
  morphGliders,
  setTransitionType,
  shownTransition,
  transitionEverywhere,
  tuneTransition,
} from "./transition.js";

const registry = createBuiltinRegistry();

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

const logo = (id: string) => element("shape", { shape: "rect" }, { id, matchKey: "logo" });
const deck = {
  ...createDeck({
    title: "t",
    slides: [
      createSlide({ id: "a", children: [logo("a-logo")] }),
      createSlide({ id: "b", children: [logo("b-logo")] }),
    ],
  }),
  theme: MIDNIGHT_THEME, // signature: zoom
};
function slide(d: Deck, id = "b"): Slide {
  const found = d.slides.find((s) => s.id === id);
  if (!found) throw new Error(`no slide ${id}`);
  return found;
}

describe("the Transition section (D123)", () => {
  it("shows the theme's until the slide picks its own, and goes back to it", () => {
    expect(shownTransition(deck, slide(deck))).toMatchObject({ own: null, type: "zoom" });
    const pushed = apply(deck, setTransitionType(slide(deck), "push"));
    expect(slide(pushed).transition).toEqual({ type: "push" });
    const tuned = apply(pushed, tuneTransition(pushed, slide(pushed), { direction: "up" }));
    // Another type drops the push's direction (only a push has one) and keeps the rest.
    const faded = apply(tuned, setTransitionType(slide(tuned), "fade"));
    expect(slide(faded).transition).toEqual({ type: "fade" });
    const back = apply(faded, setTransitionType(slide(faded), null));
    expect(slide(back).transition).toBeUndefined();
  });

  it("tuning the theme's starts the slide's own from it", () => {
    const tuned = apply(deck, tuneTransition(deck, slide(deck), { duration: 1200 }));
    expect(slide(tuned).transition).toEqual({ type: "zoom", duration: 1200 });
    expect(shownTransition(tuned, slide(tuned)).tunedDuration).toBe(1200);
    // Reset: back to the theme's pace (Midnight's is $motion.slow), not a jump elsewhere.
    const reset = apply(tuned, tuneTransition(tuned, slide(tuned), { duration: null }));
    expect(slide(reset).transition).toEqual({ type: "zoom", duration: "$motion.slow" });
    expect(shownTransition(reset, slide(reset)).tunedDuration).toBeUndefined();
  });

  it("puts one slide's transition on every slide, in one step", () => {
    const morphed = apply(deck, setTransitionType(slide(deck), "morph"));
    const all = apply(morphed, transitionEverywhere(morphed, slide(morphed)));
    expect(all.slides.map((s) => s.transition)).toEqual([{ type: "morph" }, { type: "morph" }]);
    expect(transitionEverywhere(all, slide(all))).toBeNull(); // nothing left to change
  });

  it("counts the layers a morph glides in from the slide before", () => {
    expect(morphGliders(deck, slide(deck))).toBe(1);
    expect(morphGliders(deck, slide(deck, "a"))).toBeNull();
  });
});
