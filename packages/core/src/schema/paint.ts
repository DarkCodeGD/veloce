/**
 * Paints (fills) and strokes.
 *
 * A paint is either a plain color (`"#4f46e5"`, `"$color.primary"`, `"transparent"`)
 * or a tagged object: a linear/radial gradient or an image.
 */
import { z } from "zod";
import { AssetRefSchema, ColorSchema, PointSchema, tokenRefSchema } from "./primitives.js";
import { ShadowSchema } from "./theme.js";

export const GradientStopSchema = z.strictObject({
  /** Position along the gradient, 0–1. */
  offset: z.number().min(0).max(1),
  color: ColorSchema,
});

export const LinearGradientSchema = z.strictObject({
  type: z.literal("linear-gradient"),
  /** CSS convention: 0 = towards top, 90 = towards right, 180 (default) = towards bottom. */
  angle: z.number().optional(),
  stops: z.array(GradientStopSchema).min(2).max(16),
});

export const RadialGradientSchema = z.strictObject({
  type: z.literal("radial-gradient"),
  /** Center as fractions of the box (0–1). Default: the middle. */
  center: PointSchema.optional(),
  stops: z.array(GradientStopSchema).min(2).max(16),
});

export const ImagePaintSchema = z.strictObject({
  type: z.literal("image"),
  asset: AssetRefSchema,
  /** Default: `"cover"`. */
  fit: z.enum(["cover", "contain", "fill", "tile"]).optional(),
});

export const PaintSchema = z.union([
  ColorSchema,
  z.discriminatedUnion("type", [LinearGradientSchema, RadialGradientSchema, ImagePaintSchema]),
]);
export type Paint = z.infer<typeof PaintSchema>;
export type LinearGradient = z.infer<typeof LinearGradientSchema>;
export type RadialGradient = z.infer<typeof RadialGradientSchema>;
export type ImagePaint = z.infer<typeof ImagePaintSchema>;

export const StrokeSchema = z.strictObject({
  color: ColorSchema,
  width: z.number().positive().max(1000),
  /** Default: `"solid"`. */
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
});
export type Stroke = z.infer<typeof StrokeSchema>;

/** A `$shadow.*` token or an explicit shadow. */
export const ShadowValueSchema = z.union([tokenRefSchema("shadow"), ShadowSchema]);
export type ShadowValue = z.infer<typeof ShadowValueSchema>;
