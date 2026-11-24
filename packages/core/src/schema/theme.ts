/**
 * Themes: the design tokens a deck is built from.
 *
 * Content references tokens (`$color.primary`, `$text.h1`, `$space.md`) instead of raw values,
 * so switching the theme restyles the whole deck, and the AI gets a curated palette and type
 * scale instead of inventing colors and font sizes per slide.
 */
import { z } from "zod";
import { ThemeMotionSchema } from "./motion.js";
import { HexColorSchema, TokenNameSchema } from "./primitives.js";

export const ShadowSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  blur: z.number().min(0),
  spread: z.number().optional(),
  color: HexColorSchema,
});
export type Shadow = z.infer<typeof ShadowSchema>;

export const TextStyleSchema = z.strictObject({
  /** Key into `theme.fonts`. */
  font: TokenNameSchema,
  /** Font size in pixels. */
  size: z.number().positive().max(2000),
  weight: z.number().int().min(100).max(900),
  /** Line height as a multiple of the font size. */
  lineHeight: z.number().positive().max(10),
  /** Letter spacing in em. */
  letterSpacing: z.number().min(-1).max(1).optional(),
  transform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const ThemeSchema = z
  .strictObject({
    name: z.string().min(1).max(100),
    colors: z.record(TokenNameSchema, HexColorSchema),
    /** CSS font-family stacks, e.g. `"Inter, system-ui, sans-serif"`. */
    fonts: z.record(TokenNameSchema, z.string().min(1).max(500)),
    text: z.record(TokenNameSchema, TextStyleSchema),
    space: z.record(TokenNameSchema, z.number().min(0).max(10_000)),
    radius: z.record(TokenNameSchema, z.number().min(0).max(10_000)),
    shadow: z.record(TokenNameSchema, ShadowSchema),
    /**
     * The `$motion` tokens: the theme's motion personality (D111). Themes made before motion
     * have none and move with the default's.
     */
    motion: ThemeMotionSchema.optional(),
  })
  .superRefine((theme, ctx) => {
    for (const [name, style] of Object.entries(theme.text)) {
      if (!Object.hasOwn(theme.fonts, style.font)) {
        ctx.addIssue({
          code: "custom",
          path: ["text", name, "font"],
          message: `Unknown font "${style.font}". Theme fonts: ${Object.keys(theme.fonts).join(", ")}`,
        });
      }
    }
  });
export type Theme = z.infer<typeof ThemeSchema>;
