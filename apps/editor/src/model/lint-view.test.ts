import {
  createDeck,
  createSlide,
  element,
  frame,
  type LintIssue,
  lintDeck,
  type SlideMeasurement,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  humanizeMessage,
  issueCounts,
  layerSeverities,
  slideBadges,
  viewIssues,
} from "./lint-view.js";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

/** s1: an overflowing tagline and a long text, bunched at the top; s2: empty; s3: an image
 * whose alt text is its file name. */
const deck = createDeck({
  title: "t",
  slides: [
    createSlide({
      id: "s1",
      name: "Intro",
      children: [
        element("text", { content: "Our tagline" }, { id: "nd_tag" }),
        element("text", { content: words(60) }, { id: "nd_long", name: "Body" }),
        frame({ id: "nd_card", children: [] }),
      ],
    }),
    createSlide({ id: "s2" }),
    createSlide({
      id: "s3",
      children: [
        element(
          "image",
          { asset: `asset:${"0".repeat(64)}`, alt: "IMG_0042.jpg" },
          { id: "nd_img" },
        ),
      ],
    }),
  ],
});

/** What a renderer would report: the tagline spills 64px out of its box. */
const measurements = new Map<string, SlideMeasurement>([
  [
    "s1",
    {
      slideId: "s1",
      stage: deck.stage,
      nodes: {
        nd_tag: { bounds: { x: 100, y: 100, width: 800, height: 100 }, overflow: { x: 0, y: 64 } },
        nd_long: { bounds: { x: 100, y: 220, width: 800, height: 150 } },
        nd_card: { bounds: { x: 100, y: 380, width: 800, height: 50 } },
      },
    },
  ],
]);
const issues = lintDeck(deck, { measurements });

describe("Issues panel wording (D73)", () => {
  it("rewrites core's agent wording with names, titles and inspector words", () => {
    const groups = viewIssues(deck, issues);
    expect(groups.map((g) => [g.slideId, g.number, g.worst])).toEqual([
      ["s1", 1, "error"],
      ["s2", 2, "warning"],
      ["s3", 3, "warning"],
    ]);
    const overflow = groups[0]?.issues.find((i) => i.rule === "overflow");
    expect(overflow).toMatchObject({
      title: "Text doesn't fit",
      detail: 'Text "Our tagline" content is 64px too tall for its box.',
      hint: expect.stringContaining("Hug content"),
      nodeIds: ["nd_tag"],
    });
    const long = groups[0]?.issues.find((i) => i.rule === "too-much-text");
    expect(long?.detail).toBe('Text "Body" has 60 words (aim for under 50).');
    expect(groups[1]?.issues[0]).toMatchObject({
      title: "Empty slide",
      detail: "This slide has no visible content.",
      nodeIds: [],
    });
    expect(groups[2]?.issues[0]?.title).toBe("No image description");
    // Nothing agent-only leaks through: no IDs, no prop syntax.
    const text = JSON.stringify(
      groups.map((g) => g.issues.map((i) => [i.title, i.detail, i.hint])),
    );
    expect(text).not.toMatch(/nd_|"s\d"|hug"|render_preview|\$text\./);
  });

  it("hides tips unless asked, worst first within a slide", () => {
    const tips = issues.filter((i) => i.severity === "info");
    expect(tips.length).toBeGreaterThan(0); // empty-space under the short content
    const shown = viewIssues(deck, issues).flatMap((g) => g.issues);
    expect(shown.some((i) => i.severity === "info")).toBe(false);
    const all = viewIssues(deck, issues, { showTips: true });
    const s1 = all[0]?.issues.map((i) => i.severity) ?? [];
    expect(s1).toEqual(
      [...s1].sort(
        (a, b) => ["error", "warning", "info"].indexOf(a) - ["error", "warning", "info"].indexOf(b),
      ),
    );
    expect(all[0]?.issues.at(-1)?.title).toBe("Unbalanced layout");
  });

  it("counts, badges slides and marks layers (tips don't badge)", () => {
    expect(issueCounts(issues)).toMatchObject({ error: 1, warning: 3 });
    expect(Object.fromEntries(slideBadges(issues))).toEqual({
      s1: { count: 2, worst: "error" },
      s2: { count: 1, worst: "warning" },
      s3: { count: 1, worst: "warning" },
    });
    expect(Object.fromEntries(layerSeverities(issues, "s1"))).toEqual({
      nd_tag: "error",
      nd_long: "warning",
    });
  });

  it("names unnamed frames by their kind, and leaves unknown IDs and other quotes alone", () => {
    expect(
      humanizeMessage('frame "nd_card": its children are 10px too tall for it.', deck, "s1"),
    ).toBe("A frame: its children are 10px too tall for it.");
    expect(humanizeMessage('The bottom 41% of slide "s1" is empty.', deck, "s1")).toBe(
      "The bottom 41% of the slide is empty.",
    );
    expect(
      humanizeMessage(
        'text "gone" uses "$color.x", which the theme "Midnight" doesn\'t define.',
        deck,
        "s1",
      ),
    ).toBe('Text "gone" uses "$color.x", which the theme "Midnight" doesn\'t define.');
  });

  it("drops issues on slides that are gone, and falls back to core's text for new rules", () => {
    const future = {
      rule: "fancy-rule",
      severity: "warning",
      slideId: "s1",
      nodeIds: [],
      message: "Odd.",
      fix: "Do X.",
    } as unknown as LintIssue;
    const stale: LintIssue = { ...future, rule: "empty-slide", slideId: "gone" };
    const view = viewIssues(deck, [future, stale]);
    expect(view).toHaveLength(1);
    expect(view[0]?.issues[0]).toMatchObject({
      title: "Fancy rule",
      detail: "Odd.",
      hint: "Do X.",
    });
  });
});
