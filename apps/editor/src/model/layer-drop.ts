/**
 * Drag and drop in the Layers panel, as pure functions: where a dragged row would land
 * (`layerDropAt`), and the one command that moves the layers there (`moveLayers`).
 *
 * Rows are the panel's visible tree in document order (the order the layout and painting
 * use). A drop lands **between** rows (in the parent of the row it's next to), or **into**
 * a frame row (appended to its children). After the last row of a nested frame, the
 * pointer's x picks how far out the layer goes, as in Figma: further left = shallower.
 */
import type { Op, Point } from "@veloce/core";
import type { Command } from "./commands.js";
import { chainOf, nodeLabel, type SlideIndex, topmost } from "./slide-index.js";

/** One visible row of the panel. Depth 0 = a child of the slide's root frame. */
export interface LayerRow {
  id: string;
  depth: number;
}

/** Where a drop lands: in `parentId`, before `beforeId` (or at the end when `null`). */
export interface LayerDrop {
  parentId: string;
  beforeId: string | null;
  /** What to draw: a line above/below row `row` indented to `depth`, or the row itself. */
  indicator:
    | { kind: "line"; row: number; edge: "top" | "bottom"; depth: number }
    | {
        kind: "into";
        row: number;
      };
}

/** The pointer over `rows[row]`: `fraction` 0 at its top, 1 at its bottom; `depth` from x. */
export interface LayerPointer {
  row: number;
  fraction: number;
  depth: number;
}

/**
 * Where layers `dragged` land for this pointer, or `null` where they can't go: into a
 * locked frame, or into themselves or their own children. Frame rows have three zones (top
 * quarter = before, middle = into, bottom quarter = after); other rows have two halves.
 */
export function layerDropAt(
  index: SlideIndex,
  rows: readonly LayerRow[],
  dragged: readonly string[],
  pointer: LayerPointer,
): LayerDrop | null {
  const row = rows[pointer.row];
  const at = row ? index.nodes.get(row.id) : undefined;
  if (!row || !at || at.parentId === null) return null;
  const node = at.node;
  const isFrame = node.kind === "frame";
  const top = isFrame ? 0.25 : 0.5;

  let drop: LayerDrop;
  if (isFrame && pointer.fraction >= 0.25 && pointer.fraction <= 0.75) {
    drop = { parentId: row.id, beforeId: null, indicator: { kind: "into", row: pointer.row } };
  } else if (pointer.fraction < top) {
    drop = {
      parentId: at.parentId,
      beforeId: row.id,
      indicator: { kind: "line", row: pointer.row, edge: "top", depth: row.depth },
    };
  } else if (isFrame && rows[pointer.row + 1]?.depth === row.depth + 1) {
    // Below an expanded frame: its first child is right underneath, so that's where it goes.
    drop = {
      parentId: row.id,
      beforeId: rows[pointer.row + 1]?.id ?? null,
      indicator: { kind: "line", row: pointer.row, edge: "bottom", depth: row.depth + 1 },
    };
  } else {
    drop = afterRow(index, row, pointer);
  }
  return accepts(index, drop.parentId, dragged) ? drop : null;
}

/**
 * Below a row: right after it, or, when it's the last child of its frame (and that frame the
 * last of its own…), after one of those ancestors. The pointer's depth picks which.
 */
function afterRow(index: SlideIndex, row: LayerRow, pointer: LayerPointer): LayerDrop {
  // Candidates from the row outwards, while each is the last child of its parent.
  const candidates = [{ id: row.id, depth: row.depth }];
  for (let c = candidates[0]; c; ) {
    const at = index.nodes.get(c.id);
    const parent = at?.parentId ? index.nodes.get(at.parentId) : undefined;
    const isLast =
      parent?.node.kind === "frame" && at && at.index === parent.node.children.length - 1;
    if (!isLast || !parent?.parentId || !at?.parentId) break;
    c = { id: at.parentId, depth: c.depth - 1 };
    candidates.push(c);
  }
  const deepest = Math.max(...candidates.map((c) => c.depth));
  const shallowest = Math.min(...candidates.map((c) => c.depth));
  const depth = Math.min(deepest, Math.max(shallowest, Math.round(pointer.depth)));
  const chosen = candidates.find((c) => c.depth === depth) ?? { id: row.id, depth: row.depth };
  const at = index.nodes.get(chosen.id);
  const parent = at?.parentId ? index.nodes.get(at.parentId)?.node : undefined;
  const next = parent?.kind === "frame" && at ? parent.children[at.index + 1] : undefined;
  return {
    parentId: at?.parentId ?? index.rootId,
    beforeId: next?.id ?? null,
    indicator: { kind: "line", row: pointer.row, edge: "bottom", depth: chosen.depth },
  };
}

/** A frame takes the drop unless it's locked or inside (or is) one of the dragged layers. */
function accepts(index: SlideIndex, parentId: string, dragged: readonly string[]): boolean {
  const parent = index.nodes.get(parentId)?.node;
  if (parent?.kind !== "frame" || (parent.locked && parentId !== index.rootId)) return false;
  const chain = chainOf(index, parentId);
  return !dragged.some((id) => chain.includes(id));
}

/**
 * Move `ids` (top-level ones, in document order) into `parentId` before `beforeId`, as one
 * transaction. Each `node.move` index is worked out by replaying the moves on plain child
 * lists, since every move shifts the indexes the next one sees. Layers that change frames
 * follow the canvas rules (D43, D49): in an absolute frame they sit at `positions` (where
 * they are on screen; 0,0 if unknown); in a stack or grid they drop `position`; either way
 * they drop `positioning`. Null when nothing would change or the drop isn't allowed.
 */
export function moveLayers(
  index: SlideIndex,
  ids: readonly string[],
  parentId: string,
  beforeId: string | null,
  positions: ReadonlyMap<string, Point> = new Map(),
): Command | null {
  const rank = new Map([...index.nodes.keys()].map((id, i) => [id, i]));
  const moving = topmost(index, ids)
    .filter((id) => id !== index.rootId && index.nodes.has(id))
    .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  const target = index.nodes.get(parentId)?.node;
  if (moving.length === 0 || target?.kind !== "frame" || !accepts(index, parentId, moving)) {
    return null;
  }
  const movingSet = new Set(moving);
  // The anchor must stay put: skip past dragged siblings ("before myself" = before the next).
  const siblings = target.children.map((c) => c.id);
  const from = beforeId === null ? -1 : siblings.indexOf(beforeId);
  const anchor = from < 0 ? null : (siblings.slice(from).find((id) => !movingSet.has(id)) ?? null);

  const lists = new Map<string, string[]>();
  const list = (frameId: string) => {
    let children = lists.get(frameId);
    if (!children) {
      const frame = index.nodes.get(frameId)?.node;
      children = frame?.kind === "frame" ? frame.children.map((c) => c.id) : [];
      lists.set(frameId, children);
    }
    return children;
  };

  const ops: Op[] = [];
  let changed = false;
  for (const id of moving) {
    const at = index.nodes.get(id);
    if (!at?.parentId) continue;
    const source = list(at.parentId);
    const was = source.indexOf(id);
    source.splice(was, 1);
    const into = list(parentId);
    const to = anchor === null ? into.length : into.indexOf(anchor);
    into.splice(to, 0, id);
    if (at.parentId === parentId && to === was) continue; // already there
    changed = true;
    ops.push({ op: "node.move", id, parentId, index: to });

    if (at.parentId === parentId) continue;
    const node = at.node;
    const set: Record<string, unknown> = {};
    if (target.layout.mode === "absolute") {
      set.position = positions.get(id) ?? node.position ?? { x: 0, y: 0 };
    } else if (node.position) {
      set.position = null;
    }
    if (node.positioning !== undefined) set.positioning = null;
    if (Object.keys(set).length > 0) ops.push({ op: "node.update", id, set });
  }
  if (!changed) return null;

  const only = moving.length === 1 ? index.nodes.get(moving[0] as string)?.node : undefined;
  const sameParent = moving.every((id) => index.nodes.get(id)?.parentId === parentId);
  const what = only ? `"${nodeLabel(only)}"` : `${moving.length} layers`;
  return {
    label: sameParent ? `Reorder ${what}` : `Move ${what} into "${nodeLabel(target)}"`,
    ops,
    select: moving,
  };
}
