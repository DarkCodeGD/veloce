/**
 * Anchors for free layers: which edge of the frame a layer's `position` is measured from, per
 * axis (Figma's constraints). A badge anchored to a card's top-right corner stays there when
 * the card, its padding or the badge's own text changes size.
 *
 * What `position` means on each axis (all measured inside the frame's padding, on the
 * layer's unrotated layout box; rotation turns it about its centre and changes nothing here):
 * - `"start"` (default): from the content box's left/top edge to the layer's left/top edge.
 * - `"end"`: from the content box's right/bottom edge to the layer's right/bottom edge,
 *   positive inward (like CSS `right`/`bottom`): `{ x: 16 }` is 16px in from the right.
 * - `"center"`: from the content box's centre to the layer's centre, positive right/down.
 *
 * Pure math, shared by the renderer (CSS), the editor (gestures keep working on anchored
 * layers) and anything that converts between anchors without moving the layer.
 */
import type { Anchor, AnchorEdge } from "./schema/node.js";
import type { Point } from "./schema/primitives.js";

export interface Size {
  w: number;
  h: number;
}

const AXES = [
  { axis: "x", size: "w" },
  { axis: "y", size: "h" },
] as const;

const edgeOf = (anchor: Anchor | undefined, axis: "x" | "y"): AnchorEdge =>
  anchor?.[axis] ?? "start";

/**
 * The anchored position after the layer's start (left/top) edge moved by `d` and its size
 * grew by `grow`: what a drag, a nudge or a resize does, expressed in the layer's anchor.
 * A plain move flips sign on `"end"` axes; a resize from the start edge keeps an `"end"`
 * anchored layer's far edge, so its position doesn't change.
 */
export function shiftAnchored(
  position: Point,
  anchor: Anchor | undefined,
  d: Point,
  grow: Size = { w: 0, h: 0 },
): Point {
  const out = { ...position };
  for (const { axis, size } of AXES) {
    const edge = edgeOf(anchor, axis);
    if (edge === "start") out[axis] = position[axis] + d[axis];
    else if (edge === "end") out[axis] = position[axis] - d[axis] - grow[size];
    else out[axis] = position[axis] + d[axis] + grow[size] / 2;
  }
  return out;
}

/** Where the layer's start (left/top) edge is in the content box, from an anchored position. */
export function startPosition(
  position: Point,
  anchor: Anchor | undefined,
  size: Size,
  content: Size,
): Point {
  const out = { ...position };
  for (const { axis, size: s } of AXES) {
    const edge = edgeOf(anchor, axis);
    if (edge === "end") out[axis] = content[s] - position[axis] - size[s];
    else if (edge === "center") out[axis] = content[s] / 2 + position[axis] - size[s] / 2;
  }
  return out;
}

/** The position, in `anchor`, of a layer whose start (left/top) edge is at `start`. */
export function anchoredPosition(
  start: Point,
  anchor: Anchor | undefined,
  size: Size,
  content: Size,
): Point {
  const out = { ...start };
  for (const { axis, size: s } of AXES) {
    const edge = edgeOf(anchor, axis);
    if (edge === "end") out[axis] = content[s] - start[axis] - size[s];
    else if (edge === "center") out[axis] = start[axis] + size[s] / 2 - content[s] / 2;
  }
  return out;
}
