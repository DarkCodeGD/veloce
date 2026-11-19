/**
 * Paints (fills) and strokes.
 *
 * A paint is either a plain color (`"#4f46e5"`, `"$color.primary"`, `"transparent"`)
 * or a tagged object: a linear, radial or conic (angular) gradient, or an image.
 */
import { z } from "zod";
import {
  AssetRefSchema,
  ColorSchema,
  colorError,
  PointSchema,
  tokenRefSchema,
} from "./primitives.js";
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

/**
 * Elliptical, fitted to the box: from `center` (offset 0) out to the farthest box side
 * (offset 1). Centered, offset 1 is exactly the edge of an ellipse shape filling the box.
 */
export const RadialGradientSchema = z.strictObject({
  type: z.literal("radial-gradient"),
  /** Center as fractions of the box (0–1). Default: the middle. */
  center: PointSchema.optional(),
  stops: z.array(GradientStopSchema).min(2).max(16),
});

/**
 * Colors swept around `center` (Figma's angular gradient): offset 0 starts at `angle` and the
 * stops go clockwise, offset 1 ending back where they started. Repeat the first stop's color
 * last for a seamless wheel.
 */
export const ConicGradientSchema = z.strictObject({
  type: z.literal("conic-gradient"),
  /** Where offset 0 starts, in degrees clockwise from the top. Default: 0. */
  angle: z.number().optional(),
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

export const PaintSchema = z.union(
  [
    ColorSchema,
    z.discriminatedUnion("type", [
      LinearGradientSchema,
      RadialGradientSchema,
      ConicGradientSchema,
      ImagePaintSchema,
    ]),
  ],
  {
    // A string can only be meant as a color: say what's wrong with it (an opacity of 150, a
    // typo), instead of the union's bare "Invalid input".
    error: (issue) => (typeof issue.input === "string" ? colorError(issue.input) : undefined),
  },
);
export type Paint = z.infer<typeof PaintSchema>;
export type LinearGradient = z.infer<typeof LinearGradientSchema>;
export type RadialGradient = z.infer<typeof RadialGradientSchema>;
export type ConicGradient = z.infer<typeof ConicGradientSchema>;
/** Any gradient paint. */
export type Gradient = LinearGradient | RadialGradient | ConicGradient;
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
