/**
 * Where a dragged layer lands inside an auto-layout frame. Pure, in slide pixels.
 *
 * `siblings` are the frame's other children (the dragged one excluded), in order, with the
 * rectangles they had when the frame became the drop target. Using those fixed rectangles,
 * not the live preview (where the layout reflows around the dragged layer), keeps the target
 * from flickering between two slots.
 */
import type { Point, Rect } from "./geometry.js";

export type FlowAxis = "row" | "column" | "grid";

const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The index (among `siblings`) at which a layer dropped at `pointer` is inserted. */
export function insertionIndex(pointer: Point, siblings: readonly Rect[], axis: FlowAxis): number {
  if (siblings.length === 0) return 0;
  if (axis === "row") return siblings.filter((r) => centre(r).x < pointer.x).length;
  if (axis === "column") return siblings.filter((r) => centre(r).y < pointer.y).length;

  // Grid (and wrapping stacks): before or after the nearest cell, by which half the
  // pointer is in. Cells in the same row compare horizontally; otherwise vertically.
  let nearest = 0;
  let best = Number.POSITIVE_INFINITY;
  for (const [i, r] of siblings.entries()) {
    const c = centre(r);
    const d = (c.x - pointer.x) ** 2 + (c.y - pointer.y) ** 2;
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  const cell = siblings[nearest] as Rect;
  const sameRow = pointer.y >= cell.y && pointer.y <= cell.y + cell.h;
  const after = sameRow ? pointer.x > centre(cell).x : pointer.y > centre(cell).y;
  return nearest + (after ? 1 : 0);
}

/**
 * Whether a pointer over a frame should drop *into* it, or be treated as hovering its edge
 * (drop beside it, in its parent). The edge band is a fraction of the frame's size along
 * the parent's flow axis, capped in pixels, so small frames still accept drops.
 */
export function insideDropZone(
  pointer: Point,
  frame: Rect,
  parentAxis: FlowAxis | "absolute",
  band: number,
): boolean {
  if (parentAxis === "absolute" || parentAxis === "grid") return true;
  const [pos, start, size] =
    parentAxis === "row" ? [pointer.x, frame.x, frame.w] : [pointer.y, frame.y, frame.h];
  const edge = Math.min(band, size / 4);
  return pos > start + edge && pos < start + size - edge;
}

/** A frame as it was laid out when a drag started (slide pixels). */
export interface FrameSnapshot {
  id: string;
  parentId: string | null;
  depth: number;
  /** Border box. */
  rect: Rect;
  /** Inside the padding: where absolute children's `position` is measured from. */
  content: Rect;
  flow: FlowAxis | "absolute";
  /** Locked frames don't accept drops. */
  locked: boolean;
  /** `free`: out of the flow (placed by `position`), so not a slot to insert between. */
  children: ReadonlyArray<{ id: string; rect: Rect; free: boolean }>;
}

/**
 * Turn a slot among a frame's flowing children into an index among all its children (both
 * without the dragged layer). Free layers aren't slots: a layer dropped after the last
 * flowing one goes right after it, before any free layers, so those stay drawn on top.
 */
export function childIndexForSlot(
  children: ReadonlyArray<{ free: boolean }>,
  slot: number,
): number {
  const flowing = children.flatMap((c, i) => (c.free ? [] : [i]));
  const before = flowing[slot];
  if (before !== undefined) return before;
  const last = flowing.at(-1);
  return last === undefined ? 0 : last + 1;
}

/**
 * The frame a layer dropped at `pointer` goes into: the innermost frame under the pointer,
 * except near the edge of a frame that sits in a row or column, which means "beside it"
 * (its parent). Uses the rectangles frozen at drag start, so the live preview reflowing
 * the layout can't make the target oscillate. `null` when the pointer is off the slide.
 */
export function dropTarget(
  frames: readonly FrameSnapshot[],
  pointer: Point,
  band: number,
): FrameSnapshot | null {
  const inside = (r: Rect) =>
    pointer.x >= r.x && pointer.x <= r.x + r.w && pointer.y >= r.y && pointer.y <= r.y + r.h;
  const byId = new Map(frames.map((f) => [f.id, f]));
  // Deepest first; among equals, the later one (painted on top).
  let target: FrameSnapshot | null = null;
  for (const f of frames) {
    if (!f.locked && inside(f.rect) && (!target || f.depth >= target.depth)) target = f;
  }
  const parent = target?.parentId ? byId.get(target.parentId) : undefined;
  if (
    target &&
    parent &&
    !parent.locked &&
    !insideDropZone(pointer, target.rect, parent.flow, band)
  ) {
    return parent;
  }
  return target;
}

/**
 * Where to draw the insertion line for dropping at `index` among `siblings` (the target's
 * children without the dragged layer), as a segment in slide pixels.
 */
export function insertionLine(
  siblings: readonly Rect[],
  index: number,
  axis: FlowAxis,
  content: Rect,
): { x1: number; y1: number; x2: number; y2: number } {
  const before = siblings[index - 1];
  const after = siblings[index];
  // Grid: a vertical line beside the cell (before the next one, or after the previous one).
  const horizontal = axis === "row" || axis === "grid";
  if (horizontal) {
    const ref = after ?? before;
    const x = after
      ? before && Math.abs(before.y - after.y) < 1
        ? (before.x + before.w + after.x) / 2
        : after.x
      : before
        ? before.x + before.w
        : content.x;
    const y1 = ref ? ref.y : content.y;
    const h = ref ? ref.h : content.h;
    return { x1: x, y1, x2: x, y2: y1 + h };
  }
  const y = after
    ? before
      ? (before.y + before.h + after.y) / 2
      : after.y
    : before
      ? before.y + before.h
      : content.y;
  return { x1: content.x, y1: y, x2: content.x + content.w, y2: y };
}
