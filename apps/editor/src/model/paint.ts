/**
 * The paint picker's model (D66): fills that are a solid color, a gradient (linear, radial,
 * conic) or an image, as Figma's fill picker edits them. Everything here is pure and
 * unit-tested; the component only turns gestures into these calls.
 *
 * Stops are kept sorted by offset after every change (CSS draws a stop that comes before an
 * earlier one at the earlier one's position, so an unsorted list renders unlike it reads).
 * Functions that move a stop also say where it ended up, so the selection follows it.
 */
import {
  assetUsage,
  type Deck,
  type Gradient,
  type ImagePaint,
  type Op,
  type Paint,
  parseAssetRef,
  parseCssColor,
  resolveColor,
  type Theme,
} from "@veloce/core";
import { cssPaint } from "@veloce/plugin-api";
import { assetAddOps, type Imported } from "./asset-insert.js";
import { baseToken, opacityOf, withOpacity } from "./color.js";
import type { Command } from "./commands.js";

export type PaintKind = "solid" | "linear" | "radial" | "conic" | "image";
export type GradientKind = "linear" | "radial" | "conic";
type Stop = Gradient["stops"][number];

const GRADIENT_TYPE = {
  linear: "linear-gradient",
  radial: "radial-gradient",
  conic: "conic-gradient",
} as const satisfies Record<GradientKind, Gradient["type"]>;

/** The picker's tabs, in order, with the names Figma users know. */
export const PAINT_KINDS: ReadonlyArray<{ kind: PaintKind; label: string }> = [
  { kind: "solid", label: "Solid" },
  { kind: "linear", label: "Linear" },
  { kind: "radial", label: "Radial" },
  { kind: "conic", label: "Angular" },
  { kind: "image", label: "Image" },
];

const CENTER = { x: 0.5, y: 0.5 };
/** What a new linear gradient points to: down, like CSS's default. */
const DEFAULT_ANGLE = 180;

const tagOf = (paint: unknown): string | undefined =>
  typeof paint === "object" && paint !== null ? (paint as { type?: string }).type : undefined;

/** Which tab a paint belongs on. A color, `transparent` and nothing set are all "solid". */
export function paintKind(paint: unknown): PaintKind {
  switch (tagOf(paint)) {
    case "linear-gradient":
      return "linear";
    case "radial-gradient":
      return "radial";
    case "conic-gradient":
      return "conic";
    case "image":
      return "image";
    default:
      return "solid";
  }
}

export function isGradient(paint: unknown): paint is Gradient {
  const kind = paintKind(paint);
  return kind === "linear" || kind === "radial" || kind === "conic";
}

/** A short name for a paint that isn't a plain color ("Linear gradient", "Image"). */
export function paintLabel(paint: unknown): string {
  const kind = paintKind(paint);
  if (kind === "image") return "Image";
  if (kind === "solid") return "";
  const name = PAINT_KINDS.find((k) => k.kind === kind)?.label ?? "";
  return `${name} gradient`;
}

/** A gradient of `kind` with these stops, every optional field written out (see below). */
function gradientOf(kind: GradientKind, stops: Stop[], from?: Gradient): Gradient {
  const angle = from && "angle" in from && from.angle !== undefined ? from.angle : undefined;
  const center = from && "center" in from && from.center ? from.center : CENTER;
  // Fields are always written in full: a node.update merges an object of the same type into
  // the old one, so a field left out would keep its old value instead of the default.
  switch (kind) {
    case "linear":
      return { type: GRADIENT_TYPE.linear, angle: angle ?? DEFAULT_ANGLE, stops };
    case "radial":
      return { type: GRADIENT_TYPE.radial, center, stops };
    case "conic":
      return { type: GRADIENT_TYPE.conic, angle: angle ?? 0, center, stops };
  }
}

/**
 * The paint after switching to another tab (not Image: that needs a file first).
 * - A color becomes a gradient from it to itself faded out (Figma does the same), so a
 *   theme color stays a theme color: `$color.primary` → `$color.primary/0`.
 * - A gradient keeps its stops, and its angle and center where the new kind has them.
 * - A gradient becomes its first stop's color.
 * `fallback` stands in for no color at all (nothing set, `transparent`, an image).
 */
export function convertPaint(
  paint: unknown,
  to: Exclude<PaintKind, "image">,
  fallback: string,
): Paint {
  if (paintKind(paint) === to) return paint as Paint;
  if (isGradient(paint)) {
    if (to === "solid") return paint.stops[0]?.color ?? fallback;
    return gradientOf(
      to,
      paint.stops.map((s) => ({ ...s })),
      paint,
    );
  }
  const color = typeof paint === "string" && paint !== "transparent" ? paint : fallback;
  if (to === "solid") return color;
  return gradientOf(to, [
    { offset: 0, color },
    { offset: 1, color: withOpacity(color, 0) },
  ]);
}

/** An image fill with this file, keeping the fit the current image fill has. */
export function imagePaint(assetId: string, current: unknown): ImagePaint {
  const fit = paintKind(current) === "image" ? (current as ImagePaint).fit : undefined;
  return { type: "image", asset: `asset:${assetId}`, fit: fit ?? "cover" };
}

// ── Stops ────────────────────────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** Offsets in whole tenths of a percent: no `0.30000000000000004` in the file. */
const roundOffset = (n: number) => Math.round(clamp01(n) * 1000) / 1000;

/** The gradient with `stops`, sorted, and where the stop that was at `index` is now. */
function withStops<G extends Gradient>(g: G, stops: Stop[], index: number) {
  const tagged = stops.map((stop, i) => ({ stop, i }));
  tagged.sort((a, b) => a.stop.offset - b.stop.offset || a.i - b.i);
  return {
    gradient: { ...g, stops: tagged.map((t) => t.stop) },
    index: Math.max(
      0,
      tagged.findIndex((t) => t.i === index),
    ),
  };
}

/** Stop `index` moved to `offset` (0–1). */
export function moveStop<G extends Gradient>(g: G, index: number, offset: number) {
  const stops = g.stops.map((s, i) => (i === index ? { ...s, offset: roundOffset(offset) } : s));
  return withStops(g, stops, index);
}

/** Stop `index` with a new color. */
export function recolorStop<G extends Gradient>(g: G, index: number, color: string): G {
  return { ...g, stops: g.stops.map((s, i) => (i === index ? { ...s, color } : s)) };
}

/** Without stop `index`, or null if that would leave fewer than the two a gradient needs. */
export function removeStop<G extends Gradient>(g: G, index: number): G | null {
  if (g.stops.length <= 2) return null;
  return { ...g, stops: g.stops.filter((_, i) => i !== index) };
}

/** The stops mirrored (offset → 1 − offset): the gradient runs the other way. */
export function flipStops<G extends Gradient>(g: G): G {
  const stops = g.stops.map((s) => ({ ...s, offset: roundOffset(1 - s.offset) })).reverse();
  return { ...g, stops };
}

/** The most stops a gradient holds (the schema's limit). */
export const MAX_STOPS = 16;

/** A new stop at `offset`, colored like the gradient already is there. Null when full. */
export function addStop<G extends Gradient>(g: G, offset: number, theme: Theme) {
  if (g.stops.length >= MAX_STOPS) return null;
  const at = roundOffset(offset);
  const stop = { offset: at, color: colorAt(g.stops, at, theme) };
  return withStops(g, [...g.stops, stop], g.stops.length);
}

/**
 * The color a gradient shows at `offset`. Between two stops of the same theme color it's that
 * color at the opacity in between (so it keeps following the theme); otherwise a hex mixed
 * from the two resolved colors.
 */
export function colorAt(stops: readonly Stop[], offset: number, theme: Theme): string {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const after = sorted.findIndex((s) => s.offset >= offset);
  // Before the first stop or past the last one: that stop's color.
  if (after === -1) return sorted.at(-1)?.color ?? "#000000";
  if (after === 0) return sorted[0]?.color ?? "#000000";
  const a = sorted[after - 1] as Stop;
  const b = sorted[after] as Stop;
  const t = b.offset === a.offset ? 0 : (offset - a.offset) / (b.offset - a.offset);
  const token = baseToken(a.color);
  if (token && token === baseToken(b.color)) {
    const from = opacityOf(a.color) ?? 100;
    const to = opacityOf(b.color) ?? 100;
    return withOpacity(token, from + (to - from) * t);
  }
  const ca = parseCssColor(resolveColor(theme, a.color) ?? "") ?? [0, 0, 0, 0];
  const cb = parseCssColor(resolveColor(theme, b.color) ?? "") ?? [0, 0, 0, 0];
  const mix = (i: number) => (ca[i] ?? 0) + ((cb[i] ?? 0) - (ca[i] ?? 0)) * t;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return withOpacity(`#${hex(mix(0))}${hex(mix(1))}${hex(mix(2))}`, mix(3) * 100);
}

// ── Showing a paint outside the slide ───────────────────────────────────────────────────

/** Every color in a paint resolved against the theme (the inspector has no theme variables). */
function resolvedPaint(paint: Paint, theme: Theme): Paint {
  if (typeof paint === "string") return resolveColor(theme, paint) ?? paint;
  if (!isGradient(paint)) return paint;
  const stops = paint.stops.map((s) => ({ ...s, color: resolveColor(theme, s.color) ?? s.color }));
  return { ...paint, stops } as Gradient;
}

/** CSS `background` for a chip showing this paint, or undefined for nothing set. */
export function paintCss(
  paint: unknown,
  theme: Theme,
  assetUrl: (id: string) => string,
): string | undefined {
  if (paint === undefined || paint === null) return undefined;
  const css = cssPaint(resolvedPaint(paint as Paint, theme), assetUrl);
  // A tiled image would tile at full size in a 14px chip: show it covering instead.
  return paintKind(paint) === "image" ? css.replace(/ repeat$/, " center / cover no-repeat") : css;
}

/** The stop bar's background: the gradient's stops left to right, whatever its kind. */
export function stopBarCss(g: Gradient, theme: Theme): string {
  return paintCss({ type: GRADIENT_TYPE.linear, angle: 90, stops: g.stops }, theme, () => "") ?? "";
}

// ── Files ────────────────────────────────────────────────────────────────────────────────

/**
 * A paint change as one undo step, with its files: a newly uploaded image is registered
 * first, and an image this owner was the last to use is unregistered (its bytes stay
 * restorable by undo, D65). `ownerId` is the slide or layer whose paint changes.
 */
export function withPaintAssets(
  command: Command,
  deck: Pick<Deck, "assets" | "slides">,
  ownerId: string,
  previous: unknown,
  next: unknown,
  imported?: Imported,
): Command {
  const before: Op[] = imported ? assetAddOps([imported], new Set(Object.keys(deck.assets))) : [];
  const after: Op[] = [];
  const old =
    paintKind(previous) === "image" ? parseAssetRef((previous as ImagePaint).asset) : null;
  const now = paintKind(next) === "image" ? parseAssetRef((next as ImagePaint).asset) : null;
  if (old && old !== now && Object.hasOwn(deck.assets, old)) {
    const users = assetUsage(deck as Deck).get(old) ?? [];
    // Nobody else uses it (like replacing an image's picture, `replaceAsset`).
    if (users.every((id) => id === ownerId)) after.push({ op: "asset.remove", id: old });
  }
  return { ...command, ops: [...before, ...command.ops, ...after] };
}
