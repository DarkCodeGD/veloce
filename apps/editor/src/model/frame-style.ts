/**
 * A frame's border (`style.stroke`) and shadow (`style.shadow`) as the inspector edits them,
 * pure (D74). Borders also serve any element prop that is a stroke, such as a shape's
 * outline (`props.stroke`), through a `StrokePath`. Each is absent until added with **+** (Figma's Stroke / Effects), so a plain card
 * shows two short headers, not a column of empty fields.
 *
 * - A border starts as a 2px line in the theme's border color (1px is a hairline on a
 *   1920px slide).
 * - A shadow starts as the theme's `md` shadow token, so it follows the theme. Picking
 *   "Custom" copies the token's values into the frame, ready to tweak; shadows only take hex
 *   colors (`ShadowSchema`), so a picked theme color is stored as its hex.
 */
import { resolveColor, type Shadow, type ShadowValue, type Stroke, type Theme } from "@veloce/core";
import { type Command, updateNode } from "./commands.js";

export const DEFAULT_STROKE: Stroke = { color: "$color.border", width: 2 };

/** Used when the theme has no shadow tokens at all. */
export const FALLBACK_SHADOW: Shadow = { x: 0, y: 8, blur: 24, color: "#00000026" };

/** What the Shadow menu shows for an explicit (non-token) shadow. */
export const CUSTOM = "custom";

/** Where a node keeps a stroke: a frame's `style.stroke`, or an element prop (`props.stroke`). */
export interface StrokePath {
  at: "style" | "props";
  key: string;
}
export const FRAME_BORDER: StrokePath = { at: "style", key: "stroke" };

/** A `node.update` patch setting the stroke at `path` (a partial stroke merges; null removes). */
export const strokePatch = (path: StrokePath, value: Partial<Stroke> | null) => ({
  [path.at]: { [path.key]: value },
});

export const addBorder = (id: string, path: StrokePath = FRAME_BORDER): Command =>
  updateNode(id, strokePatch(path, DEFAULT_STROKE), "Add border");

export const removeBorder = (id: string, path: StrokePath = FRAME_BORDER): Command =>
  updateNode(id, strokePatch(path, null), "Remove border");

/** The theme's `md` shadow, else its first one, else an explicit soft shadow. */
export function defaultShadow(theme: Theme): ShadowValue {
  const names = Object.keys(theme.shadow);
  const name = names.includes("md") ? "md" : names[0];
  return name === undefined ? { ...FALLBACK_SHADOW } : `$shadow.${name}`;
}

export const addShadow = (id: string, theme: Theme): Command =>
  updateNode(id, { style: { shadow: defaultShadow(theme) } }, "Add shadow");

export const removeShadow = (id: string): Command =>
  updateNode(id, { style: { shadow: null } }, "Remove shadow");

/** The Shadow menu's value: the token (`$shadow.md`), or `custom` for explicit values. */
export const shadowPreset = (value: ShadowValue): string =>
  typeof value === "string" ? value : CUSTOM;

/** A shadow's values: a token's from the theme (an unknown token: the fallback). */
export function shadowValues(theme: Theme, value: ShadowValue): Shadow {
  if (typeof value !== "string") return value;
  const name = value.slice("$shadow.".length);
  const token = Object.hasOwn(theme.shadow, name) ? theme.shadow[name] : undefined;
  return { ...(token ?? FALLBACK_SHADOW) };
}

/**
 * Pick a preset: a token replaces the shadow; "Custom" turns the current token into explicit
 * values (nothing changes on the slide, but the fields to tweak it appear).
 */
export function setShadowPreset(
  id: string,
  theme: Theme,
  current: ShadowValue,
  preset: string,
): Command | null {
  if (preset === shadowPreset(current)) return null;
  const shadow = preset === CUSTOM ? shadowValues(theme, current) : preset;
  return updateNode(id, { style: { shadow } }, "Change shadow");
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A picked color as a shadow color (hex only): theme colors resolve to their hex. */
export function shadowColor(theme: Theme, color: unknown): string | null {
  if (typeof color !== "string") return null;
  const hex = resolveColor(theme, color);
  return hex !== undefined && HEX.test(hex) ? hex : null;
}
