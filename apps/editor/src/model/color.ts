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

// ── What the color field shows and accepts ─────────────────────────────────────────────

/**
 * The color field's text: a token by its theme name (`primary`), a hex without its alpha
 * (`#4f46e5`). The opacity has its own box, and a short label fits next to it.
 */
export function colorLabel(color: unknown): string {
  if (typeof color !== "string") return "";
  const token = parseColorToken(color);
  if (token) return token.name;
  if (/^#[0-9a-f]{4}$/i.test(color)) return color.slice(0, 4);
  if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(0, 7);
  return color;
}

/**
 * A color typed into the field, or null if it isn't one. Takes what the document takes plus
 * the short forms the field shows: a theme color's name (`primary`, `primary/30`) and a hex
 * without `#`. A color typed without an opacity keeps the current one (like a swatch).
 */
export function parseTypedColor(
  text: string,
  themeColors: Readonly<Record<string, string>>,
  current: unknown,
): string | null {
  const t = text.trim();
  const named = /^([a-zA-Z][a-zA-Z0-9-]*)(\/\d{1,3})?$/.exec(t);
  const full =
    t !== "transparent" && named?.[1] && Object.hasOwn(themeColors, named[1])
      ? `$color.${t}`
      : /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)
        ? `#${t}`
        : t;
  if (!isColorText(full)) return null;
  const explicitOpacity = full.includes("/") || /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(full);
  return explicitOpacity || full === "transparent" ? full : keepOpacity(current, full);
}

// ── The picker's color model (HSV, like Figma's square) ────────────────────────────────

/** Hue 0–360, saturation, value and alpha 0–1. */
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

/** What the picker hands back: the color as `#rrggbb`, and its alpha (whole percents). */
export interface PickedColor {
  hex: string;
  alpha: number;
}

/**
 * `#rrggbb` + alpha as HSV. Grays have no hue and black no saturation, so `keep` (the
 * picker's previous state) supplies them: dragging to the square's black edge and back
 * doesn't snap the hue to red.
 */
export function toHsva(hex: string, alpha: number, keep?: Hsva): Hsva {
  const rgba = parseCssColor(hex) ?? [0, 0, 0, 1];
  const [r, g, b] = [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = keep?.h ?? 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const s = max === 0 ? (keep?.s ?? 0) : d / max;
  return { h, s, v: max, a: alpha };
}

/** HSV back to `#rrggbb`. */
export function hsvToHex({ h, s, v }: Hsva): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

/** The picker's view of a color: its `#rrggbb` and its alpha (a token's or hex's opacity). */
export function pickerColor(shown: string | undefined, color: unknown): PickedColor {
  return { hex: (shown && toHex6(shown)) ?? "#000000", alpha: (opacityOf(color) ?? 100) / 100 };
}

/**
 * The document color for what was picked. Only the opacity changed (the same `#rrggbb` the
 * picker was given): keep the color itself, so a token stays a token. Otherwise the new hex,
 * at the picked opacity.
 */
export function fromPicked(current: unknown, shownHex: string, picked: PickedColor): string {
  const pct = Math.round(picked.alpha * 100);
  const same = picked.hex.toLowerCase() === shownHex.toLowerCase();
  if (same && typeof current === "string" && opacityOf(current) !== null) {
    return withOpacity(current, pct);
  }
  return withOpacity(picked.hex, pct);
}

/** `#rrggbb` of any color the parser reads (the picker works without alpha). */
function toHex6(color: string): string | null {
  const rgba = parseCssColor(color);
  if (!rgba) return null;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${hex(rgba[0])}${hex(rgba[1])}${hex(rgba[2])}`;
}
