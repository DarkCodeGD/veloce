/**
 * The Theme styles dialog's logic, pure (D78): the theme's text styles and its spacing, radius
 * and shadow scales, edited as a draft and saved as one `deck.setTheme` (the op the AI's
 * set_theme uses), so a whole session is one undo step.
 *
 * Saving merges by group: only the groups the user changed are written, onto the deck's
 * *current* theme. An agent recoloring the deck while the dialog is open keeps its colors,
 * and a group both changed is the user's (they pressed Save last).
 */
import {
  type Deck,
  type Shadow,
  type TextStyle,
  type Theme,
  TOKEN_NAME_PATTERN,
} from "@veloce/core";
import { customName } from "./theme-edit.js";

/** The theme groups this dialog edits. */
export type StyleGroup = "text" | "space" | "radius" | "shadow";
export const STYLE_GROUPS: readonly StyleGroup[] = ["text", "space", "radius", "shadow"];

type GroupValue<G extends StyleGroup> = Theme[G][string];

/** One token of a group set (`null` removes it), the theme renamed "… (custom)". */
export function withToken<G extends StyleGroup>(
  theme: Theme,
  group: G,
  name: string,
  value: GroupValue<G> | null,
): Theme {
  const tokens = { ...(theme[group] as Record<string, GroupValue<G>>) };
  if (value === null) delete tokens[name];
  else tokens[name] = value;
  return { ...theme, name: customName(theme.name), [group]: tokens };
}

/** Change some fields of a text style (`null`: drop an optional one, e.g. letter spacing). */
export function withTextStyle(
  theme: Theme,
  name: string,
  patch: { [K in keyof TextStyle]?: TextStyle[K] | null },
): Theme {
  const current = theme.text[name];
  if (!current) return theme;
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return withToken(theme, "text", name, next as TextStyle);
}

/** Change some fields of a shadow (`null`: drop spread). */
export function withShadow(
  theme: Theme,
  name: string,
  patch: { [K in keyof Shadow]?: Shadow[K] | null },
): Theme {
  const current = theme.shadow[name];
  if (!current) return theme;
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return withToken(theme, "shadow", name, next as Shadow);
}

/**
 * What a new name for a token of `group` can't be, in words, or null when it's fine. Names
 * become references like `$text.quote`, so they follow the token name rule.
 */
export function tokenNameError(theme: Theme, group: StyleGroup, name: string): string | null {
  if (!name) return "Give it a name.";
  if (!TOKEN_NAME_PATTERN.test(name)) {
    return "Start with a letter; then letters, digits or '-'.";
  }
  if (Object.hasOwn(theme[group], name)) return `"${name}" already exists.`;
  return null;
}

/**
 * A new token's starting value: a copy of `from` (the one selected) if given, else a
 * sensible one (the body text style, the largest spacing step, 8px corners, the md shadow).
 */
export function newTokenValue<G extends StyleGroup>(
  theme: Theme,
  group: G,
  from?: string,
): GroupValue<G> {
  const tokens = theme[group] as Record<string, GroupValue<G>>;
  const source = from !== undefined && Object.hasOwn(tokens, from) ? tokens[from] : undefined;
  if (source !== undefined) return structuredClone(source);
  const values = Object.values(tokens);
  switch (group) {
    case "text": {
      const font = Object.keys(theme.fonts)[0] ?? "body";
      return (theme.text.body ?? { font, size: 32, weight: 400, lineHeight: 1.4 }) as GroupValue<G>;
    }
    case "space":
      return Math.max(0, ...(values as number[])) as GroupValue<G>;
    case "radius":
      return 8 as GroupValue<G>;
    default:
      return (theme.shadow.md ?? { x: 0, y: 8, blur: 24, color: "#00000026" }) as GroupValue<G>;
  }
}

/** How many places in the deck's slides use `$group.name` (exact references). */
export function tokenUses(deck: Deck, group: StyleGroup, name: string): number {
  const ref = `$${group}.${name}`;
  let count = 0;
  const walk = (value: unknown): void => {
    if (value === ref) count++;
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(deck.slides);
  return count;
}

/** The groups that differ between two themes. */
export function changedGroups(before: Theme, after: Theme): StyleGroup[] {
  return STYLE_GROUPS.filter((g) => JSON.stringify(before[g]) !== JSON.stringify(after[g]));
}

/**
 * The theme to save: `current` (the deck's theme now) with the groups the user changed since
 * `original` (the theme when the dialog opened) taken from `draft`. Null: nothing changed.
 */
export function mergeDraft(original: Theme, draft: Theme, current: Theme): Theme | null {
  const groups = changedGroups(original, draft);
  if (groups.length === 0) return null;
  const merged: Theme = { ...current, name: customName(current.name) };
  for (const group of groups) (merged as Record<string, unknown>)[group] = draft[group];
  return merged;
}

/** Font weights by their usual names (CSS 100–900). */
export const WEIGHTS: ReadonlyArray<readonly [number, string]> = [
  [100, "Thin"],
  [200, "Extra light"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "Semibold"],
  [700, "Bold"],
  [800, "Extra bold"],
  [900, "Black"],
];

/** Letter case options, shown the way they look. */
export const CASES: ReadonlyArray<readonly [NonNullable<TextStyle["transform"]>, string]> = [
  ["none", "As typed"],
  ["uppercase", "UPPERCASE"],
  ["lowercase", "lowercase"],
  ["capitalize", "Capitalize Each Word"],
];

/**
 * Letter spacing: stored in em (agents' unit), shown in % like Figma (0.02em → 2%). Shown to
 * 0.01%, so any value an agent wrote (to 0.0001em) shows and saves back unchanged.
 */
export const emToPercent = (em: number | undefined) =>
  em === undefined ? undefined : Math.round(em * 10_000) / 100;
export const percentToEm = (percent: number) => Math.round(percent * 100) / 10_000;

/** "80 · Bold" for a text style's one-line summary. */
export function textStyleSummary(style: TextStyle): string {
  const weight = WEIGHTS.find(([w]) => w === style.weight)?.[1] ?? String(style.weight);
  return `${style.size} · ${weight}`;
}
