/**
 * "Add auto layout" (Ctrl+Alt+A, D83): turn layers placed by hand into a stack, the way Figma
 * does. Slides made by hand start Free, so this is how structure gets opted into: a list, a
 * row of cards, a button with an icon.
 *
 * The stack copies the arrangement that's already on screen instead of guessing from the
 * layer order: layers spread out sideways become a row, otherwise a column; they flow in
 * reading order along it (left to right, or top to bottom), with their average spacing as the
 * gap. Pure op builders like group.ts, sent as one transaction (golden rules #1 and #7).
 *
 * - Several free layers are wrapped in a new stack frame that hugs them, at their corner.
 * - One Free (absolute) frame becomes a stack itself; its padding is where its children sat.
 * - Layers that already flow in a stack or grid are grouped like Ctrl+G, which wraps them in
 *   a frame with the same flow: that already is auto layout.
 */
import { createId, type FrameNode, isFreeLayer, type Layout, type Op } from "@veloce/core";
import type { Command } from "./commands.js";
import {
  bakedFill,
  type FreeBox,
  freeBoxes,
  type GroupMeasure,
  groupBlocker,
  groupLayers,
  groupMembers,
} from "./group.js";
import { parentFrame, type SlideIndex } from "./slide-index.js";

/** A box on the parent frame (rotation included). */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The flow the layers already form on screen. */
export interface Flow {
  direction: "row" | "column";
  /** The layers' IDs in reading order along `direction`. */
  order: string[];
  /** Their average spacing along `direction`, in whole pixels (never negative). */
  gap: number;
}

/**
 * Read the flow from the boxes: a row when their centres are spread wider than they are
 * tall, else a column (a single layer is a column). Ties in reading order keep the boxes'
 * order, which is document order. Overlapping layers give a gap of 0, never negative.
 */
export function guessFlow(boxes: ReadonlyArray<Bounds & { id: string }>): Flow {
  const cx = (b: Bounds) => (b.x0 + b.x1) / 2;
  const cy = (b: Bounds) => (b.y0 + b.y1) / 2;
  const spread = (centre: (b: Bounds) => number) => {
    const values = boxes.map(centre);
    return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
  };
  const row = spread(cx) > spread(cy);
  const centre = row ? cx : cy;
  const sorted = [...boxes].sort((a, b) => centre(a) - centre(b)); // stable: ties keep order
  const spaces = sorted
    .slice(1)
    .map((b, i) => (row ? b.x0 - (sorted[i]?.x1 ?? 0) : b.y0 - (sorted[i]?.y1 ?? 0)));
  const average = spaces.length === 0 ? 0 : spaces.reduce((a, b) => a + b, 0) / spaces.length;
  return {
    direction: row ? "row" : "column",
    order: sorted.map((b) => b.id),
    gap: Math.max(0, Math.round(average)),
  };
}

/** The stack a flow describes. Cross-axis alignment starts at the edge, like Figma's. */
function stackFor(flow: Flow, padding?: Layout["padding"]): Layout {
  return {
    mode: "stack",
    direction: flow.direction,
    gap: flow.gap,
    align: "start",
    ...(padding === undefined ? {} : { padding }),
  };
}

/** The union of the boxes' bounds, out to whole pixels. */
function outerBounds(boxes: readonly FreeBox[]): Bounds {
  return {
    x0: Math.floor(Math.min(...boxes.map((b) => b.bounds.x0))),
    y0: Math.floor(Math.min(...boxes.map((b) => b.bounds.y0))),
    x1: Math.ceil(Math.max(...boxes.map((b) => b.bounds.x1))),
    y1: Math.ceil(Math.max(...boxes.map((b) => b.bounds.y1))),
  };
}

/**
 * What a layer drops when it joins a flow: its position and anchor (the stack places it now)
 * and `positioning`, plus fixed pixels for any axis that filled the frame it was in.
 */
function joinFlowOps(boxes: readonly FreeBox[], measure: GroupMeasure, index: SlideIndex): Op[] {
  return boxes.flatMap((box): Op[] => {
    const node = index.nodes.get(box.id)?.node;
    const set: Record<string, unknown> = { ...bakedFill(box, measure) };
    for (const key of ["position", "anchor", "positioning"] as const) {
      if (node?.[key] !== undefined) set[key] = null;
    }
    return Object.keys(set).length > 0 ? [{ op: "node.update", id: box.id, set }] : [];
  });
}

/** Free layers of one frame, wrapped in a new stack frame that hugs them, at their corner. */
function wrapOps(
  index: SlideIndex,
  layers: string[],
  parent: FrameNode,
  measure: GroupMeasure,
): { ops: Op[]; id: string } {
  const boxes = freeBoxes(index, layers, parent.id, measure);
  const flow = guessFlow(boxes.map((b) => ({ id: b.id, ...b.bounds })));
  const outer = outerBounds(boxes);
  const frame: FrameNode = {
    id: createId("nd"),
    kind: "frame",
    name: "Auto layout",
    layout: stackFor(flow),
    ...(parent.layout.mode === "absolute" ? {} : { positioning: "free" as const }),
    position: { x: outer.x0, y: outer.y0 },
    width: "hug",
    height: "hug",
    children: [],
  };
  // Where the frontmost member was, so it stays in front of what they were in front of.
  const frontmost = Math.max(...layers.map((id) => index.nodes.get(id)?.index ?? 0));
  const ops: Op[] = [
    { op: "node.insert", parentId: parent.id, node: frame, index: frontmost + 1 },
    ...flow.order.map((id, i): Op => ({ op: "node.move", id, parentId: frame.id, index: i })),
    ...joinFlowOps(boxes, measure, index),
  ];
  return { ops, id: frame.id };
}

/** The four paddings that keep the children's block where it sat in the frame. */
function insetPadding(outer: Bounds, frame: { w: number; h: number }): Layout["padding"] {
  const sides = {
    top: Math.max(0, outer.y0),
    right: Math.max(0, Math.round(frame.w) - outer.x1),
    bottom: Math.max(0, Math.round(frame.h) - outer.y1),
    left: Math.max(0, outer.x0),
  };
  const values = Object.values(sides);
  if (values.every((v) => v === 0)) return undefined;
  return values.every((v) => v === sides.top) ? sides.top : sides;
}

/**
 * A Free frame becomes a stack in place: children flow in reading order, padded by where
 * their block sat. Layers that can't be measured (hidden) go last. The frame keeps its size.
 */
function convertOps(index: SlideIndex, frame: FrameNode, measure: GroupMeasure): Op[] {
  const shown = frame.children.filter((c) => measure.size(c.id) !== null).map((c) => c.id);
  const hidden = frame.children.map((c) => c.id).filter((id) => !shown.includes(id));
  const boxes = freeBoxes(index, shown, frame.id, measure);
  const flow = guessFlow(boxes.map((b) => ({ id: b.id, ...b.bounds })));
  const size = measure.size(frame.id);
  const padding = boxes.length > 0 && size ? insetPadding(outerBounds(boxes), size) : undefined;

  const ops: Op[] = [{ op: "node.update", id: frame.id, set: { layout: stackFor(flow, padding) } }];
  // Reorder by moving each into place in turn; skip the ones already there.
  const current = frame.children.map((c) => c.id);
  for (const [i, id] of [...flow.order, ...hidden].entries()) {
    if (current[i] === id) continue;
    current.splice(current.indexOf(id), 1);
    current.splice(i, 0, id);
    ops.push({ op: "node.move", id, parentId: frame.id, index: i });
  }
  // Hidden layers join the flow too; unmeasured, they keep their sizes.
  const all = [...boxes, ...freeBoxes(index, hidden, frame.id, measure)];
  return [...ops, ...joinFlowOps(all, measure, index)];
}

/**
 * Add auto layout to the selection (see the file comment). Null when there's nothing to do
 * or `groupBlocker` objects (layers in different frames, or a mix of free and flowing ones).
 */
export function addAutoLayout(
  index: SlideIndex,
  ids: readonly string[],
  measure: GroupMeasure,
): Command | null {
  const layers = groupMembers(index, ids);
  const first = layers[0];
  const only = layers.length === 1 ? index.nodes.get(first ?? "")?.node : undefined;
  if (only?.kind === "frame" && only.layout.mode === "absolute" && only.children.length > 0) {
    return {
      label: "Add auto layout",
      ops: convertOps(index, only, measure),
      select: [only.id],
    };
  }
  const parent = first ? parentFrame(index, first) : null;
  if (!first || !parent || groupBlocker(index, ids) !== null) return null;
  if (!isFreeLayer(index.nodes.get(first)?.node ?? {}, parent.layout)) {
    const group = groupLayers(index, ids, measure);
    return group && { ...group, label: "Add auto layout" };
  }
  const { ops, id } = wrapOps(index, layers, parent, measure);
  return { label: "Add auto layout", ops, select: [id] };
}
