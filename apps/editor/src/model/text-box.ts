/**
 * What a typing session writes back to a text layer (D61). The toolbar formats paragraphs and
 * runs (a paragraph's text style and alignment, a run's color), but a choice that covers the
 * WHOLE text belongs on the layer itself: select all, pick "h1" → the layer's `style` becomes
 * `$text.h1`, not an h1 override on every paragraph. The inspector then shows the truth, and an
 * agent reading the deck sees one `style` instead of a pattern to decode.
 *
 * Think of it as factoring out a common term: when every paragraph says the same thing, say
 * it once on the layer. And an override that only repeats what the layer already says is
 * noise, so it's dropped.
 *
 * Every rewrite here is visually a no-op; that's the contract the tests check:
 * - A paragraph style beats the layer's font overrides (`fontSize`, `font`…) because it's set
 *   on the paragraph itself. So hoisting a style also clears those overrides, and a style
 *   equal to the layer's is only redundant when the layer has no overrides.
 * - Links are colored by the browser, not by the layer, so a link's own color never moves to
 *   the layer and is never dropped.
 */
import type { Color, Paragraph, TextContent, TextRun } from "@veloce/core";
import { mergeRuns, toContent } from "./rich-text-doc.js";

export type Align = NonNullable<Paragraph["align"]>;

/** The text layer's props that rich text can override (the text plugin's TextProps). */
export interface TextBox {
  style?: string;
  color?: Color;
  align?: Align;
  font?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
}

/** The text plugin's defaults (plugins/text). */
export const TEXT_DEFAULTS = { style: "$text.body", color: "$color.text", align: "left" } as const;

/** Layer overrides that a paragraph style replaces. */
const FONT_OVERRIDES = ["font", "fontSize", "fontWeight", "lineHeight"] as const;

/** What the layer shows where the text doesn't override it. */
export const effectiveBox = (box: TextBox) => ({
  style: box.style ?? TEXT_DEFAULTS.style,
  color: box.color ?? TEXT_DEFAULTS.color,
  align: box.align ?? TEXT_DEFAULTS.align,
});

/** The props patch for `node.update` (null removes a prop), content included. */
export type TextPatch = { content: TextContent } & Partial<
  Record<"style" | "color" | "align" | (typeof FONT_OVERRIDES)[number], unknown>
>;

/** The text layer's box props, read from its stored props (anything malformed is ignored). */
export function textBoxOf(props: Readonly<Record<string, unknown>>): TextBox {
  const box: TextBox = {};
  const str = (k: "style" | "color" | "font") => {
    if (typeof props[k] === "string") box[k] = props[k] as string;
  };
  str("style");
  str("color");
  str("font");
  if (
    props.align === "left" ||
    props.align === "center" ||
    props.align === "right" ||
    props.align === "justify"
  ) {
    box.align = props.align;
  }
  for (const k of ["fontSize", "fontWeight", "lineHeight"] as const) {
    if (typeof props[k] === "number") box[k] = props[k];
  }
  return box;
}

/** The one value every item has, or undefined (none, or mixed). */
export function uniform<T>(values: readonly T[]): T | undefined {
  const [first] = values;
  return values.length > 0 && values.every((v) => v === first) ? first : undefined;
}

/** A layer prop set to `value`: removed when that's the default anyway. */
const propValue = (value: string, fallback: string) => (value === fallback ? null : value);

/**
 * Edited paragraphs + the layer's props → the patch that stores them, with uniform formatting
 * hoisted to the layer and redundant overrides dropped. Only props that change are included.
 */
export function textPatch(input: readonly Paragraph[], box: TextBox): TextPatch {
  const paragraphs = input.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r })) }));
  const patch: Omit<TextPatch, "content"> = {};
  const base = effectiveBox(box);

  // ── Text style ──
  const overridden = FONT_OVERRIDES.some((k) => box[k] !== undefined);
  // What each paragraph looks like: its own style, or the layer's (with its overrides).
  const LAYER = "\0layer";
  const looks = paragraphs.map((p) => p.style ?? (overridden ? LAYER : base.style));
  const style = uniform(looks);
  if (style !== undefined && style !== LAYER) {
    if (style !== base.style) patch.style = style;
    for (const k of FONT_OVERRIDES) if (box[k] !== undefined) patch[k] = null;
    for (const p of paragraphs) delete p.style;
  } else if (!overridden) {
    for (const p of paragraphs) if (p.style === base.style) delete p.style;
  }

  // ── Alignment ──
  const align = uniform(paragraphs.map((p) => p.align ?? base.align));
  if (align !== undefined) {
    if (align !== base.align) patch.align = propValue(align, TEXT_DEFAULTS.align);
    for (const p of paragraphs) delete p.align;
  } else {
    for (const p of paragraphs) if (p.align === base.align) delete p.align;
  }

  // ── Color (links keep theirs: the browser colors a link, not the layer) ──
  const plain: TextRun[] = paragraphs.flatMap((p) => p.runs.filter((r) => !r.link && r.text));
  const color = uniform(plain.map((r) => r.color ?? base.color));
  const finalColor = color ?? base.color;
  if (color !== undefined && color !== base.color) {
    patch.color = propValue(color, TEXT_DEFAULTS.color);
  }
  for (const r of plain) if (r.color === finalColor) delete r.color;

  for (const p of paragraphs) p.runs = mergeRuns(p.runs);
  return { content: toContent(paragraphs), ...patch };
}

/** True when `patch` changes nothing compared to `baseline` (same content, same props). */
export const samePatch = (a: TextPatch, b: TextPatch) => JSON.stringify(a) === JSON.stringify(b);
