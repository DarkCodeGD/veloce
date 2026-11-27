/**
 * Lines on the canvas (D127): drawing one and dragging its ends. A `line` element's ends are
 * fractions of its box; a free line's box hugs its two ends (plus room for the heads), so
 * dragging an end refits the box like Figma and PowerPoint. Pure maths, in slide pixels.
 */
import type { Node } from "@veloce/core";
import type { Point, Rect } from "./geometry.js";

/** Room around the ends inside the box, for heads and a comfortable hit area. */
export const LINE_PAD = 16;

const DEFAULT_FROM: Point = { x: 0, y: 0.5 };
const DEFAULT_TO: Point = { x: 1, y: 0.5 };

export type LineEndName = "from" | "to";

export const isLine = (node: Node | undefined): boolean =>
  node?.kind === "element" && node.type === "line";

/** A line's ends as fractions of its box, with the element's defaults. */
export function lineEnds(node: Node): { from: Point; to: Point } {
  const props = node.kind === "element" ? node.props : {};
  return {
    from: asPoint(props.from) ?? DEFAULT_FROM,
    to: asPoint(props.to) ?? DEFAULT_TO,
  };
}

function asPoint(v: unknown): Point | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { x, y } = v as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

/** `b` turned around `a` to the nearest 45° (Shift while drawing or dragging an end). */
export function snapAngle(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: a.x + length * Math.cos(angle), y: a.y + length * Math.sin(angle) };
}

const frac = (v: number) => Math.round(v * 10000) / 10000;

/**
 * The box for a line from `a` to `b` (whole pixels, LINE_PAD around the ends) and the ends as
 * fractions of it.
 */
export function lineBox(a: Point, b: Point): { rect: Rect; from: Point; to: Point } {
  const x = Math.floor(Math.min(a.x, b.x) - LINE_PAD);
  const y = Math.floor(Math.min(a.y, b.y) - LINE_PAD);
  const w = Math.ceil(Math.max(a.x, b.x) + LINE_PAD) - x;
  const h = Math.ceil(Math.max(a.y, b.y) + LINE_PAD) - y;
  const at = (p: Point): Point => ({ x: frac((p.x - x) / w), y: frac((p.y - y) / h) });
  return { rect: { x, y, w, h }, from: at(a), to: at(b) };
}

/** What a line measures, for the badge while drawing or dragging: "240 px · 45°". */
export function lineReadout(a: Point, b: Point): string {
  const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
  // Screen y points down; angles read the usual way (counter-clockwise from the right).
  const angle = Math.round((Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI);
  return `${length} px · ${angle === -180 ? 180 : angle}°`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * One end of a line moved to `to` (in the layer's own pixels, from its top-left corner).
 * `refit` (a free, unturned line) refits the box around both ends: the result says how far its
 * top-left moved and its new size. Otherwise the layout owns the box, and the end stays inside it.
 */
export function moveLineEnd(
  size: { w: number; h: number },
  ends: { from: Point; to: Point },
  which: LineEndName,
  to: Point,
  refit: boolean,
): { from: Point; to: Point; moved?: Point; size?: { w: number; h: number } } {
  const px = (f: Point): Point => ({ x: f.x * size.w, y: f.y * size.h });
  if (refit) {
    const a = which === "from" ? to : px(ends.from);
    const b = which === "to" ? to : px(ends.to);
    const box = lineBox(a, b);
    return {
      from: box.from,
      to: box.to,
      moved: { x: box.rect.x, y: box.rect.y },
      size: { w: box.rect.w, h: box.rect.h },
    };
  }
  const f = { x: frac(clamp01(to.x / size.w)), y: frac(clamp01(to.y / size.h)) };
  return which === "from" ? { from: f, to: ends.to } : { from: ends.from, to: f };
}
