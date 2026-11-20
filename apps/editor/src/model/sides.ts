/**
 * Per-side padding as the inspector edits it, pure (D75). One field for all sides, or four
 * ("individual sides"). The same model will serve per-corner radius (roadmap: one shared
 * control), so the generic part (`uniformValue`, `mostCommon`) knows nothing about padding.
 *
 * Padding has three stored forms: one value, `{ x, y }`, and `{ top, right, bottom, left }`.
 * The editor reads all three. It writes one value from the single field, and the four-side
 * form from the side fields: editing one side of an `{ x, y }` padding spells out all four,
 * so the other sides keep their values (core replaces, not merges, across forms).
 */
import { diffPatch, type Padding, type Space } from "@veloce/core";
import { type Command, updateNode } from "./commands.js";

export type Side = "top" | "right" | "bottom" | "left";
export type Sides = Record<Side, Space | undefined>;

/** Field order and labels, clockwise from the top like CSS. */
export const SIDES: ReadonlyArray<readonly [Side, string]> = [
  ["top", "Top"],
  ["right", "Right"],
  ["bottom", "Bottom"],
  ["left", "Left"],
];

/** Each side's padding (`undefined`: unset, so 0). */
export function paddingSides(padding: Padding | undefined): Sides {
  if (padding === undefined || typeof padding !== "object") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  if ("x" in padding || "y" in padding) {
    const { x, y } = padding as { x?: Space; y?: Space };
    return { top: y, right: x, bottom: y, left: x };
  }
  const sides = padding as Partial<Sides>;
  return { top: sides.top, right: sides.right, bottom: sides.bottom, left: sides.left };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The one value every key has (`{ value }`, possibly unset), or `null` if they differ. */
export function uniformValue<V>(values: Readonly<Record<string, V | undefined>>): {
  value: V | undefined;
} | null {
  const all = Object.values(values);
  const first = all[0];
  return all.every((v) => same(v, first)) ? { value: first } : null;
}

/** The value most keys have (ties: the earliest), ignoring unset ones; `undefined` if none. */
export function mostCommon<V>(values: ReadonlyArray<V | undefined>): V | undefined {
  let best: V | undefined;
  let bestCount = 0;
  for (const value of values) {
    if (value === undefined) continue;
    const count = values.filter((v) => same(v, value)).length;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** A command setting a frame's padding to `next`, as the smallest patch (null: no change). */
function setPadding(
  id: string,
  current: Padding | undefined,
  next: Padding | undefined,
  label: string,
) {
  if (same(current, next)) return null;
  const patch = next === undefined ? null : (diffPatch(current, next) ?? null);
  return updateNode(id, { layout: { padding: patch } }, label);
}

/** Set one side (`null`: unset it); the others keep their values. */
export function setPaddingSide(
  id: string,
  current: Padding | undefined,
  side: Side,
  value: Space | null,
): Command | null {
  const sides = { ...paddingSides(current), [side]: value ?? undefined };
  const defined = Object.fromEntries(
    SIDES.flatMap(([key]) => (sides[key] === undefined ? [] : [[key, sides[key]]])),
  ) as Partial<Sides>;
  const next = Object.keys(defined).length === 0 ? undefined : (defined as Padding);
  return setPadding(id, current, next, "Change padding");
}

/**
 * Back to one value ("individual sides" off): the value most sides have, so a card with one
 * odd side keeps the look of the other three. Already one value: nothing to do (null).
 */
export function collapsePadding(id: string, current: Padding | undefined): Command | null {
  const sides = paddingSides(current);
  const value = mostCommon(SIDES.map(([key]) => sides[key]));
  return setPadding(id, current, value, "Use one padding");
}
