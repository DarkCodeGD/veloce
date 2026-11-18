/**
 * Op builders for direct manipulation on the canvas: move, drop into a frame, resize and
 * rotate. Pure (state + intent → one Command), like model/commands.ts, so a drag sends
 * exactly the ops an agent would (golden rule #1) and stays one undo step.
 */
import type { Op, Sizing } from "@veloce/core";
import type { Command } from "./commands.js";
import type { Point } from "./geometry.js";
import { chainOf, nodeLabel, parentFrame, type SlideIndex } from "./slide-index.js";

/** Positions are stored with at most two decimals (snapped values can be fractional). */
const round2 = (v: number) => Math.round(v * 100) / 100 + 0;
const roundPoint = (p: Point): Point => ({ x: round2(p.x), y: round2(p.y) });
const samePoint = (a: Point | undefined, b: Point) => (a?.x ?? 0) === b.x && (a?.y ?? 0) === b.y;

const labelOf = (index: SlideIndex, id: string) => {
  const node = index.nodes.get(id)?.node;
  return node ? `"${nodeLabel(node)}"` : "layer";
};

/** True when the layer is placed by `position` (its parent frame is absolute). */
export function isFree(index: SlideIndex, id: string): boolean {
  return parentFrame(index, id)?.layout.mode === "absolute";
}

/** The sum of the ancestors' rotations: how much the layer's parent space is turned. */
export function ancestorRotation(index: SlideIndex, id: string): number {
  return chainOf(index, id)
    .slice(0, -1)
    .reduce((sum, a) => sum + (index.nodes.get(a)?.node.rotation ?? 0), 0);
}

/** Set the positions of free layers (layers in other frames are skipped). */
export function moveTo(index: SlideIndex, positions: ReadonlyMap<string, Point>): Command | null {
  const ops: Op[] = [];
  for (const [id, raw] of positions) {
    const node = index.nodes.get(id)?.node;
    const position = roundPoint(raw);
    if (!node || !isFree(index, id) || samePoint(node.position, position)) continue;
    ops.push({ op: "node.update", id, set: { position } });
  }
  if (ops.length === 0) return null;
  const only = ops.length === 1 ? positions.keys().next().value : undefined;
  return {
    label: only ? `Move ${labelOf(index, only)}` : `Move ${ops.length} layers`,
    ops,
  };
}

export interface DropTarget {
  parentId: string;
  /** Among the new parent's children after the layer is taken out (flow frames). */
  index?: number;
  /** In the new parent's content box (absolute frames). */
  position?: Point;
}

/**
 * Move a layer into a frame: reorder within its frame, or take it to another one. Leaving
 * an absolute frame drops the now meaningless `position`; entering one sets it.
 */
export function dropInto(index: SlideIndex, id: string, target: DropTarget): Command | null {
  const at = index.nodes.get(id);
  const parent = index.nodes.get(target.parentId)?.node;
  if (!at || at.parentId === null || parent?.kind !== "frame") return null;
  const sameParent = at.parentId === target.parentId;
  const free = parent.layout.mode === "absolute";
  const ops: Op[] = [];

  if (!sameParent || (!free && target.index !== undefined && target.index !== at.index)) {
    ops.push({
      op: "node.move",
      id,
      parentId: target.parentId,
      ...(target.index === undefined ? {} : { index: target.index }),
    });
  }
  if (free && target.position) {
    const position = roundPoint(target.position);
    if (!sameParent || !samePoint(at.node.position, position)) {
      ops.push({ op: "node.update", id, set: { position } });
    }
  } else if (!free && at.node.position && !sameParent) {
    ops.push({ op: "node.update", id, set: { position: null } });
  }
  if (ops.length === 0) return null;
  return {
    label: sameParent
      ? free
        ? `Move ${labelOf(index, id)}`
        : `Reorder ${labelOf(index, id)}`
      : `Move ${labelOf(index, id)} into ${labelOf(index, target.parentId)}`,
    ops,
    select: [id],
  };
}

export interface ResizeTarget {
  width?: number;
  height?: number;
  /** New position, for free layers whose top or left side moved. */
  position?: Point;
}

/** Fixed sizes (whole pixels, at least 1) and, for free layers, the moved position. */
export function resizeTo(index: SlideIndex, id: string, target: ResizeTarget): Command | null {
  const node = index.nodes.get(id)?.node;
  if (!node) return null;
  const set: Record<string, unknown> = {};
  const size = (v: number): Sizing => Math.max(1, Math.round(v));
  if (target.width !== undefined && size(target.width) !== node.width)
    set.width = size(target.width);
  if (target.height !== undefined && size(target.height) !== node.height)
    set.height = size(target.height);
  if (target.position && isFree(index, id)) {
    const position = roundPoint(target.position);
    if (!samePoint(node.position, position)) set.position = position;
  }
  if (Object.keys(set).length === 0) return null;
  return { label: `Resize ${labelOf(index, id)}`, ops: [{ op: "node.update", id, set }] };
}

/** Rotate a layer; 0° removes the field (the default). */
export function rotateTo(index: SlideIndex, id: string, degrees: number): Command | null {
  const node = index.nodes.get(id)?.node;
  if (!node || (node.rotation ?? 0) === degrees) return null;
  return {
    label: `Rotate ${labelOf(index, id)}`,
    ops: [{ op: "node.update", id, set: { rotation: degrees === 0 ? null : degrees } }],
  };
}
