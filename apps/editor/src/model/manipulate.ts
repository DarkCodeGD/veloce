/**
 * Op builders for direct manipulation on the canvas: move, drop into a frame, resize and
 * rotate. Pure (state + intent → one Command), like model/commands.ts, so a drag sends
 * exactly the ops an agent would (golden rule #1) and stays one undo step.
 */
import { isFreeLayer, type Layout, type Node, type Op, type Sizing } from "@veloce/core";
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

/**
 * True when the layer is placed by `position`: its parent frame is absolute, or it's a
 * `positioning: "free"` layer in a stack or grid.
 */
export function isFree(index: SlideIndex, id: string): boolean {
  const parent = parentFrame(index, id);
  const node = index.nodes.get(id)?.node;
  return parent !== null && node !== undefined && isFreeLayer(node, parent.layout);
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
 * for a stack or grid drops the now meaningless `position`; entering an absolute frame sets
 * it. A free layer moving within its own stack or grid moves by `position`. Changing frames
 * resets `positioning`: "free" was about the frame it was freed in.
 */
export function dropInto(index: SlideIndex, id: string, target: DropTarget): Command | null {
  const at = index.nodes.get(id);
  const parent = index.nodes.get(target.parentId)?.node;
  if (!at || at.parentId === null || parent?.kind !== "frame") return null;
  const sameParent = at.parentId === target.parentId;
  const free = parent.layout.mode === "absolute" || (sameParent && isFree(index, id));
  const ops: Op[] = [];

  if (!sameParent || (!free && target.index !== undefined && target.index !== at.index)) {
    ops.push({
      op: "node.move",
      id,
      parentId: target.parentId,
      ...(target.index === undefined ? {} : { index: target.index }),
    });
  }
  const set: Record<string, unknown> = {};
  if (free && target.position) {
    const position = roundPoint(target.position);
    if (!sameParent || !samePoint(at.node.position, position)) set.position = position;
  } else if (!free && at.node.position && !sameParent) {
    set.position = null;
  }
  if (!sameParent && at.node.positioning !== undefined) set.positioning = null;
  if (Object.keys(set).length > 0) ops.push({ op: "node.update", id, set });
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

// ── Free positioning ────────────────────────────────────────────────────────────────

/** A sizing as the renderer resolves it: the node's own, else its plugin's default. */
export type ResolvedSizing = Sizing | "auto";

/**
 * Whether `parent` stretches its child along `axis` when the child's sizing is `"auto"`: a
 * stack's cross axis with `align: "stretch"`, a grid cell's width, a grid row's height
 * (unless aligned). Absolute frames never stretch anything.
 */
export function stretchedBy(parent: Layout, axis: "width" | "height"): boolean {
  if (parent.mode === "absolute") return false;
  const align = parent.align ?? "stretch";
  if (parent.mode === "grid") return axis === "width" || align === "stretch";
  const main = (parent.direction ?? "column") === "row" ? "width" : "height";
  return axis !== main && align === "stretch";
}

/**
 * The sizes a layer needs to keep its on-screen size once it leaves its stack/grid flow.
 * Outside the flow nothing stretches it any more, so whatever was stretched is baked to the
 * rendered pixels: `"fill"`, and `"auto"` where the parent stretched it (`stretchedBy`).
 * `"auto"` that was fitting its content becomes `"hug"`, which is what it was doing. Fixed
 * and hug sizes stay.
 */
export function freeSizing(
  parent: Layout,
  sizing: { width: ResolvedSizing; height: ResolvedSizing },
  rendered: { w: number; h: number },
): { width?: Sizing; height?: Sizing } {
  const out: { width?: Sizing; height?: Sizing } = {};
  for (const axis of ["width", "height"] as const) {
    const v = sizing[axis];
    const px = Math.max(1, Math.round(axis === "width" ? rendered.w : rendered.h));
    if (v === "fill") out[axis] = px;
    else if (v === "auto") out[axis] = stretchedBy(parent, axis) ? px : "hug";
  }
  return out;
}

/** A layer as measured on the canvas when an edit starts. */
export interface Measured {
  /** Where its layout box sits in its parent's content box (slide pixels). */
  position: Point;
  rendered: { w: number; h: number };
  sizing: { width: ResolvedSizing; height: ResolvedSizing };
}

/**
 * The extra ops that keep everything in place when a stack or grid frame becomes absolute
 * ("Free"): each child gets its measured position and the sizes the flow was stretching
 * (`freeSizing`); children that were already free keep their position and drop the now
 * redundant flag. The frame itself gets its pixel size wherever it was fitting its content,
 * since free children no longer give it any. Children that can't be measured (hidden ones)
 * are left alone. Empty for the root, absolute frames, and frames that aren't there.
 */
export function freezeFrameOps(
  index: SlideIndex,
  frameId: string,
  measure: (id: string) => Measured | null,
): Op[] {
  const frame = index.nodes.get(frameId)?.node;
  if (frame?.kind !== "frame" || frame.layout.mode === "absolute") return [];
  const ops: Op[] = [];

  const parent = parentFrame(index, frameId);
  const self = parent ? measure(frameId) : null;
  if (parent && self) {
    const set: Record<string, unknown> = {};
    for (const axis of ["width", "height"] as const) {
      const v = self.sizing[axis];
      const fits = v === "hug" || (v === "auto" && !stretchedBy(parent.layout, axis));
      if (fits)
        set[axis] = Math.max(1, Math.round(axis === "width" ? self.rendered.w : self.rendered.h));
    }
    if (Object.keys(set).length > 0) ops.push({ op: "node.update", id: frameId, set });
  }

  for (const child of frame.children) {
    if (isFreeLayer(child, frame.layout)) {
      ops.push({ op: "node.update", id: child.id, set: { positioning: null } });
      continue;
    }
    const m = measure(child.id);
    if (!m) continue;
    const set: Record<string, unknown> = { position: roundPoint(m.position) };
    for (const [key, value] of Object.entries(freeSizing(frame.layout, m.sizing, m.rendered))) {
      if (child[key as keyof Node] !== value) set[key] = value;
    }
    ops.push({ op: "node.update", id: child.id, set });
  }
  return ops;
}

/**
 * Change a frame's layout mode as one transaction. The new layout is sent whole: core
 * replaces a layout object whose `mode` changes (the discriminator rule in json.ts), so a
 * partial patch would lose `padding`. Padding carries over, and gap too between stack and
 * grid. Into absolute ("Free"), everything stays where it was (`freezeFrameOps`). Out of
 * absolute, the positions the flow now ignores are removed (except on free layers).
 */
export function switchLayout(
  index: SlideIndex,
  frameId: string,
  mode: Layout["mode"],
  measure: (id: string) => Measured | null,
): Command | null {
  const frame = index.nodes.get(frameId)?.node;
  if (frame?.kind !== "frame" || frame.layout.mode === mode) return null;
  const from = frame.layout;
  const padding = from.padding === undefined ? {} : { padding: from.padding };
  const gap = from.mode !== "absolute" && from.gap !== undefined ? { gap: from.gap } : {};
  const layout: Layout =
    mode === "grid"
      ? { mode, columns: 2, ...gap, ...padding }
      : mode === "stack"
        ? { mode, ...gap, ...padding }
        : { mode, ...padding };
  const ops: Op[] = [{ op: "node.update", id: frameId, set: { layout } }];
  if (mode === "absolute") ops.push(...freezeFrameOps(index, frameId, measure));
  if (from.mode === "absolute") {
    for (const child of frame.children) {
      if (child.position && child.positioning !== "free") {
        ops.push({ op: "node.update", id: child.id, set: { position: null } });
      }
    }
  }
  return { label: `Change layout to ${mode}`, ops };
}

/**
 * Take a layer out of its stack/grid flow (`positioning: "free"`) at `position`, keeping its
 * size (see `freeSizing`). One transaction, so Ctrl+Z puts it straight back in the flow.
 */
export function placeFreely(
  index: SlideIndex,
  id: string,
  position: Point,
  size: { width?: Sizing; height?: Sizing } = {},
): Command | null {
  const node = index.nodes.get(id)?.node;
  const parent = parentFrame(index, id);
  if (!node || !parent || parent.layout.mode === "absolute" || node.positioning === "free") {
    return null;
  }
  const set: Record<string, unknown> = { positioning: "free", position: roundPoint(position) };
  for (const [key, value] of Object.entries(size))
    if (node[key as keyof Node] !== value) set[key] = value;
  return {
    label: `Place ${labelOf(index, id)} freely`,
    ops: [{ op: "node.update", id, set }],
    select: [id],
  };
}

/** Put a free layer back into its stack/grid flow (where its index in the frame says). */
export function placeInFlow(index: SlideIndex, id: string): Command | null {
  const node = index.nodes.get(id)?.node;
  if (node?.positioning !== "free") return null;
  return {
    label: `Put ${labelOf(index, id)} back in the layout`,
    ops: [{ op: "node.update", id, set: { positioning: null, position: null } }],
    select: [id],
  };
}
