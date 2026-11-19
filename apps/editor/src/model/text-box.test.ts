import type { Paragraph } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { samePatch, textBoxOf, textPatch, uniform } from "./text-box.js";

const p = (text: string, extra: Partial<Paragraph> = {}): Paragraph => ({
  runs: [{ text }],
  ...extra,
});

describe("textPatch: what a typing session writes to a text layer", () => {
  it("keeps plain edits plain, and changes no layer prop", () => {
    expect(textPatch([p("Hello"), p("World")], { style: "$text.body" })).toEqual({
      content: "Hello\nWorld",
    });
  });

  it("hoists a style every paragraph shares to the layer", () => {
    const patch = textPatch([p("A", { style: "$text.h1" }), p("B", { style: "$text.h1" })], {
      style: "$text.body",
    });
    expect(patch).toEqual({ content: "A\nB", style: "$text.h1" });
  });

  it("keeps a style on one paragraph, and drops one that repeats the layer's", () => {
    const patch = textPatch(
      [p("Title", { style: "$text.h2" }), p("Body", { style: "$text.body" })],
      {
        style: "$text.body",
      },
    );
    expect(patch).toEqual({
      content: [{ runs: [{ text: "Title" }], style: "$text.h2" }, p("Body")],
    });
    // No style on the layer: body is the default it's compared with.
    expect(textPatch([p("x", { style: "$text.body" }), p("y")], {})).toEqual({ content: "x\ny" });
  });

  it("clears the layer's font overrides when a hoisted style replaces them", () => {
    // A paragraph style beats the layer's fontSize, so h1 paragraphs show at h1 size; on the
    // layer, h1 must come without the old 40px override to look the same.
    const patch = textPatch([p("A", { style: "$text.h1" })], {
      style: "$text.body",
      fontSize: 40,
      fontWeight: 300,
    });
    expect(patch).toEqual({ content: "A", style: "$text.h1", fontSize: null, fontWeight: null });
  });

  it("never drops a style that differs from an overridden layer only by its overrides", () => {
    // Layer: body at 40px. A paragraph explicitly "body" shows at body's own 32px: not redundant.
    const patch = textPatch([p("A", { style: "$text.body" }), p("B")], {
      style: "$text.body",
      fontSize: 40,
    });
    expect(patch.content).toEqual([{ runs: [{ text: "A" }], style: "$text.body" }, p("B")]);
    expect(patch).not.toHaveProperty("fontSize");
  });

  it("hoists uniform alignment, removing it when it's the default", () => {
    expect(textPatch([p("A", { align: "center" }), p("B", { align: "center" })], {})).toEqual({
      content: "A\nB",
      align: "center",
    });
    // Back to left on a centered layer: the default, so the prop goes away.
    expect(textPatch([p("A", { align: "left" })], { align: "center" })).toEqual({
      content: "A",
      align: null,
    });
    // Mixed: per paragraph, minus the ones that repeat the layer.
    expect(
      textPatch([p("A", { align: "right" }), p("B", { align: "center" })], { align: "center" }),
    ).toEqual({ content: [{ runs: [{ text: "A" }], align: "right" }, p("B")] });
  });

  it("hoists a color every run shares, and drops colors that repeat the layer's", () => {
    const red = { color: "$color.danger" } as const;
    expect(
      textPatch(
        [
          {
            runs: [
              { text: "A", ...red },
              { text: "B", bold: true, ...red },
            ],
          },
          { runs: [{ text: "C", ...red }] },
        ],
        {},
      ),
    ).toEqual({
      content: [{ runs: [{ text: "A" }, { text: "B", bold: true }] }, p("C")],
      color: "$color.danger",
    });
    // One word recolored to what the layer already is: the override is noise, and the runs merge.
    expect(
      textPatch([{ runs: [{ text: "One " }, { text: "two", color: "$color.muted" }] }], {
        color: "$color.muted",
      }),
    ).toEqual({ content: "One two" });
    // The default color back on a colored layer: the prop goes away.
    expect(
      textPatch([{ runs: [{ text: "A", color: "$color.text" }] }], { color: "$color.muted" }),
    ).toEqual({ content: "A", color: null });
  });

  it("leaves links' colors alone: the browser colors a link, not the layer", () => {
    const patch = textPatch(
      [
        {
          runs: [
            { text: "See ", color: "$color.primary" },
            { text: "docs", link: "https://veloce.dev", color: "$color.primary" },
          ],
        },
      ],
      {},
    );
    expect(patch).toEqual({
      content: [
        {
          runs: [
            { text: "See " },
            { text: "docs", link: "https://veloce.dev", color: "$color.primary" },
          ],
        },
      ],
      color: "$color.primary",
    });
    // An uncolored link doesn't make the plain text "mixed".
    expect(
      textPatch(
        [
          {
            runs: [
              { text: "Go ", color: "$color.accent" },
              { text: "here", link: "https://a.b" },
            ],
          },
        ],
        {},
      ).color,
    ).toBe("$color.accent");
  });

  it("keeps lists, and empty paragraphs don't block hoisting a color", () => {
    const patch = textPatch(
      [
        { runs: [{ text: "One", color: "$color.accent" }], list: "bullet" },
        { runs: [] },
        { runs: [{ text: "Two", color: "$color.accent" }], list: "bullet", level: 1 },
      ],
      {},
    );
    expect(patch).toEqual({
      content: [
        { runs: [{ text: "One" }], list: "bullet" },
        { runs: [] },
        { runs: [{ text: "Two" }], list: "bullet", level: 1 },
      ],
      color: "$color.accent",
    });
  });

  it("doesn't touch its input, and compares patches by value", () => {
    const input = [p("A", { style: "$text.h1" })];
    const a = textPatch(input, {});
    expect(input[0]?.style).toBe("$text.h1");
    expect(samePatch(a, textPatch(input, {}))).toBe(true);
    expect(samePatch(a, textPatch(input, { style: "$text.h1" }))).toBe(false);
  });

  it("reads a layer's box props, ignoring anything malformed", () => {
    expect(
      textBoxOf({ content: "x", style: "$text.h1", align: "middle", fontSize: 40, color: 3 }),
    ).toEqual({ style: "$text.h1", fontSize: 40 });
  });

  it("finds the one shared value (mixed or empty: none)", () => {
    expect(uniform(["a", "a"])).toBe("a");
    expect(uniform(["a", "b"])).toBeUndefined();
    expect(uniform([])).toBeUndefined();
  });
});
