/**
 * Group and ungroup (Ctrl+G / Ctrl+Shift+G): wrap layers in a new frame, or dissolve a frame
 * into its parent. Pure op builders like manipulate.ts: the editor sends exactly the ops an
 * agent could (`node.insert` + `node.move` + `node.update` + `node.remove`), as one
 * transaction, so one Ctrl+Z puts everything back (golden rules #1 and #7).
 *
 * The promise both ways: **nothing moves on the slide** where the layout allows it.
 * - Layers placed by the flow of a stack or grid are wrapped in a frame with the same
 *   layout (a "flow group"), which takes the first layer's slot.
 * - Layers placed freely (in an absolute frame, or `positioning: "free"`) are wrapped in an
 *   absolute frame cut to their bounding box (a "free group"), so every child keeps its
 *   on-screen spot; only the coordinates are rebased onto the group.
 * - Ungrouping keeps every child's pixels whenever it ends up placed freely; layers that go
 *   from one flow into another simply join the parent's flow (that's what ungroup means).
 */
import {
  createId,
  type FrameNode,
  isFreeLayer,
  type Layout,
  type Op,
  type Sizing,
} from "@veloce/core";
import type { Command } from "./commands.js";
import type { Point } from "./geometry.js";
import { freeSizing, type ResolvedSizing } from "./manipulate.js";
import { nodeLabel, parentFrame, type SlideIndex, topmost } from "./slide-index.js";

/** What grouping needs to know about the slide as it's rendered right now. */
export interface GroupMeasure {
  /** The layer's own size before rotation (what `width`/`height` describe), or null if hidden. */
  size(id: string): { w: number; h: number } | null;
  /** How the layer's `width`/`height` resolve (its own, else its plugin's default). */
  sizing(id: string): { width: ResolvedSizing; height: ResolvedSizing };
  /**
   * The `position` that keeps the layer's on-screen spot as a free child of `frameId` (from
   * that frame's content box, rotation included), or null when it can't be measured.
   */
  positionIn(id: string, frameId: string): Point | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100 + 0;
const plural = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);
const quoted = (index: SlideIndex, id: string) => {
  const node = index.nodes.get(id)?.node;
  return node ? `"${nodeLabel(node)}"` : "layer";
};

/** The layers a group would wrap: the topmost selected ones (not the root), in document order. */
export function groupMembers(index: SlideIndex, ids: readonly string[]): string[] {
  const picked = topmost(
    index,
    ids.filter((id) => id !== index.rootId && index.nodes.has(id)),
  );
  return picked.sort((a, b) => (index.nodes.get(a)?.index ?? 0) - (index.nodes.get(b)?.index ?? 0));
}

/**
 * Why the selection can't be grouped, in words for a toast, or null when it can. An empty
 * selection (or only the slide's root) is also null: there's nothing to say, `groupLayers`
 * just returns null.
 */
export function groupBlocker(index: SlideIndex, ids: readonly string[]): string | null {
  const layers = groupMembers(index, ids);
  if (layers.length === 0) return null;
  const parents = new Set(layers.map((id) => index.nodes.get(id)?.parentId));
  if (parents.size > 1) {
    return "Group layers that are in the same frame (drag them into one frame first).";
  }
  const parent = parentFrame(index, layers[0] ?? "");
  if (!parent) return null;
  const free = layers.map((id) => isFreeLayer(index.nodes.get(id)?.node ?? {}, parent.layout));
  if (free.some(Boolean) && !free.every(Boolean)) {
    return "Group layers that are all in the layout, or all placed freely, not a mix.";
  }
  return null;
}

/**
 * Wrap the selected layers in a new frame named "Group" (see the file comment for the two
 * kinds), and select it. Null when there's nothing to group or `groupBlocker` objects.
 */
export function groupLayers(
  index: SlideIndex,
  ids: readonly string[],
  measure: GroupMeasure,
): Command | null {
  const layers = groupMembers(index, ids);
  const first = layers[0];
  const parent = first ? parentFrame(index, first) : null;
  if (!first || !parent || groupBlocker(index, ids) !== null) return null;

  const free = isFreeLayer(index.nodes.get(first)?.node ?? {}, parent.layout);
  const ops = free
    ? freeGroupOps(index, layers, parent, measure)
    : flowGroupOps(index, layers, parent);
  const insert = ops[0];
  const groupId = insert?.op === "node.insert" ? insert.node.id : "";
  return {
    label: layers.length === 1 ? `Group ${quoted(index, first)}` : `Group ${layers.length} layers`,
    ops,
    select: [groupId],
  };
}

/** The group's own layout when it wraps flow children: the same kind of flow as its parent. */
function flowLayoutLike(parent: Layout, count: number): Layout {
  const gap = parent.mode !== "absolute" && parent.gap !== undefined ? { gap: parent.gap } : {};
  const align = parent.mode !== "absolute" && parent.align ? { align: parent.align } : {};
  if (parent.mode === "grid") {
    const rowGap = parent.rowGap === undefined ? {} : { rowGap: parent.rowGap };
    // The group fills one cell, so its own grid only needs as many columns as it has items.
    const justify = parent.justify ? { justify: parent.justify } : {};
    return {
      mode: "grid",
      columns: Math.min(count, parent.columns),
      ...gap,
      ...rowGap,
      ...align,
      ...justify,
    };
  }
  const stack = parent.mode === "stack" ? parent : null;
  return {
    mode: "stack",
    ...(stack?.direction ? { direction: stack.direction } : {}),
    ...gap,
    ...align,
    ...(stack?.wrap ? { wrap: true } : {}),
  };
}

/**
 * A flow group takes the first layer's slot. Its size is left to the parent's layout ("auto":
 * stretched across where the parent stretches, fitted to its content along the flow), except
 * along a stack's main axis when a member fills it: then the group fills, and the member
 * fills the group, so the space is still taken.
 */
function flowGroupOps(index: SlideIndex, layers: string[], parent: FrameNode): Op[] {
  const group: FrameNode = {
    id: createId("nd"),
    kind: "frame",
    name: "Group",
    layout: flowLayoutLike(parent.layout, layers.length),
    children: [],
  };
  if (parent.layout.mode === "stack") {
    const main = (parent.layout.direction ?? "column") === "row" ? "width" : "height";
    if (layers.some((id) => index.nodes.get(id)?.node[main] === "fill")) group[main] = "fill";
  }
  const at = index.nodes.get(layers[0] ?? "")?.index ?? 0;
  return [
    { op: "node.insert", parentId: parent.id, node: group, index: at },
    ...layers.map((id, i): Op => ({ op: "node.move", id, parentId: group.id, index: i })),
  ];
}

/** A layer's box on its parent, rotation included: the corners of its rotated layout box. */
export function rotatedBounds(position: Point, size: { w: number; h: number }, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfW = (size.w * cos + size.h * sin) / 2;
  const halfH = (size.w * sin + size.h * cos) / 2;
  const cx = position.x + size.w / 2;
  const cy = position.y + size.h / 2;
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
}

/**
 * A free group is an absolute frame cut to the members' bounding box (rotation included),
 * placed at that box's corner; every member's position is rebased onto it, so nothing moves.
 * It goes where the frontmost member was, so it stays in front of the layers it was in front
 * of. Sizes that filled the old parent are baked to their pixels (the group is smaller).
 */
/** A free layer as measured on its frame: where it sits, its size, and its rotated box. */
export interface FreeBox {
  id: string;
  position: Point;
  size: { w: number; h: number };
  /** False when the layer couldn't be measured (hidden), so `size` comes from the document. */
  measured: boolean;
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/** Measure free layers of the frame `parentId` (shared by free groups and auto layout). */
export function freeBoxes(
  index: SlideIndex,
  layers: readonly string[],
  parentId: string,
  measure: GroupMeasure,
): FreeBox[] {
  return layers.map((id) => {
    const node = index.nodes.get(id)?.node;
    // Anchored layers are measured from the left/top like the rest (the group is new: its
    // members start out anchored to its top-left).
    const stored = { x: node?.position?.x ?? 0, y: node?.position?.y ?? 0 };
    const position = node?.anchor ? (measure.positionIn(id, parentId) ?? stored) : stored;
    const fixed = (v: Sizing | undefined) => (typeof v === "number" ? v : 0);
    const measured = measure.size(id);
    const size = measured ?? { w: fixed(node?.width), h: fixed(node?.height) };
    const bounds = rotatedBounds(position, size, node?.rotation ?? 0);
    return { id, position, size, measured: measured !== null, bounds };
  });
}

function freeGroupOps(
  index: SlideIndex,
  layers: string[],
  parent: FrameNode,
  measure: GroupMeasure,
): Op[] {
  const boxes = freeBoxes(index, layers, parent.id, measure);
  const x0 = Math.floor(Math.min(...boxes.map((b) => b.bounds.x0)));
  const y0 = Math.floor(Math.min(...boxes.map((b) => b.bounds.y0)));
  const x1 = Math.ceil(Math.max(...boxes.map((b) => b.bounds.x1)));
  const y1 = Math.ceil(Math.max(...boxes.map((b) => b.bounds.y1)));

  const group: FrameNode = {
    id: createId("nd"),
    kind: "frame",
    name: "Group",
    layout: { mode: "absolute" },
    ...(parent.layout.mode === "absolute" ? {} : { positioning: "free" as const }),
    position: { x: x0, y: y0 },
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
    children: [],
  };
  const frontmost = Math.max(...layers.map((id) => index.nodes.get(id)?.index ?? 0));
  const ops: Op[] = [{ op: "node.insert", parentId: parent.id, node: group, index: frontmost + 1 }];
  for (const [i, box] of boxes.entries()) {
    ops.push({ op: "node.move", id: box.id, parentId: group.id, index: i });
  }
  for (const box of boxes) {
    const node = index.nodes.get(box.id)?.node;
    const set: Record<string, unknown> = {
      position: { x: round2(box.position.x - x0), y: round2(box.position.y - y0) },
    };
    if (node?.positioning !== undefined) set.positioning = null; // always free in an absolute frame
    if (node?.anchor !== undefined) set.anchor = null;
    Object.assign(set, bakedFill(box, measure));
    ops.push({ op: "node.update", id: box.id, set });
  }
  return ops;
}

/**
 * The pixel sizes for a layer's axes that filled the frame it's leaving: a new, smaller
 * frame would otherwise squeeze it (unmeasured layers keep what they have).
 */
export function bakedFill(box: FreeBox, measure: GroupMeasure): Record<string, number> {
  const set: Record<string, number> = {};
  const sizing = measure.sizing(box.id);
  for (const axis of ["width", "height"] as const) {
    const px = Math.max(1, Math.round(axis === "width" ? box.size.w : box.size.h));
    if (sizing[axis] === "fill" && box.measured) set[axis] = px;
  }
  return set;
}

// ── Ungroup ──────────────────────────────────────────────────────────────────────────

/** The selected frames that can be ungrouped: frames with a parent (not the slide's root). */
export function ungroupable(index: SlideIndex, ids: readonly string[]): string[] {
  return groupMembers(index, ids).filter((id) => index.nodes.get(id)?.node.kind === "frame");
}

/** Degrees kept in (-180, 180], so adding two rotations stays inside the schema's range. */
const normalizeDegrees = (d: number) => {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return round2(r === -180 ? 180 : r);
};

/**
 * Dissolve each selected frame: its children take its place in its parent (in order), the
 * frame goes, and the children are selected. A child ends up placed freely when its new
 * parent is absolute, when it was free in the frame, or when the frame itself was free; it
 * then keeps its on-screen spot (`measure.positionIn`), the frame's rotation, and the sizes
 * the frame's flow was stretching (`freeSizing`). Otherwise it joins the parent's flow. The
 * frame's opacity and hidden state carry over to its children; its fill, stroke and padding
 * go with it. Null when nothing selected is a frame.
 */
export function ungroupLayers(
  index: SlideIndex,
  ids: readonly string[],
  measure: GroupMeasure,
): Command | null {
  const frames = ungroupable(index, ids)
    // Last first: dissolving a frame only shifts the siblings after it.
    .sort((a, b) => (index.nodes.get(b)?.index ?? 0) - (index.nodes.get(a)?.index ?? 0));
  if (frames.length === 0) return null;
  const ops: Op[] = [];
  const select: string[] = [];

  for (const frameId of frames) {
    const at = index.nodes.get(frameId);
    const frame = at?.node;
    const parent = parentFrame(index, frameId);
    if (!at || frame?.kind !== "frame" || !parent) continue;
    const frameFree = isFreeLayer(frame, parent.layout);
    const moves: Op[] = [];
    const updates: Op[] = [];

    for (const [i, child] of frame.children.entries()) {
      moves.push({ op: "node.move", id: child.id, parentId: parent.id, index: at.index + i });
      const freeInFrame = isFreeLayer(child, frame.layout);
      const set: Record<string, unknown> = {};

      if (parent.layout.mode === "absolute" || freeInFrame || frameFree) {
        const spot = measure.positionIn(child.id, parent.id) ?? {
          x: (frame.position?.x ?? 0) + (child.position?.x ?? 0),
          y: (frame.position?.y ?? 0) + (child.position?.y ?? 0),
        };
        set.position = { x: round2(spot.x), y: round2(spot.y) };
        if (parent.layout.mode === "absolute") {
          if (child.positioning !== undefined) set.positioning = null;
        } else if (child.positioning !== "free") {
          set.positioning = "free";
        }
        if (child.anchor !== undefined) set.anchor = null; // the spot is from the left/top
        const size = measure.size(child.id);
        if (!freeInFrame && size) {
          const baked = freeSizing(frame.layout, measure.sizing(child.id), size);
          for (const [key, value] of Object.entries(baked)) {
            if (child[key as "width" | "height"] !== value) set[key] = value;
          }
        }
        if (frame.rotation) {
          const turned = normalizeDegrees((child.rotation ?? 0) + frame.rotation);
          if (turned !== (child.rotation ?? 0)) set.rotation = turned === 0 ? null : turned;
        }
      } else {
        // "free" and anchors were about the frame it was in.
        if (child.positioning !== undefined) set.positioning = null;
        if (child.anchor !== undefined) set.anchor = null;
      }

      if (frame.opacity !== undefined && frame.opacity < 1) {
        set.opacity = Math.round((child.opacity ?? 1) * frame.opacity * 1000) / 1000;
      }
      if (frame.hidden && !child.hidden) set.hidden = true;
      if (Object.keys(set).length > 0) updates.push({ op: "node.update", id: child.id, set });
      select.push(child.id);
    }
    ops.push(...moves, ...updates, { op: "node.remove", id: frameId });
  }
  if (ops.length === 0) return null;
  const only = frames.length === 1 ? frames[0] : undefined;
  return {
    label: only ? `Ungroup ${quoted(index, only)}` : `Ungroup ${plural(frames.length, "frame")}`,
    ops,
    select,
  };
}
