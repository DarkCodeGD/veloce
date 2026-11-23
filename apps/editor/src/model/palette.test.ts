import { createDeck, createSlide, element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { deckLayers, type PaletteEntry, paletteSections, slideLabel } from "./palette.js";

const entry = (kind: PaletteEntry["kind"], label: string, detail?: string): PaletteEntry => ({
  id: `${kind}:${label}`,
  kind,
  label,
  ...(detail && { detail }),
});

const ENTRIES = [
  entry("command", "Undo", "Edit"),
  entry("command", "Align left", "Arrange"),
  entry("command", "Align right", "Arrange"),
  entry("command", "Zoom in", "View"),
  entry("setting", "Snapping", "Preferences"),
  entry("slide", "Slide 1: Welcome"),
  entry("slide", "Slide 2: Results"),
  entry("layer", "Results chart", "Slide 2"),
];
const titles = (sections: ReturnType<typeof paletteSections>) =>
  sections.map((s) => [s.title, s.items.map((i) => i.label)]);

describe("the command palette's list (D92)", () => {
  it("shows recent commands, then every command, before anything is typed", () => {
    expect(titles(paletteSections(ENTRIES, " ", ["command:Zoom in", "command:Gone"]))).toEqual([
      ["Recent", ["Zoom in"]],
      ["Commands", ["Undo", "Align left", "Align right", "Zoom in"]],
    ]);
  });

  it("finds anything by the starts of its words, grouped by kind", () => {
    expect(titles(paletteSections(ENTRIES, "al le", []))).toEqual([["Commands", ["Align left"]]]);
    // The best match leads: a layer named "Results…" before "Slide 2: Results".
    expect(titles(paletteSections(ENTRIES, "results", []))).toEqual([
      ["Layers", ["Results chart"]],
      ["Slides", ["Slide 2: Results"]],
    ]);
    // By its context: the menu, Preferences, a slide number.
    expect(titles(paletteSections(ENTRIES, "arrange", []))).toEqual([
      ["Commands", ["Align left", "Align right"]],
    ]);
    expect(titles(paletteSections(ENTRIES, "pref", []))).toEqual([["Settings", ["Snapping"]]]);
    expect(titles(paletteSections(ENTRIES, "2", []))).toEqual([
      ["Slides", ["Slide 2: Results"]],
      ["Layers", ["Results chart"]],
    ]);
    expect(paletteSections(ENTRIES, "nothing like it", [])).toEqual([]);
  });

  it("lists commands that can't run now after the ones that can", () => {
    const entries = [
      { ...entry("command", "Align left", "Arrange"), disabled: true },
      entry("command", "Align to slide", "Arrange"),
    ];
    expect(titles(paletteSections(entries, "align", []))).toEqual([
      ["Commands", ["Align to slide", "Align left"]],
    ]);
    expect(paletteSections(entries, "", [])[0]?.items.map((e) => e.label)).toEqual([
      "Align to slide",
      "Align left",
    ]);
  });

  it("ranks the best matches first, whatever their kind", () => {
    const entries = [
      entry("command", "Zoom to 100%", "View"),
      entry("command", "Preferences…", "File"),
      { ...entry("setting", "Snapping", "Preferences"), keywords: "snap" },
      entry("slide", "Slide 1: Welcome"),
      entry("layer", "Café menu", "Slide 1"),
    ];
    // "Preferences…" matches "snap" nowhere in its label: the setting leads.
    entries[1] = { ...(entries[1] as PaletteEntry), keywords: "settings snapping" };
    expect(titles(paletteSections(entries, "snapping", []))).toEqual([
      ["Settings", ["Snapping"]],
      ["Commands", ["Preferences…"]],
    ]);
    // A whole word ("1") beats the start of one ("100").
    expect(titles(paletteSections(entries, "1", []))[0]).toEqual(["Slides", ["Slide 1: Welcome"]]);
    // Any script's letters are word letters.
    expect(titles(paletteSections(entries, "café", []))).toEqual([["Layers", ["Café menu"]]]);
  });

  it("keeps only the best few of a kind", () => {
    const many = Array.from({ length: 50 }, (_, i) => entry("layer", `Box ${i}`, "Slide 1"));
    expect(paletteSections(many, "box", [])[0]?.items).toHaveLength(12);
  });

  it("names slides by their name or first text, and lists every layer of every slide", () => {
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s1",
          children: [
            frame({
              id: "card",
              name: "Card",
              children: [element("text", { content: "Inside" }, { id: "in" })],
            }),
            element("text", { content: "  Our results  " }, { id: "t" }),
          ],
        }),
        createSlide({ id: "s2", name: "Thanks", children: [] }),
        createSlide({ id: "s3", children: [] }),
      ],
    });
    const [s1, s2, s3] = deck.slides;
    expect(s1 && slideLabel(s1, 0)).toBe("Slide 1: Inside");
    expect(s2 && slideLabel(s2, 1)).toBe("Slide 2: Thanks");
    expect(s3 && slideLabel(s3, 2)).toBe("Slide 3");
    expect(deckLayers(deck).map((l) => `${l.slideIndex}:${l.node.id}`)).toEqual([
      "0:card",
      "0:in",
      "0:t",
    ]);
  });
});

describe("components in the palette (D94)", () => {
  it("come before an equally good layer match", () => {
    const sections = paletteSections(
      [
        { id: "layer:s1/card", kind: "layer", label: "Feature card", detail: "Slide 1" },
        { id: "component:Feature card", kind: "component", label: "Feature card" },
      ],
      "feature",
      [],
    );
    expect(sections.map((s) => s.title)).toEqual(["Components", "Layers"]);
  });
});
