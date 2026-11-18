/**
 * Snapping for moving and resizing inside free (absolute) frames: a moving box's edges and
 * centre snap to its siblings' edges and centres and to the frame's content box. Pure, in
 * slide pixels; the threshold comes in already converted from screen pixels.
 */
import type { Rect } from "./geometry.js";

/** A guide line to draw: `axis: "x"` is a vertical line at x = `at`, from y = `from` to `to`. */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

const lines = (r: Rect, axis: "x" | "y") =>
  axis === "x" ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h];

/**
 * The smallest correction (within `threshold`) that puts one of `moving` onto one of
 * `targets`; `null` if none is close enough.
 */
export function snapAxis(
  moving: readonly number[],
  targets: readonly number[],
  threshold: number,
): number | null {
  let best: number | null = null;
  for (const m of moving) {
    for (const t of targets) {
      const d = t - m;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

/** Guides for every target line that the (already snapped) rectangle now touches. */
export function guidesFor(
  rect: Rect,
  targets: readonly Rect[],
  axes: { x: boolean; y: boolean },
): Guide[] {
  const guides: Guide[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  for (const axis of ["x", "y"] as const) {
    if (!axes[axis]) continue;
    const other = axis === "x" ? "y" : "x";
    const size = other === "x" ? "w" : "h";
    for (const at of lines(rect, axis)) {
      const touching = targets.filter((t) => lines(t, axis).some((l) => near(l, at)));
      if (touching.length === 0) continue;
      const spans = [rect, ...touching].flatMap((r) => [r[other], r[other] + r[size]]);
      const guide = { axis, at, from: Math.min(...spans), to: Math.max(...spans) };
      if (!guides.some((g) => g.axis === axis && near(g.at, at))) guides.push(guide);
    }
  }
  return guides;
}

/** Snap a moving rectangle to the targets; returns the correction and the guides to show. */
export function snapMove(
  moving: Rect,
  targets: readonly Rect[],
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const dx = snapAxis(
    lines(moving, "x"),
    targets.flatMap((t) => lines(t, "x")),
    threshold,
  );
  const dy = snapAxis(
    lines(moving, "y"),
    targets.flatMap((t) => lines(t, "y")),
    threshold,
  );
  const snapped = { ...moving, x: moving.x + (dx ?? 0), y: moving.y + (dy ?? 0) };
  return {
    dx: dx ?? 0,
    dy: dy ?? 0,
    guides: guidesFor(snapped, targets, { x: dx !== null, y: dy !== null }),
  };
}
