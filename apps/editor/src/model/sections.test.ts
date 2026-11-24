import {
  applyTransaction,
  createDeck,
  createSlide,
  type Deck,
  deckSections,
  type Slide,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Command } from "./commands.js";
import {
  addSectionCommand,
  deleteSlideCommand,
  moveSectionCommand,
  moveSlideBy,
  moveSlideToSlot,
  removeSectionCommand,
  renameSectionCommand,
  sectionOf,
} from "./sections.js";

/** a | Intro: b c | Results: d e */
function deck(): Deck {
  const slide = (id: string, section?: string): Slide =>
    createSlide({ id, ...(section && { section }) });
  return createDeck({
    title: "Sections",
    slides: [slide("a"), slide("b", "Intro"), slide("c"), slide("d", "Results"), slide("e")],
  });
}

/** The deck after `command`, as "a | Intro: b c | …". */
function after(d: Deck, command: Command | null): string {
  if (!command) return "no change";
  const result = applyTransaction(d, { origin: "user", label: command.label, ops: command.ops });
  if (!result.ok) throw new Error(result.error.message);
  return shape(result.deck);
}

const shape = (d: Deck) =>
  deckSections(d)
    .map((s) => (s.name === null ? s.slideIds.join(" ") : `${s.name}: ${s.slideIds.join(" ")}`))
    .join(" | ");

describe("sections in the editor (D97)", () => {
  it("reads the deck", () => {
    expect(shape(deck())).toBe("a | Intro: b c | Results: d e");
    expect(sectionOf(deck().slides, "c")?.name).toBe("Intro");
    expect(sectionOf(deck().slides, "a")?.name).toBeNull();
  });

  it("moves a slide inside its section, then across the edge without changing places", () => {
    const d = deck();
    const up = moveSlideBy(d.slides, "c", -1);
    expect(up?.label).toBe("Move slide 3 to position 2");
    expect(after(d, up)).toBe("a | Intro: c b | Results: d e"); // c starts Intro now
    expect(after(d, moveSlideBy(d.slides, "b", -1))).toBe("a b | Intro: c | Results: d e");
    expect(moveSlideBy(d.slides, "b", -1)?.label).toBe("Move slide 2 to no section");
    expect(after(d, moveSlideBy(d.slides, "c", 1))).toBe("a | Intro: b | Results: c d e");
    expect(moveSlideBy(d.slides, "c", 1)?.ops).toEqual([
      { op: "slide.update", id: "c", set: { section: "Results" } },
      { op: "slide.update", id: "d", set: { section: null } },
    ]);
    expect(moveSlideBy(d.slides, "a", -1)).toBeNull();
    expect(moveSlideBy(d.slides, "e", 1)).toBeNull();
  });

  it("drops the section a move leaves empty", () => {
    const d = deck();
    const once = applyTransaction(d, {
      origin: "user",
      label: "x",
      ops: moveSlideBy(d.slides, "b", -1)?.ops ?? [],
    });
    if (!once.ok) throw new Error(once.error.message);
    expect(after(once.deck, moveSlideBy(once.deck.slides, "c", -1))).toBe("a b c | Results: d e");
  });

  it("drops a dragged slide where the rail shows it: between slides or under a header", () => {
    const d = deck();
    expect(after(d, moveSlideToSlot(d.slides, "e", { key: "b", index: 0 }))).toBe(
      "a | Intro: e b c | Results: d",
    );
    expect(after(d, moveSlideToSlot(d.slides, "b", { key: "b", index: 2 }))).toBe(
      "a | Intro: c b | Results: d e",
    );
    expect(after(d, moveSlideToSlot(d.slides, "d", { key: "a", index: 1 }))).toBe(
      "a d | Intro: b c | Results: e",
    );
    expect(moveSlideToSlot(d.slides, "e", { key: "d", index: 2 })).toBeNull(); // where it is
    expect(moveSlideToSlot(d.slides, "e", { key: "zz", index: 0 })).toBeNull();
  });

  it("keeps a section when its first slide is deleted", () => {
    const d = deck();
    const slide = d.slides[1] as Slide;
    expect(after(d, deleteSlideCommand(d.slides, slide))).toBe("a | Intro: c | Results: d e");
    expect(after(d, deleteSlideCommand(d.slides, d.slides[0] as Slide))).toBe(
      "Intro: b c | Results: d e",
    );
  });

  it("adds, renames and removes sections", () => {
    const d = deck();
    const c = d.slides[2] as Slide;
    expect(addSectionCommand(c, "Deep dive").label).toBe('Add section "Deep dive"');
    expect(after(d, addSectionCommand(c, "Deep dive"))).toBe(
      "a | Intro: b | Deep dive: c | Results: d e",
    );
    expect(renameSectionCommand(d.slides, "b", "Hello")?.label).toBe(
      'Rename section "Intro" to "Hello"',
    );
    expect(renameSectionCommand(d.slides, "b", "Intro")).toBeNull();
    expect(renameSectionCommand(d.slides, "c", "Nope")).toBeNull(); // c starts no section
    expect(after(d, removeSectionCommand(d.slides, "d"))).toBe("a | Intro: b c d e");
  });

  it("moves whole sections, never above the slides before the first one", () => {
    const d = deck();
    expect(after(d, moveSectionCommand(d.slides, "d", -1))).toBe("a | Results: d e | Intro: b c");
    expect(after(d, moveSectionCommand(d.slides, "b", 1))).toBe("a | Results: d e | Intro: b c");
    expect(moveSectionCommand(d.slides, "b", -1)).toBeNull();
    expect(moveSectionCommand(d.slides, "d", 1)).toBeNull();
    expect(moveSectionCommand(d.slides, "a", 1)).toBeNull(); // not a section
  });
});
