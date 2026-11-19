/**
 * Align and distribute as editor actions: measure the selection on the main canvas, build
 * the command (model/align.ts) and send it. Shared by the keyboard shortcuts (App) and the
 * inspector's alignment bar.
 */
import { run } from "./actions.js";
import { mainCanvasSpace } from "./components/canvas-space.js";
import { resolvedSizing } from "./editor-context.js";
import {
  type AlignEdge,
  alignable,
  alignLayers,
  type DistributeAxis,
  distributeLayers,
  type LayerBox,
} from "./model/align.js";
import { type SlideIndex, topmost } from "./model/slide-index.js";

/** The layers alignment would move, measured as rendered now (see `LayerBox`). */
function measure(index: SlideIndex, ids: readonly string[]) {
  const space = mainCanvasSpace();
  const boxes = new Map<string, LayerBox>();
  for (const id of alignable(index, ids)) {
    const node = index.nodes.get(id)?.node;
    const rect = space?.rect(id);
    const size = space?.size(id);
    if (!node || !rect || !size) continue;
    const sizing = resolvedSizing(node);
    boxes.set(id, {
      rect,
      fill: {
        ...(sizing.width === "fill" ? { width: size.w } : {}),
        ...(sizing.height === "fill" ? { height: size.h } : {}),
      },
    });
  }
  return { space, boxes };
}

/** Align the selection (or a single layer within its frame). Resolves true when applied. */
export function alignSelection(
  index: SlideIndex,
  ids: readonly string[],
  edge: AlignEdge,
): Promise<boolean> {
  const { space, boxes } = measure(index, ids);
  const only = topmost(index, ids);
  const parentId = only.length === 1 ? index.nodes.get(only[0] ?? "")?.parentId : null;
  const container = parentId ? (space?.contentRect(parentId) ?? undefined) : undefined;
  return run(alignLayers(index, ids, edge, boxes, container));
}

/** Space three or more selected layers evenly. Resolves true when applied. */
export function distributeSelection(
  index: SlideIndex,
  ids: readonly string[],
  axis: DistributeAxis,
): Promise<boolean> {
  return run(distributeLayers(index, ids, axis, measure(index, ids).boxes));
}
