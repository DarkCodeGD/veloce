/**
 * Align and distribute (Figma's alignment bar) for free layers: layers placed by their own
 * `position`, in absolute frames or `positioning: "free"`. Layers in a stack's or grid's flow
 * are placed by the layout (golden rule #4), so their frame's align/justify is the tool there.
 *
 * Geometry happens on the slide, in the boxes layers cover on screen (rotation included),
 * so layers in different frames align with each other. Each layer's on-slide shift is then
 * turned into its parent's space (undoing ancestor rotation) and added to its `position`:
 * one `node.update` per layer that actually moves, one transaction (golden rules #1, #7).
 *
 * A free layer that fills its frame along an axis (text does by default: `width: "fill"`)
 * stretches to the frame's far edge, so moving it along that axis would resize it. Moving
 * bakes that size to its rendered pixels instead (the rule D49/D50 use for going free), so
 * it keeps its size; a layer that doesn't move keeps its "fill".
 */
import type { Op } from "@veloce/core";
import type { Command } from "./commands.js";
import type { Point, Rect } from "./geometry.js";
import { ancestorRotation, isFree, movedPosition } from "./manipulate.js";
import { nodeLabel, type SlideIndex, topmost } from "./slide-index.js";

export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

/** A layer as measured on the canvas. */
export interface LayerBox {
  /** The box it covers on the slide (rotation included). */
  rect: Rect;
  /** Its own pixel size on the axes where its sizing is `"fill"` (baked when it moves). */
  fill?: { width?: number; height?: number };
}

const EDGE_WORDS: Record<AlignEdge, string> = {
  left: "left",
  center: "to horizontal centers",
  right: "right",
  top: "top",
  middle: "to vertical centers",
  bottom: "bottom",
};

const round2 = (v: number) => Math.round(v * 100) / 100 + 0;

/**
 * The layers alignment acts on: the topmost selected ones, when every one of them is free.
 * Empty when any selected layer sits in a flow (or is the slide's root): the inspector hides
 * the alignment bar then, and the shortcuts do nothing.
 */
export function alignable(index: SlideIndex, ids: readonly string[]): string[] {
  const layers = topmost(
    index,
    ids.filter((id) => index.nodes.has(id)),
  );
  return layers.length > 0 && layers.every((id) => id !== index.rootId && isFree(index, id))
    ? layers
    : [];
}

/** An on-slide shift, in the layer's parent space (rotated frames turn their children). */
function localShift(index: SlideIndex, id: string, d: Point): Point {
  const rad = (-ancestorRotation(index, id) * Math.PI) / 180;
  if (rad === 0) return d;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: d.x * cos - d.y * sin, y: d.x * sin + d.y * cos };
}

/** Shift each layer by its on-slide delta; null when nothing moves. */
function shiftBy(
  index: SlideIndex,
  deltas: Map<string, Point>,
  boxes: ReadonlyMap<string, LayerBox>,
  label: string,
): Command | null {
  const ops: Op[] = [];
  for (const [id, d] of deltas) {
    const node = index.nodes.get(id)?.node;
    if (!node) continue;
    const moved = movedPosition(node, localShift(index, id, d)); // in the layer's anchor
    const position = { x: round2(moved.x), y: round2(moved.y) };
    const movedX = position.x !== (node.position?.x ?? 0);
    const movedY = position.y !== (node.position?.y ?? 0);
    if (!movedX && !movedY) continue;
    const set: Record<string, unknown> = { position };
    const fill = boxes.get(id)?.fill;
    if (movedX && fill?.width !== undefined) set.width = Math.max(1, Math.round(fill.width));
    if (movedY && fill?.height !== undefined) set.height = Math.max(1, Math.round(fill.height));
    ops.push({ op: "node.update", id, set });
  }
  return ops.length > 0 ? { label, ops, select: [...deltas.keys()] } : null;
}

const union = (rects: Rect[]): Rect => {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * Align the selected free layers along one edge or center line of their combined box, or,
 * for a single layer, of `container` (its parent frame's content box, as Figma does).
 * `measured` holds the layers as measured on the canvas.
 */
export function alignLayers(
  index: SlideIndex,
  ids: readonly string[],
  edge: AlignEdge,
  measured: ReadonlyMap<string, LayerBox>,
  container?: Rect,
): Command | null {
  const layers = alignable(index, ids).filter((id) => measured.has(id));
  const boxes = layers.map((id) => ({ id, r: (measured.get(id) as LayerBox).rect }));
  if (boxes.length === 0 || (boxes.length === 1 && !container)) return null;
  const target = boxes.length === 1 && container ? container : union(boxes.map((b) => b.r));

  const deltas = new Map<string, Point>();
  for (const { id, r } of boxes) {
    const d: Point = { x: 0, y: 0 };
    if (edge === "left") d.x = target.x - r.x;
    if (edge === "center") d.x = target.x + target.w / 2 - (r.x + r.w / 2);
    if (edge === "right") d.x = target.x + target.w - (r.x + r.w);
    if (edge === "top") d.y = target.y - r.y;
    if (edge === "middle") d.y = target.y + target.h / 2 - (r.y + r.h / 2);
    if (edge === "bottom") d.y = target.y + target.h - (r.y + r.h);
    deltas.set(id, d);
  }
  const only = boxes.length === 1 ? index.nodes.get(boxes[0]?.id ?? "")?.node : undefined;
  const what = only ? `"${nodeLabel(only)}"` : `${boxes.length} layers`;
  return shiftBy(index, deltas, measured, `Align ${what} ${EDGE_WORDS[edge]}`);
}

/**
 * Space three or more free layers evenly: the first and last (by position along the axis)
 * stay put, and the ones between move so the gaps between neighbours are equal (Figma's
 * "distribute spacing"; boxes of different sizes still get equal gaps).
 */
export function distributeLayers(
  index: SlideIndex,
  ids: readonly string[],
  axis: DistributeAxis,
  measured: ReadonlyMap<string, LayerBox>,
): Command | null {
  const layers = alignable(index, ids).filter((id) => measured.has(id));
  if (layers.length < 3) return null;
  const [start, size] = axis === "horizontal" ? (["x", "w"] as const) : (["y", "h"] as const);
  const boxes = layers
    .map((id) => ({ id, r: (measured.get(id) as LayerBox).rect }))
    .sort((a, b) => a.r[start] - b.r[start] || a.r[size] - b.r[size]);
  const first = boxes[0]?.r as Rect;
  const end = Math.max(...boxes.map((b) => b.r[start] + b.r[size]));
  const filled = boxes.reduce((sum, b) => sum + b.r[size], 0);
  const gap = (end - first[start] - filled) / (boxes.length - 1);

  const deltas = new Map<string, Point>();
  let at = first[start];
  for (const { id, r } of boxes) {
    const shift = at - r[start];
    deltas.set(id, axis === "horizontal" ? { x: shift, y: 0 } : { x: 0, y: shift });
    at += r[size] + gap;
  }
  return shiftBy(index, deltas, measured, `Distribute ${boxes.length} layers ${axis}ly`);
}
