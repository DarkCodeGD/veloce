/**
 * Group / ungroup as editor actions: measure the main canvas, build the command
 * (model/group.ts), send it, and say why when the selection can't be grouped. Shared by the
 * keyboard shortcuts (App) and the inspector's buttons, so both behave the same.
 */
import { run } from "./actions.js";
import { mainCanvasSpace } from "./components/canvas-space.js";
import { resolvedSizing } from "./editor-context.js";
import { addAutoLayout } from "./model/auto-layout.js";
import { type GroupMeasure, groupBlocker, groupLayers, ungroupLayers } from "./model/group.js";
import type { SlideIndex } from "./model/slide-index.js";
import { showToast } from "./toasts.js";

/** The main canvas as rendered now. Without one (nothing shown), sizes fall back to the document. */
function canvasMeasure(index: SlideIndex): GroupMeasure {
  const space = mainCanvasSpace();
  return {
    size: (id) => space?.size(id) ?? null,
    sizing: (id) => {
      const node = index.nodes.get(id)?.node;
      return node ? resolvedSizing(node) : { width: "auto", height: "auto" };
    },
    positionIn: (id, frameId) => space?.positionIn(id, frameId) ?? null,
  };
}

/** Group the selection. Resolves to the IDs to select (the new group), or null. */
export async function groupSelection(
  index: SlideIndex,
  ids: readonly string[],
): Promise<string[] | null> {
  const blocker = groupBlocker(index, ids);
  if (blocker) {
    showToast({ message: blocker, tone: "info" });
    return null;
  }
  const command = groupLayers(index, ids, canvasMeasure(index));
  return (await run(command)) ? (command?.select ?? null) : null;
}

/**
 * Add auto layout to the selection (D83): free layers become a stack in their on-screen
 * order. Resolves to the IDs to select, or null.
 */
export async function autoLayoutSelection(
  index: SlideIndex,
  ids: readonly string[],
): Promise<string[] | null> {
  const blocker = groupBlocker(index, ids);
  if (blocker) {
    showToast({ message: blocker.replace(/^Group/, "Add auto layout to"), tone: "info" });
    return null;
  }
  const command = addAutoLayout(index, ids, canvasMeasure(index));
  return (await run(command)) ? (command?.select ?? null) : null;
}

/** Ungroup the selected frames. Resolves to the IDs to select (their children), or null. */
export async function ungroupSelection(
  index: SlideIndex,
  ids: readonly string[],
): Promise<string[] | null> {
  const command = ungroupLayers(index, ids, canvasMeasure(index));
  return (await run(command)) ? (command?.select ?? null) : null;
}
