/** Slide numbers, footers and sections (D97). */
import { describe, expect, it } from "vitest";
import { createSlide } from "../builders.js";
import { instantiateSlide } from "../components.js";
import {
  deckSections,
  FOOTER_ID,
  fieldValues,
  footerNode,
  formatDate,
  hasFieldRuns,
  isFooterId,
  runText,
  sameFieldValues,
  sectionAt,
  showsFooter,
} from "../fields.js";
import { ID_PATTERN } from "../ids.js";
import { BUILTIN_LAYOUTS } from "../layouts.js";
import { SlideSchema } from "../schema/deck.js";
import { TextRunSchema } from "../schema/rich-text.js";
import { applyTransaction } from "../transaction.js";
import { walkNodes } from "../tree.js";
import { restoreOps } from "../versions.js";
import { fixtureDeck } from "./fixtures.js";

const NOW = new Date(2026, 10, 24, 12);

/** Slides a…e; b and d start sections. */
function sectioned() {
  const deck = fixtureDeck();
  const slide = (id: string, section?: string) => createSlide({ id, ...(section && { section }) });
  return {
    ...deck,
    slides: [slide("a"), slide("b", "Intro"), slide("c"), slide("d", "Results"), slide("e")],
  };
}

function apply(deck: ReturnType<typeof fixtureDeck>, ops: unknown[]) {
  const result = applyTransaction(deck, { origin: "user", label: "Test", ops });
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("sections", () => {
  it("run from a slide that starts one to the next", () => {
    expect(deckSections(sectioned())).toEqual([
      { name: null, key: "a", start: 0, slideIds: ["a"] },
      { name: "Intro", key: "b", start: 1, slideIds: ["b", "c"] },
      { name: "Results", key: "d", start: 3, slideIds: ["d", "e"] },
    ]);
    expect(deckSections({ slides: [] })).toEqual([]);
    expect([0, 1, 2, 3, 4].map((i) => sectionAt(sectioned(), i))).toEqual([
      null,
      "Intro",
      "Intro",
      "Results",
      "Results",
    ]);
  });

  it("are one line of text, set and cleared with slide.update", () => {
    expect(SlideSchema.shape.section.safeParse("Q3 results").success).toBe(true);
    for (const bad of ["", " Padded", "Two\nlines", "x".repeat(101)]) {
      expect(SlideSchema.shape.section.safeParse(bad).success).toBe(false);
    }
    const deck = fixtureDeck();
    const set = apply(deck, [{ op: "slide.update", id: "outro", set: { section: "End" } }]);
    expect(set.deck.slides[1]?.section).toBe("End");
    const undone = apply(set.deck, set.inverse);
    expect(undone.deck.slides[1]).not.toHaveProperty("section");
  });
});

describe("fields", () => {
  it("are text runs whose value the slide decides", () => {
    expect(TextRunSchema.safeParse({ text: "", field: "slideNumber" }).success).toBe(true);
    expect(TextRunSchema.safeParse({ text: "", field: "page" }).success).toBe(false);
    const deck = { ...sectioned(), meta: { title: "Q3 review" } };
    expect(fieldValues(deck, 2, NOW)).toEqual({
      slideNumber: "3",
      slideCount: "5",
      date: formatDate(NOW),
      deckTitle: "Q3 review",
      section: "Intro",
    });
    expect(fieldValues(deck, 0, NOW).section).toBe(""); // before the first section
  });

  it("show their value, or the text they were written with when there's none", () => {
    const values = fieldValues(sectioned(), 0, NOW);
    expect(runText({ text: "7", field: "slideNumber" }, values)).toBe("1");
    expect(runText({ text: "7", field: "slideNumber" }, null)).toBe("7");
    expect(runText({ text: "Plain" }, values)).toBe("Plain");
  });

  it("format the date in the deck's language, even a made-up one", () => {
    expect(formatDate(NOW, "en-US")).toBe("November 24, 2026");
    expect(formatDate(NOW, "de")).toBe("24. November 2026");
    expect(formatDate(NOW, "not a tag!")).toBe(formatDate(NOW)); // falls back, doesn't throw
  });

  it("compare by value, and are found anywhere in an element's props", () => {
    const a = fieldValues(sectioned(), 1, NOW);
    expect(sameFieldValues(a, { ...a })).toBe(true);
    expect(sameFieldValues(a, { ...a, slideNumber: "9" })).toBe(false);
    expect(sameFieldValues(null, a)).toBe(false);

    const content = [{ runs: [{ text: "Slide " }, { text: "", field: "slideNumber" }] }];
    expect(hasFieldRuns({ content })).toBe(true);
    expect(hasFieldRuns({ content: "Slide 3" })).toBe(false);
    // A plugin's own "field" key that isn't a run (a chart's data field) is no field run.
    expect(hasFieldRuns({ series: [{ field: "revenue" }] })).toBe(false);
  });
});

describe("the footer", () => {
  it("is set and removed with deck.setFooter, undoably", () => {
    const deck = fixtureDeck();
    const footer = { text: "Acme · Confidential", slideNumber: true };
    const set = apply(deck, [{ op: "deck.setFooter", footer }]);
    expect(set.deck.footer).toEqual(footer);
    expect(set.inverse).toEqual([{ op: "deck.setFooter", footer: null }]);
    const removed = apply(set.deck, [{ op: "deck.setFooter", footer: null }]);
    expect(removed.deck).not.toHaveProperty("footer");
    expect(apply(removed.deck, removed.inverse).deck.footer).toEqual(footer);
    expect(
      applyTransaction(deck, {
        origin: "user",
        label: "Bad",
        ops: [{ op: "deck.setFooter", footer: { pageNumbers: true } }],
      }).ok,
    ).toBe(false);
  });

  it("is drawn as nodes the deck can't have: date left, text centered, number right", () => {
    const deck = { ...fixtureDeck(), footer: { text: "Acme", slideNumber: true, date: true } };
    const slide = deck.slides[0];
    if (!slide) throw new Error("no slide");
    const node = footerNode(deck, slide);
    expect(node?.id).toBe(FOOTER_ID);
    const ids = [...walkNodes(node ?? slide.root)].map((n) => n.node.id);
    expect(ids.every(isFooterId)).toBe(true);
    expect(ids.some((id) => ID_PATTERN.test(id))).toBe(false);
    const texts = [...walkNodes(node ?? slide.root)].flatMap(({ node: n }) =>
      n.kind === "element" ? [n.props] : [],
    );
    expect(texts.map((p) => [p.align, (p.content as { runs: unknown[] }[])[0]?.runs])).toEqual([
      ["left", [{ text: "", field: "date" }]],
      ["center", [{ text: "Acme" }]],
      ["right", [{ text: "", field: "slideNumber" }]],
    ]);
  });

  it("is left off slides that hide it, and when it shows nothing", () => {
    const slide = createSlide({ id: "s" });
    expect(showsFooter({ footer: { slideNumber: true } }, slide)).toBe(true);
    expect(showsFooter({ footer: { slideNumber: true } }, { ...slide, hideFooter: true })).toBe(
      false,
    );
    expect(showsFooter({ footer: { text: "", slideNumber: false } }, slide)).toBe(false);
    expect(footerNode({}, slide)).toBeNull();
  });

  it("stays off title and section header slides made from the built-in layouts", () => {
    const made = (name: string) => {
      const layout = BUILTIN_LAYOUTS[name];
      if (!layout) throw new Error(name);
      return instantiateSlide(name, layout, "s9");
    };
    expect(made("Title").hideFooter).toBe(true);
    expect(made("Section header").hideFooter).toBe(true);
    expect(made("Title and content")).not.toHaveProperty("hideFooter");
  });

  it("comes back with a version, and only changes when it differs", () => {
    const saved = { ...fixtureDeck(), footer: { slideNumber: true } };
    const now = fixtureDeck();
    const result = apply(now, restoreOps(now, saved));
    expect(result.deck.footer).toEqual({ slideNumber: true });
    expect(restoreOps(saved, saved).map((op) => op.op)).not.toContain("deck.setFooter");
  });
});
