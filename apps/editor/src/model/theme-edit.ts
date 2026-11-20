/**
 * Theme editing as pure functions: switching to a built-in theme, changing one color or font
 * token, snapping a custom color to the nearest theme color, and the contrast checks shown
 * next to the palette. Every change is one `deck.setTheme` (the same op the AI's set_theme
 * uses), so it's one undo step and the whole deck restyles at once (golden rule #1).
 */
import {
  BUILTIN_THEMES,
  contrastRatio,
  parseCssColor,
  type Rgba,
  type Theme,
  type TokenRef,
} from "@veloce/core";
import type { Command } from "./commands.js";

const CUSTOM = " (custom)";

export function setThemeCommand(theme: Theme, label: string): Command {
  return { label, ops: [{ op: "deck.setTheme", theme }] };
}

/** The built-in theme ID this theme is exactly (untouched), or null. */
export function builtinIdOf(theme: Theme): string | null {
  const json = JSON.stringify(theme);
  for (const [id, builtin] of Object.entries(BUILTIN_THEMES)) {
    if (JSON.stringify(builtin) === json) return id;
  }
  return null;
}

/** The name an edited theme gets: "Midnight" → "Midnight (custom)" (once). */
export const customName = (name: string) => (name.endsWith(CUSTOM) ? name : `${name}${CUSTOM}`);

export function withColor(theme: Theme, token: string, hex: string): Theme {
  return { ...theme, name: customName(theme.name), colors: { ...theme.colors, [token]: hex } };
}

export function withFont(theme: Theme, token: string, stack: string): Theme {
  return { ...theme, name: customName(theme.name), fonts: { ...theme.fonts, [token]: stack } };
}

/** The `#rrggbb` of a color for `<input type="color">` (which has no alpha), or null. */
export function toHex6(color: string): string | null {
  const rgba = parseCssColor(color);
  if (!rgba) return null;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${hex(rgba[0])}${hex(rgba[1])}${hex(rgba[2])}`;
}

/**
 * The theme color closest to `color` (by perceptual-ish RGB distance), so a stray custom color
 * can rejoin the theme in one click.
 */
export function nearestColorToken(theme: Theme, color: string): TokenRef<"color"> | null {
  const target = parseCssColor(color);
  if (!target) return null;
  let best: { name: string; distance: number } | null = null;
  for (const [name, value] of Object.entries(theme.colors)) {
    const rgba = parseCssColor(value);
    if (!rgba) continue;
    const distance = colorDistance(target, rgba);
    if (!best || distance < best.distance) best = { name, distance };
  }
  return best ? (`$color.${best.name}` as TokenRef<"color">) : null;
}

/** "Redmean" distance: cheap and much closer to perception than plain RGB. */
function colorDistance(a: Rgba, b: Rgba): number {
  const r = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}

export interface ContrastIssue {
  /** e.g. "text on background". */
  pair: string;
  ratio: number;
  /** What the pair needs (WCAG AA: 4.5, large text 3). */
  needs: number;
  /** The tokens involved, to flag both swatches. */
  tokens: [string, string];
}

/** The pairs slides lean on most, with what each needs to stay readable. */
const PAIRS: Array<[fg: string, bg: string, needs: number]> = [
  ["text", "background", 4.5],
  ["text", "surface", 4.5],
  ["muted", "background", 4.5],
  ["muted", "surface", 4.5],
  ["primary", "background", 3],
  ["on-primary", "primary", 4.5],
];

/** Palette pairs that are hard to read (the same check lint runs on finished slides). */
export function contrastIssues(theme: Theme): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const [fg, bg, needs] of PAIRS) {
    const a = theme.colors[fg];
    const b = theme.colors[bg];
    const ca = a ? parseCssColor(a) : null;
    const cb = b ? parseCssColor(b) : null;
    if (!ca || !cb) continue;
    const ratio = contrastRatio(ca, cb);
    if (ratio < needs) {
      issues.push({
        pair: `${fg} on ${bg}`,
        ratio: Math.round(ratio * 10) / 10,
        needs,
        tokens: [fg, bg],
      });
    }
  }
  return issues;
}
