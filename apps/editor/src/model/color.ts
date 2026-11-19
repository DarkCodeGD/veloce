/**
 * A color's opacity, as the inspector's Opacity field edits it. Works on both kinds of color a
 * document holds: a theme token (`$color.secondary/30`, which keeps following theme switches)
 * and a raw hex (`#4f46e54d`, the alpha byte). The system color picker has no alpha (D47), so
 * this is how any color gets one. Pure, unit-tested.
 */
import { ColorSchema, parseColorToken, parseCssColor } from "@veloce/core";

/**
 * Opacity in percent (0–100), or null for a color with no opacity to change (`transparent`,
 * a gradient, an image, nothing set).
 */
export function opacityOf(color: unknown): number | null {
  const token = parseColorToken(color);
  if (token) return token.opacity;
  if (typeof color !== "string" || !color.startsWith("#")) return null;
  const rgba = parseCssColor(color);
  return rgba ? Math.round(rgba[3] * 100) : null;
}

/** The same color at `opacity` percent (100: the plain token, or a 6-digit hex). */
export function withOpacity(color: string, opacity: number): string {
  const pct = Math.round(Math.min(100, Math.max(0, opacity)));
  const token = parseColorToken(color);
  if (token) return pct >= 100 ? token.token : `${token.token}/${pct}`;
  const rgba = color.startsWith("#") ? parseCssColor(color) : null;
  if (!rgba) return color; // transparent, gradients: nothing to change
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  const rgb = `#${hex(rgba[0])}${hex(rgba[1])}${hex(rgba[2])}`;
  return pct >= 100 ? rgb : `${rgb}${hex((pct / 100) * 255)}`;
}

/**
 * `next` (a swatch, a picked hex, the nearest theme color) at the opacity `current` had, so
 * changing the color of a 30% glow keeps it a 30% glow (Figma keeps a fill's opacity too).
 */
export function keepOpacity(current: unknown, next: string): string {
  const opacity = opacityOf(current);
  return opacity === null ? next : withOpacity(next, opacity);
}

/** The token a color uses, without its opacity: `$color.primary/30` → `$color.primary`. */
export const baseToken = (color: unknown): string | undefined => parseColorToken(color)?.token;

/** True for text someone may type into a color field (anything the document accepts). */
export const isColorText = (text: string) => ColorSchema.safeParse(text).success;
