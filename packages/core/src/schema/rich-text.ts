/**
 * Rich text model, shared by the text plugin, lint rules and the editor (TipTap maps to it).
 *
 * Text content is either a plain string (paragraphs separated by "\n"), which is the cheapest
 * form for an AI to write, or a list of paragraphs made of styled runs.
 */
import { z } from "zod";
import { ColorSchema, tokenRefSchema } from "./primitives.js";

/** Only web and mail links. Never `javascript:` or `data:` (XSS). */
export const LinkSchema = z
  .string()
  .max(2048)
  .regex(/^(?:https?:\/\/|mailto:)/i, {
    error: "Links must start with http://, https:// or mailto:",
  });

/**
 * Fields (D97): values the renderer fills in where the text is drawn, so they stay right
 * when slides move, the deck is renamed or the day changes.
 */
export const FIELD_NAMES = ["slideNumber", "slideCount", "date", "deckTitle", "section"] as const;
export const FieldNameSchema = z.enum(FIELD_NAMES);
export type FieldName = z.infer<typeof FieldNameSchema>;

export const TextRunSchema = z.strictObject({
  /** For a field run: the value it showed when it was written (search, copy, fallback). */
  text: z.string().max(100_000),
  /** Draws this field's current value instead of `text` (D97). */
  field: FieldNameSchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  /** Inline code (monospace). */
  code: z.boolean().optional(),
  color: ColorSchema.optional(),
  link: LinkSchema.optional(),
});
export type TextRun = z.infer<typeof TextRunSchema>;

export const ParagraphSchema = z.strictObject({
  runs: z.array(TextRunSchema).max(1000),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  /** Makes the paragraph a list item. */
  list: z.enum(["bullet", "number"]).optional(),
  /** List nesting level, 0 = top. */
  level: z.number().int().min(0).max(8).optional(),
  /** Override the element's text style for this paragraph, e.g. `"$text.h2"`. */
  style: tokenRefSchema("text").optional(),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;

export const RichTextSchema = z.array(ParagraphSchema).max(1000);
export type RichText = z.infer<typeof RichTextSchema>;

export const TextContentSchema = z.union([z.string().max(100_000), RichTextSchema]);
export type TextContent = z.infer<typeof TextContentSchema>;

/** Normalize either content form into paragraphs. */
export function toParagraphs(content: TextContent): Paragraph[] {
  if (typeof content !== "string") return content;
  return content.split("\n").map((line) => ({ runs: line ? [{ text: line }] : [] }));
}

/** Plain text of any content form (for search, lint word counts, accessibility). */
export function toPlainText(content: TextContent): string {
  if (typeof content === "string") return content;
  return content.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
}
