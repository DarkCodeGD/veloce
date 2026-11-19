import { describe, expect, it } from "vitest";
import { createDeck, createSlide, type ElementOptions, element, frame } from "../builders.js";
import { type LintIssue, lintDeck } from "../lint.js";
import {
  contrastRatio,
  flattenLayers,
  type NodeMeasurement,
  parseCssColor,
  type SlideMeasurement,
  toRgbString,
} from "../measure.js";
import { ThemeSchema } from "../schema/theme.js";
import { applyChange, ClientMessageSchema } from "../sync.js";
import { BUILTIN_THEMES, findBuiltinTheme } from "../themes.js";
import { resolveToken } from "../tokens.js";
import { applyTransaction } from "../transaction.js";

const text = (id: string, content: string, options: ElementOptions = {}) =>
  element("text", { content }, { id, ...options });

function measured(slideId: string, nodes: Record<string, NodeMeasurement>): SlideMeasurement {
  return { slideId, stage: { width: 1920, height: 1080 }, nodes };
}

const box = (x: number, y: number, width: number, height: number) => ({
  bounds: { x, y, width, height },
});

const rules = (issues: LintIssue[]) => issues.map((i) => `${i.rule}:${i.nodeIds.join("+")}`);

describe("color math", () => {
  it("parses the formats browsers report", () => {
    expect(parseCssColor("rgb(17, 19, 24)")).toEqual([17, 19, 24, 1]);
    expect(parseCssColor("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(parseCssColor("rgb(255 0 0 / 50%)")).toEqual([255, 0, 0, 0.5]);
    expect(parseCssColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseCssColor("#00000080")).toEqual([0, 0, 0, 128 / 255]);
    expect(parseCssColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(parseCssColor("linear-gradient(red, blue)")).toBeNull();
    expect(parseCssColor("rgb(nope)")).toBeNull();
    // What Chromium reports for color-mix(), i.e. a theme color at an opacity.
    expect(parseCssColor("color(srgb 1 0.5 0 / 0.3)")).toEqual([255, 127.5, 0, 0.3]);
    expect(parseCssColor("color(srgb 0 0 0)")).toEqual([0, 0, 0, 1]);
    expect(parseCssColor("color(display-p3 1 0 0)")).toBeNull(); // another color space
  });

  it("computes WCAG contrast and composites translucent layers", () => {
    const white = parseCssColor("#ffffff");
    const black = parseCssColor("#000000");
    if (!white || !black) throw new Error("parse failed");
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBe(1);
    // 50% black over white = mid grey
    expect(toRgbString(flattenLayers([[0, 0, 0, 0.5]]))).toBe("rgb(128, 128, 128)");
  });
});

describe("built-in themes", () => {
  it("are valid, share the documented token vocabulary, and keep their key pairs readable", () => {
    const vocabulary = Object.keys(BUILTIN_THEMES.light?.colors ?? {}).sort();
    for (const [id, theme] of Object.entries(BUILTIN_THEMES)) {
      expect(ThemeSchema.safeParse(theme).success, id).toBe(true);
      expect(Object.keys(theme.colors).sort(), id).toEqual(vocabulary);
      const color = (name: string) => parseCssColor(String(resolveToken(theme, `$color.${name}`)));
      const [primary, onPrimary, text, muted, background, surface] = [
        color("primary"),
        color("on-primary"),
        color("text"),
        color("muted"),
        color("background"),
        color("surface"),
      ];
      if (!primary || !onPrimary || !text || !muted || !background || !surface)
        throw new Error(`${id}: bad colors`);
      // Pairs agents reach for first: these must never trip the low-contrast rule.
      expect(contrastRatio(primary, onPrimary), `${id} on-primary`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(text, background), `${id} text`).toBeGreaterThanOrEqual(7);
      for (const [name, fg] of [
        ["primary", primary],
        ["muted", muted],
      ] as const) {
        expect(contrastRatio(fg, background), `${id} ${name} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(fg, surface), `${id} ${name} on surface`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(findBuiltinTheme("DARK")?.name).toBe("Veloce Dark");
    expect(findBuiltinTheme("Midnight")?.name).toBe("Midnight");
    expect(findBuiltinTheme("nope")).toBeUndefined();
  });
});

describe("lint: structural rules", () => {
  it("flags empty slides, walls of text and bad alt text", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({ id: "empty", children: [text("ghost", "boo", { hidden: true })] }),
        createSlide({
          id: "wordy",
          children: [
            text("t1", long),
            text("t2", long),
            element("image", { asset: "x", alt: "IMG_2041.jpg" }, { id: "img" }),
            element("image", { asset: "x", alt: "" }, { id: "deco" }),
          ],
        }),
      ],
    });
    expect(rules(lintDeck(deck))).toEqual([
      "empty-slide:",
      "too-much-text:t1",
      "too-much-text:t2",
      "alt-text:img",
      "too-much-text:t1+t2",
      "alt-text:deco",
    ]);
    expect(rules(lintDeck(deck, { slideIds: ["empty"] }))).toEqual(["empty-slide:"]);
  });

  it("treats a hidden frame as hiding its whole subtree", () => {
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s",
          children: [frame({ id: "f", hidden: true, children: [text("in", "hello")] })],
        }),
      ],
    });
    expect(rules(lintDeck(deck))).toEqual(["empty-slide:"]);
  });
});

describe("lint: ignored positions", () => {
  it("flags a position its stack or grid ignores, but not free layers or absolute children", () => {
    const at = { x: 40, y: 80 };
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s",
          children: [
            text("stale", "in the flow", { position: at }),
            text("free", "on top", { position: at, positioning: "free" }),
            frame({
              id: "grid",
              layout: { mode: "grid", columns: 2 },
              children: [text("cell", "x", { position: at })],
            }),
            frame({
              id: "abs",
              layout: { mode: "absolute" },
              children: [text("placed", "y", { position: at })],
            }),
          ],
        }),
      ],
    });
    const issues = lintDeck(deck).filter((i) => i.rule === "ignored-position");
    expect(issues.map((i) => i.nodeIds.join())).toEqual(["stale", "cell"]);
    expect(issues[0]?.message).toMatch(/frame is a stack/);
    expect(issues[0]?.fix).toMatch(/positioning: "free"/);
  });

  it("flags an anchor on a layer the flow places", () => {
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s",
          children: [
            text("flow", "in the flow", { anchor: { x: "end" } }),
            text("pinned", "badge", {
              positioning: "free",
              anchor: { x: "end" },
              position: { x: 16, y: 16 },
            }),
          ],
        }),
      ],
    });
    const issues = lintDeck(deck).filter((i) => i.rule === "ignored-position");
    expect(issues.map((i) => i.nodeIds.join())).toEqual(["flow"]);
    expect(issues[0]?.message).toMatch(/anchor is ignored/);
  });
});

describe("lint: ignored padding", () => {
  it("flags padding on a free frame, whose children are placed from its edges", () => {
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s",
          children: [
            frame({ id: "board", layout: { mode: "absolute", padding: 20 } }),
            frame({ id: "plain", layout: { mode: "absolute" } }),
            frame({ id: "card", layout: { mode: "stack", padding: 20 } }),
          ],
        }),
      ],
    });
    const issues = lintDeck(deck).filter((i) => i.rule === "ignored-padding");
    expect(issues.map((i) => i.nodeIds.join())).toEqual(["board"]);
    expect(issues[0]?.fix).toMatch(/Remove the padding/);
  });
});

describe("lint: theme tokens", () => {
  it("flags token references the theme doesn't define, with suggestions", () => {
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s",
          rootId: "root",
          background: "$color.backgrund",
          layout: { mode: "stack", gap: "$space.huge" },
          children: [
            element("text", { content: "x", color: "$color.primary/40" }, { id: "ok" }),
            element("text", { content: "y", color: "$color.primarry/40" }, { id: "typo" }),
          ],
        }),
      ],
    });
    const issues = lintDeck(deck);
    expect(rules(issues)).toEqual(["unknown-token:", "unknown-token:root", "unknown-token:typo"]);
    // A color at an opacity is checked as its token.
    expect(issues[2]?.fix).toBe('Did you mean "$color.primary"?');
    expect(issues[0]?.fix).toBe('Did you mean "$color.background"?');
    expect(issues[1]?.message).toMatch(/"\$space\.huge"/);
    expect(issues[1]?.fix).toMatch(/^Use one of: "\$space\.xs", /);
  });
});

describe("lint: visual rules (with measurements)", () => {
  const deck = createDeck({
    title: "t",
    slides: [
      createSlide({
        id: "s",
        rootId: "root",
        children: [
          frame({ id: "card", children: [text("body", "Hello")] }),
          text("a", "A"),
          text("b", "B"),
          text("far", "Far"),
          text("edge", "Edge"),
          element("shape", { shape: "rect" }, { id: "bg" }),
        ],
      }),
    ],
  });

  it("reports the innermost overflow, off-canvas, overlaps, contrast and tiny text", () => {
    const m = measured("s", {
      root: { ...box(0, 0, 1920, 1080), overflow: { x: 0, y: 140 } },
      card: { ...box(100, 100, 400, 200), overflow: { x: 0, y: 40 } },
      body: { ...box(100, 100, 400, 200), overflow: { x: 0, y: 40 } },
      a: {
        ...box(600, 100, 400, 100),
        text: [
          {
            color: "rgb(170, 170, 170)",
            background: "rgb(255, 255, 255)",
            fontSize: 32,
            fontWeight: 400,
          },
        ],
      },
      b: {
        ...box(700, 150, 400, 100),
        text: [{ color: "rgb(0, 0, 0)", background: null, fontSize: 14, fontWeight: 400 }],
      },
      far: box(2500, 100, 100, 100),
      edge: box(1850, 1000, 200, 100),
      bg: box(600, 100, 600, 300), // a shape: never counted as overlapping
    });
    const issues = lintDeck(deck, { measurements: new Map([["s", m]]) });
    expect(rules(issues)).toEqual([
      "overflow:body", // innermost only: not "card", and not the root (it has an overflowing descendant)
      "off-canvas:far",
      "off-canvas:edge",
      "overlap:a+b",
      "low-contrast:a",
      "small-text:b",
    ]);
    expect(issues.find((i) => i.rule === "low-contrast")?.message).toMatch(
      /2\.\d+:1 \(needs 4\.5:1\)/,
    );
    expect(issues.every((i) => i.fix.length > 10)).toBe(true);
  });

  it("reports slide-level overflow when only the root overflows", () => {
    const m = measured("s", { root: { ...box(0, 0, 1920, 1080), overflow: { x: 0, y: 90 } } });
    const [issue] = lintDeck(deck, { measurements: new Map([["s", m]]) });
    expect(issue?.message).toBe(
      "Slide \"s\" content doesn't fit: it's 90px too tall for the slide.",
    );
  });

  it("mentions a large empty band (info), measuring elements rather than fill frames", () => {
    const lint = (nodes: Record<string, NodeMeasurement>) =>
      lintDeck(deck, { measurements: new Map([["s", measured("s", nodes)]]) }).filter(
        (i) => i.rule === "empty-space",
      );
    // Content in the top 40% of the slide; the card frame spans the slide but doesn't count.
    const [bunched] = lint({
      card: box(0, 0, 1920, 1080),
      a: box(96, 96, 800, 120),
      b: box(96, 260, 800, 160),
    });
    expect(bunched).toMatchObject({ severity: "info", nodeIds: ["root"] });
    expect(bunched?.message).toBe('The bottom 61% of slide "s" is empty.');
    // Centered content (empty bands of ~30% above and below) is balanced.
    expect(lint({ a: box(96, 330, 800, 200), b: box(96, 560, 800, 190) })).toEqual([]);
  });

  it("leaves a centred short slide alone, and ignores free layers when measuring bands", () => {
    const titled = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s",
          rootId: "root",
          children: [
            text("title", "Title"),
            text("tag", "v2", { positioning: "free", position: { x: 1800, y: 1040 } }),
          ],
        }),
      ],
    });
    const lint = (nodes: Record<string, NodeMeasurement>) =>
      lintDeck(titled, { measurements: new Map([["s", measured("s", nodes)]]) });
    // A short title, centred: 46% empty above and below. Balanced, so no issue.
    expect(lint({ title: box(96, 497, 1600, 86) }).map((i) => i.rule)).not.toContain("empty-space");
    // Content at the top with a tiny free label at the bottom: the label doesn't fill the gap.
    const issues = lint({ title: box(96, 96, 1600, 86), tag: box(1800, 1040, 60, 30) });
    expect(issues.find((i) => i.rule === "empty-space")?.message).toMatch(/bottom 83%/);
  });

  it("gives free-layer overlaps advice that fits them", () => {
    const badged = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s",
          rootId: "root",
          children: [
            text("name", "Pro"),
            text("badge", "New", { positioning: "free", position: { x: 300, y: 0 } }),
          ],
        }),
      ],
    });
    const m = measured("s", { name: box(96, 96, 1600, 60), badge: box(400, 96, 120, 40) });
    const overlap = lintDeck(badged, { measurements: new Map([["s", m]]) }).find(
      (i) => i.rule === "overlap",
    );
    expect(overlap?.fix).toMatch(/width: "hug"/);
  });

  it("uses the large-text threshold (3:1) for big text", () => {
    const sample = { color: "rgb(130, 130, 130)", background: "#ffffff", fontWeight: 400 };
    const lint = (fontSize: number) =>
      lintDeck(deck, {
        measurements: new Map([
          ["s", measured("s", { a: { ...box(0, 0, 10, 10), text: [{ ...sample, fontSize }] } })],
        ]),
      }).map((i) => i.rule);
    expect(lint(32)).toContain("low-contrast"); // 3.9:1 < 4.5
    expect(lint(80)).not.toContain("low-contrast"); // 3.9:1 ≥ 3 for large text
  });
});

describe("sync", () => {
  it("validates client messages", () => {
    expect(ClientMessageSchema.safeParse({ type: "open", deckId: "dk_1" }).success).toBe(true);
    expect(
      ClientMessageSchema.safeParse({
        type: "transaction",
        requestId: "r",
        deckId: "d",
        label: "x",
        ops: [],
        origin: "agent:x",
      }).success,
    ).toBe(false); // empty ops, and clients can't send an origin
  });

  it("replays server changes on a replica, and asks for a snapshot on gaps", () => {
    const deck = createDeck({ title: "t", slides: [createSlide({ id: "s", rootId: "root" })] });
    const ops = [{ op: "node.insert" as const, parentId: "root", node: text("hi", "Hi") }];
    const server = applyTransaction(deck, { origin: "agent:test", label: "add", ops });
    if (!server.ok) throw new Error(server.error.message);
    const change = {
      type: "change" as const,
      deckId: deck.id,
      version: 1,
      origin: "agent:test" as const,
      label: "add",
      ops,
      at: 0,
    };
    const replica = applyChange({ deck, version: 0 }, change);
    expect(replica?.deck).toEqual(server.deck);
    expect(replica?.version).toBe(1);
    expect(applyChange({ deck, version: 1 }, change)).toBeNull(); // out of order
    expect(
      applyChange({ deck, version: 0 }, { ...change, ops: [{ op: "node.remove", id: "nope" }] }),
    ).toBeNull();
  });
});
