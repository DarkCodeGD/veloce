import { describe, expect, it } from "vitest";
import { createDeck } from "../builders.js";
import { DEFAULT_THEME } from "../default-theme.js";
import { formatIssues, parseOrThrow, VeloceError } from "../errors.js";
import { DeckSchema } from "../schema/deck.js";
import { isFreeLayer, NodeSchema } from "../schema/node.js";
import { PaintSchema } from "../schema/paint.js";
import { RichTextSchema, toParagraphs, toPlainText } from "../schema/rich-text.js";
import { ThemeSchema } from "../schema/theme.js";
import { fixtureDeck } from "./fixtures.js";

function errorOf(schema: Parameters<typeof parseOrThrow>[0], value: unknown): VeloceError {
  try {
    parseOrThrow(schema, value);
  } catch (error) {
    if (error instanceof VeloceError) return error;
    throw error;
  }
  throw new Error("expected parse to fail");
}

describe("document schema", () => {
  it("accepts decks made by the builders and the default theme", () => {
    expect(DeckSchema.safeParse(fixtureDeck()).success).toBe(true);
    expect(DeckSchema.safeParse(createDeck({ title: "Empty" })).success).toBe(true);
    expect(ThemeSchema.safeParse(DEFAULT_THEME).success).toBe(true);
  });

  it("rejects unknown keys so typos are caught (e.g. `colour`)", () => {
    const err = errorOf(NodeSchema, {
      id: "x",
      kind: "frame",
      layout: { mode: "stack", colour: "red" },
      children: [],
    });
    expect(err.message).toMatch(/layout/);
    expect(err.message).toMatch(/colour/);
  });

  it("gives friendly messages for common value unions", () => {
    const err = errorOf(NodeSchema, {
      id: "x",
      kind: "element",
      type: "text",
      props: {},
      width: "wide",
    });
    expect(err.message).toBe(
      'width: Expected a size in pixels, "hug" (fit content) or "fill" (use available space)',
    );
    expect(err.path).toBe("width");
  });

  it("reports the branch the caller meant inside a paint union", () => {
    const result = PaintSchema.safeParse({ type: "linear-gradient", angle: 90 });
    expect(result.success).toBe(false);
    if (!result.success) expect(formatIssues(result.error.issues)).toMatch(/^stops:/);
  });

  it("accepts conic (angular) gradients with tokens at an opacity", () => {
    const conic = {
      type: "conic-gradient",
      angle: 90,
      center: { x: 0.5, y: 0.25 },
      stops: [
        { offset: 0, color: "$color.primary" },
        { offset: 0.5, color: "$color.accent/40" },
        { offset: 1, color: "$color.primary" },
      ],
    };
    expect(PaintSchema.safeParse(conic).success).toBe(true);
    const oneStop = { ...conic, stops: conic.stops.slice(0, 1) };
    const result = PaintSchema.safeParse(oneStop);
    expect(result.success).toBe(false);
    if (!result.success) expect(formatIssues(result.error.issues)).toMatch(/^stops:/);
  });

  it("validates theme font references", () => {
    const bad = {
      ...DEFAULT_THEME,
      text: { h1: { font: "nope", size: 10, weight: 400, lineHeight: 1 } },
    };
    const err = errorOf(ThemeSchema, bad);
    expect(err.message).toMatch(/text\.h1\.font: Unknown font "nope"/);
  });

  it("knows which layers are placed by their own position", () => {
    const stack = { mode: "stack" } as const;
    const absolute = { mode: "absolute" } as const;
    expect(isFreeLayer({}, stack)).toBe(false);
    expect(isFreeLayer({ positioning: "auto" }, stack)).toBe(false);
    expect(isFreeLayer({ positioning: "free" }, stack)).toBe(true);
    expect(isFreeLayer({ positioning: "free" }, { mode: "grid", columns: 2 })).toBe(true);
    expect(isFreeLayer({}, absolute)).toBe(true);
    expect(isFreeLayer({ positioning: "free" }, null)).toBe(false); // the root fills the stage
    const node = { id: "x", kind: "element", type: "text", props: {}, positioning: "floating" };
    expect(errorOf(NodeSchema, node).path).toBe("positioning");
  });

  it("only allows web and mail links in rich text (no javascript: URLs)", () => {
    const withLink = (link: string) => [{ runs: [{ text: "hi", link }] }];
    expect(RichTextSchema.safeParse(withLink("javascript:alert(1)")).success).toBe(false);
    expect(RichTextSchema.safeParse(withLink("https://veloce.dev")).success).toBe(true);
    expect(RichTextSchema.safeParse(withLink("mailto:hi@veloce.dev")).success).toBe(true);
  });
});

describe("text content helpers", () => {
  it("normalizes plain strings into paragraphs and back", () => {
    expect(toParagraphs("a\n\nb")).toEqual([
      { runs: [{ text: "a" }] },
      { runs: [] },
      { runs: [{ text: "b" }] },
    ]);
    expect(toPlainText(toParagraphs("a\nb"))).toBe("a\nb");
  });
});
