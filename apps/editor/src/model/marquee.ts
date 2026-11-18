/**
 * Marquee (box) selection: drag on the empty canvas to select every layer the box touches.
 * Pure, in slide pixels. Which layers can be caught:
 * - normally the top-level layers (what a click would pick: cards, not the text inside);
 * - with Ctrl/Cmd, the deepest ones (elements and empty frames), like Figma.
 * Locked and hidden layers (or ones inside a locked/hidden frame) are never caught.
 */
import type { Point, Rect } from "./geometry.js";
import type { SlideIndex } from "./slide-index.js";

/** The rectangle between two corners, whichever way it was dragged. */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** True when the rectangles overlap or touch. */
export const intersects = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** The layers a marquee may catch, in document order. */
export function marqueeCandidates(index: SlideIndex, deep: boolean): string[] {
  const out: string[] = [];
  const root = index.nodes.get(index.rootId)?.node;
  const visit = (id: string) => {
    const node = index.nodes.get(id)?.node;
    if (!node || node.locked || node.hidden) return; // and everything inside it
    const children = node.kind === "frame" ? node.children : [];
    if (deep && children.length > 0) for (const child of children) visit(child.id);
    else out.push(id);
  };
  if (root?.kind === "frame") for (const child of root.children) visit(child.id);
  return out;
}

/** The candidates whose box the marquee touches. */
export function marqueeHits(
  candidates: ReadonlyArray<{ id: string; rect: Rect }>,
  area: Rect,
): string[] {
  return candidates.filter((c) => intersects(c.rect, area)).map((c) => c.id);
}
