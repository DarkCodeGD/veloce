/**
 * Primitive value schemas shared by the whole document model.
 *
 * Units: all lengths are logical pixels on the deck stage (1920×1080 by default);
 * the renderer scales the stage to fit the screen. Angles are degrees.
 */
import { z } from "zod";
import { ID_PATTERN } from "../ids.js";

export const IdSchema = z.string().regex(ID_PATTERN, {
  error: "IDs are 1-64 letters, digits, '_' or '-', starting with a letter or digit",
});

// ── Theme tokens ────────────────────────────────────────────────────────────────

/** Token groups. A token reference looks like `$<group>.<name>`, e.g. `$color.primary`. */
export const TOKEN_GROUPS = ["color", "font", "text", "space", "radius", "shadow"] as const;
export type TokenGroup = (typeof TOKEN_GROUPS)[number];
export type TokenRef<G extends TokenGroup = TokenGroup> = `$${G}.${string}`;

export const TOKEN_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*$/;
export const TokenNameSchema = z.string().regex(TOKEN_NAME_PATTERN, {
  error: "Token names start with a letter and use letters, digits or '-'",
});

/**
 * A string schema with a regex (so it converts to a JSON Schema `pattern` in AI tool
 * definitions), typed as the template literal it guarantees.
 */
function patternString<T extends string>(pattern: RegExp, error: string): z.ZodType<T, T> {
  return z.string().regex(pattern, { error }) as unknown as z.ZodType<T, T>;
}

export function tokenRefSchema<G extends TokenGroup>(
  group: G,
): z.ZodType<TokenRef<G>, TokenRef<G>> {
  return patternString<TokenRef<G>>(
    new RegExp(`^\\$${group}\\.[a-zA-Z][a-zA-Z0-9-]*$`),
    `Expected a theme token like "$${group}.<name>"`,
  );
}

// ── Colors & lengths ───────────────────────────────────────────────────────────────

export const HexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    error: 'Expected a hex color like "#4f46e5" (or "#4f46e5cc" with alpha)',
  });

/**
 * A theme color at an opacity, in percent: `"$color.secondary/30"`. For glows, glass and
 * tints that must follow theme switches (a hex with alpha would stay behind on a switch).
 */
export type ColorTokenWithOpacity = `$color.${string}/${number}`;
export const COLOR_OPACITY_PATTERN = /^\$color\.[a-zA-Z][a-zA-Z0-9-]*\/(?:100|[1-9]?[0-9])$/;
export const ColorTokenWithOpacitySchema = patternString<ColorTokenWithOpacity>(
  COLOR_OPACITY_PATTERN,
  'Expected a color token with an opacity from 0 to 100, like "$color.primary/30"',
);

const COLOR_EXPECTED =
  'Expected a hex color ("#4f46e5"), a color token ("$color.primary"), a color token at an opacity in percent ("$color.primary/30") or "transparent"';

/** What's wrong with a string that isn't a color, as specifically as possible. */
export function colorError(input: unknown): string {
  const opacity = typeof input === "string" ? /^\$color\.[a-zA-Z][\w-]*\/(.*)$/.exec(input) : null;
  if (opacity) {
    return `The opacity in "${input}" must be a whole percent from 0 to 100, like "$color.primary/30" (got "${opacity[1]}")`;
  }
  return COLOR_EXPECTED;
}

export const ColorSchema = z.union(
  [HexColorSchema, tokenRefSchema("color"), ColorTokenWithOpacitySchema, z.literal("transparent")],
  { error: (issue) => colorError(issue.input) },
);
export type Color = z.infer<typeof ColorSchema>;

/** Spacing: pixels or a `$space.*` token. */
export const SpaceSchema = z.union([z.number().min(0).max(10_000), tokenRefSchema("space")], {
  error: 'Expected a number of pixels or a space token like "$space.md"',
});
export type Space = z.infer<typeof SpaceSchema>;

/** Corner radius: pixels or a `$radius.*` token. */
export const RadiusSchema = z.union([z.number().min(0).max(10_000), tokenRefSchema("radius")], {
  error: 'Expected a number of pixels or a radius token like "$radius.md"',
});
export type Radius = z.infer<typeof RadiusSchema>;

/**
 * How a node is sized along one axis:
 * - a number: fixed size in pixels
 * - `"hug"`: shrink to fit the content (the default when omitted)
 * - `"fill"`: take the available space in the parent frame
 */
export const SizingSchema = z.union(
  [z.number().positive().max(100_000), z.literal("hug"), z.literal("fill")],
  { error: 'Expected a size in pixels, "hug" (fit content) or "fill" (use available space)' },
);
export type Sizing = z.infer<typeof SizingSchema>;

export const PointSchema = z.strictObject({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

// ── Assets ───────────────────────────────────────────────────────────────────────

/** Assets are identified by the SHA-256 (lowercase hex) of their bytes. */
export const ASSET_ID_PATTERN = /^[0-9a-f]{64}$/;
export const AssetIdSchema = z.string().regex(ASSET_ID_PATTERN, {
  error: "Asset IDs are the lowercase hex SHA-256 of the file (64 characters)",
});

/**
 * Anything that points at an asset (image props, image paints…) uses `"asset:<sha256>"`.
 * The fixed prefix lets core find every asset reference without knowing plugin schemas.
 */
export const ASSET_REF_PATTERN = /^asset:[0-9a-f]{64}$/;
export type AssetRef = `asset:${string}`;
export const AssetRefSchema = patternString<AssetRef>(
  ASSET_REF_PATTERN,
  'Expected an asset reference like "asset:<sha256>"',
);
