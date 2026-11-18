/**
 * Theme token helpers: parse `$group.name` references, resolve them against a theme, and turn
 * a theme into CSS custom properties.
 *
 * Renderers set `themeToCssVariables(theme)` on the stage and plugins emit `var(--v-…)`
 * (see `tokenCssVar`), so a theme switch restyles everything without touching the DOM tree.
 */
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
