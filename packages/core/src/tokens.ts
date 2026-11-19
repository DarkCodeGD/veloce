/**
 * Theme token helpers: parse `$group.name` references, resolve them against a theme, and turn
 * a theme into CSS custom properties.
 *
 * Renderers set `themeToCssVariables(theme)` on the stage and plugins emit `var(--v-…)`
 * (see `tokenCssVar`), so a theme switch restyles everything without touching the DOM tree.
 */
import { parseCssColor } from "./measure.js";
import { TOKEN_GROUPS, type TokenGroup, type TokenRef } from "./schema/primitives.js";
import type { Shadow, TextStyle, Theme } from "./schema/theme.js";

const TOKEN_REF = /^\$([a-z]+)\.([a-zA-Z][a-zA-Z0-9-]*)$/;

export function parseTokenRef(value: unknown): { group: TokenGroup; name: string } | null {
  if (typeof value !== "string") return null;
  const match = TOKEN_REF.exec(value);
  const group = match?.[1] as TokenGroup | undefined;
  if (!match?.[2] || !group || !TOKEN_GROUPS.includes(group)) return null;
  return { group, name: match[2] };
}

export function isTokenRef(value: unknown): value is TokenRef {
  return parseTokenRef(value) !== null;
}

type TokenValue = string | number | TextStyle | Shadow;

const GROUP_TO_THEME_KEY = {
  color: "colors",
  font: "fonts",
  text: "text",
  space: "space",
  radius: "radius",
  shadow: "shadow",
} as const satisfies Record<TokenGroup, keyof Theme>;

/** Look up a token's value; `undefined` when the reference is malformed or the token is missing. */
export function resolveToken(theme: Theme, ref: string): TokenValue | undefined {
  const parsed = parseTokenRef(ref);
  if (!parsed) return undefined;
  const table: Record<string, TokenValue> = theme[GROUP_TO_THEME_KEY[parsed.group]];
  return Object.hasOwn(table, parsed.name) ? table[parsed.name] : undefined;
}

// ── Colors at an opacity: `$color.secondary/30` ───────────────────────────────────────

const COLOR_REF = /^\$color\.([a-zA-Z][a-zA-Z0-9-]*)(?:\/(\d{1,3}))?$/;

/**
 * A color token with its opacity: `"$color.primary/30"` → `{ token: "$color.primary",
 * name: "primary", opacity: 30 }`. A plain token is opacity 100. Null for anything else
 * (hex, `transparent`, an opacity above 100).
 */
export function parseColorToken(
  value: unknown,
): { token: TokenRef<"color">; name: string; opacity: number } | null {
  if (typeof value !== "string") return null;
  const match = COLOR_REF.exec(value);
  if (!match?.[1]) return null;
  const opacity = match[2] === undefined ? 100 : Number(match[2]);
  if (opacity > 100) return null;
  return { token: `$color.${match[1]}`, name: match[1], opacity };
}

/**
 * CSS for a document color. Tokens become `var(--v-color-…)`, so a theme switch restyles
 * without re-rendering; at an opacity, the variable is mixed with `transparent`, which keeps
 * the theme color's own alpha too (an 80% theme color at 30% is 24%).
 */
export function colorCss(color: string): string {
  const ref = parseColorToken(color);
  if (!ref) return color;
  const variable = tokenCssVar(ref.token);
  return ref.opacity >= 100
    ? variable
    : `color-mix(in srgb, ${variable} ${ref.opacity}%, transparent)`;
}

/**
 * The concrete color a document color shows in a theme (`#rrggbb` or `#rrggbbaa`), for
 * swatches and pickers. Undefined for a token the theme lacks.
 */
export function resolveColor(theme: Theme, color: string): string | undefined {
  const ref = parseColorToken(color);
  if (!ref) return color;
  const value = Object.hasOwn(theme.colors, ref.name) ? theme.colors[ref.name] : undefined;
  if (value === undefined || ref.opacity >= 100) return value;
  const rgba = parseCssColor(value);
  if (!rgba) return value;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${hex(rgba[0])}${hex(rgba[1])}${hex(rgba[2])}${hex(rgba[3] * (ref.opacity / 100) * 255)}`;
}

/** Sub-properties of a `$text.*` token, each exposed as its own CSS variable. */
export type TextStylePart =
  | "font"
  | "size"
  | "weight"
  | "line-height"
  | "letter-spacing"
  | "transform";

/** CSS custom property name: `--v-color-primary`, `--v-text-h1-size`. */
export function tokenCssVarName(group: TokenGroup, name: string, part?: TextStylePart): string {
  return `--v-${group}-${name}${part ? `-${part}` : ""}`;
}

/** `var(--v-…)` for a token. For `$text.*` tokens pass the `part` you need. */
export function tokenCssVar(ref: TokenRef, part?: TextStylePart): string {
  const parsed = parseTokenRef(ref);
  if (!parsed) throw new Error(`Not a token reference: ${ref}`);
  return `var(${tokenCssVarName(parsed.group, parsed.name, part)})`;
}

/**
 * Everything a `$text.*` style sets, as [CSS property, token part]. The text plugin (on a
 * paragraph with its own style) and the editor's typing surface both apply exactly this list,
 * so a styled paragraph looks the same in both, and like a layer with that style.
 */
export const TEXT_STYLE_CSS: ReadonlyArray<readonly [string, TextStylePart]> = [
  ["font-family", "font"],
  ["font-size", "size"],
  ["font-weight", "weight"],
  ["line-height", "line-height"],
  ["letter-spacing", "letter-spacing"],
  ["text-transform", "transform"],
];

/** CSS declarations for a text style token: `{ "font-size": "var(--v-text-h1-size)", … }`. */
export function textStyleCss(ref: TokenRef): Record<string, string> {
  return Object.fromEntries(TEXT_STYLE_CSS.map(([prop, part]) => [prop, tokenCssVar(ref, part)]));
}

export function shadowToCss(shadow: Shadow): string {
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread ?? 0}px ${shadow.color}`;
}

/** Every theme token as a CSS custom property, ready to set on the stage element. */
export function themeToCssVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(theme.colors)) {
    vars[tokenCssVarName("color", name)] = value;
  }
  for (const [name, value] of Object.entries(theme.fonts)) {
    vars[tokenCssVarName("font", name)] = value;
  }
  for (const [name, value] of Object.entries(theme.space)) {
    vars[tokenCssVarName("space", name)] = `${value}px`;
  }
  for (const [name, value] of Object.entries(theme.radius)) {
    vars[tokenCssVarName("radius", name)] = `${value}px`;
  }
  for (const [name, value] of Object.entries(theme.shadow)) {
    vars[tokenCssVarName("shadow", name)] = shadowToCss(value);
  }
  for (const [name, style] of Object.entries(theme.text)) {
    vars[tokenCssVarName("text", name, "font")] = `var(${tokenCssVarName("font", style.font)})`;
    vars[tokenCssVarName("text", name, "size")] = `${style.size}px`;
    vars[tokenCssVarName("text", name, "weight")] = String(style.weight);
    vars[tokenCssVarName("text", name, "line-height")] = String(style.lineHeight);
    vars[tokenCssVarName("text", name, "letter-spacing")] = `${style.letterSpacing ?? 0}em`;
    vars[tokenCssVarName("text", name, "transform")] = style.transform ?? "none";
  }
  return vars;
}
