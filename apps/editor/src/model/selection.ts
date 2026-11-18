/**
 * Canvas selection rules, Figma-style (so they feel familiar):
 * - A click selects the top-level layer under the pointer (a card, not the text inside it).
 * - Once you're "inside" a frame (you selected one of its children), clicks pick its children.
 * - Double-click goes one level deeper. Esc goes back up. Shift toggles.
 * - Locked layers can't be picked on the canvas; the click goes to what contains them.
 */
import { chainOf, type SlideIndex } from "./slide-index.js";

export interface PickOptions {
  /** Double-click: go one level deeper than the current selection. */
  deep?: boolean;
  /** Shift-click: add/remove instead of replacing. */
  additive?: boolean;
}

/** The layer a click on `hitId` should target, or null (empty canvas or a locked layer). */
export function pickTarget(
  index: SlideIndex,
  hitId: string | null,
  selection: readonly string[],
  deep = false,
): string | null {
  if (!hitId) return null;
  const full = chainOf(index, hitId).slice(1); // without the slide's root frame
  const locked = full.findIndex((id) => index.nodes.get(id)?.node.locked);
  const chain = locked === -1 ? full : full.slice(0, locked);
  if (chain.length === 0) return null;

  // Clicked inside a selected layer: keep it, or (double-click) enter it.
  const selectedAt = chain.findIndex((id) => selection.includes(id));
  if (selectedAt !== -1)
    return deep
      ? (chain[selectedAt + 1] ?? chain[selectedAt] ?? null)
      : (chain[selectedAt] ?? null);

  // Working inside a frame: pick among that frame's children.
  for (const id of selection) {
    const context = index.nodes.get(id)?.parentId;
    const at = context ? chain.indexOf(context) : -1;
    if (at !== -1) return chain[at + 1] ?? null;
  }
  return chain[0] ?? null;
}

export function pick(
  index: SlideIndex,
  hitId: string | null,
  selection: readonly string[],
  { deep = false, additive = false }: PickOptions = {},
): string[] {
  const target = pickTarget(index, hitId, selection, deep);
  if (!additive) return target ? [target] : [];
  if (!target) return [...selection];
  return selection.includes(target)
    ? selection.filter((id) => id !== target)
    : [...selection, target];
}

/** Esc: select the parents of the selection (or nothing, at the top level). */
export function selectParents(index: SlideIndex, selection: readonly string[]): string[] {
  const parents = selection
    .map((id) => index.nodes.get(id)?.parentId)
    .filter((id): id is string => !!id && id !== index.rootId);
  return [...new Set(parents)];
}

/** Enter: select the first child of a selected frame. */
export function selectFirstChild(index: SlideIndex, selection: readonly string[]): string[] {
  const node = selection.length === 1 ? index.nodes.get(selection[0] ?? "")?.node : undefined;
  const child = node?.kind === "frame" ? node.children[0] : undefined;
  return child ? [child.id] : [...selection];
}

/** Ctrl+A: everything at the selection's level (or the top level). */
export function selectSiblings(index: SlideIndex, selection: readonly string[]): string[] {
  const parentId = index.nodes.get(selection[0] ?? "")?.parentId ?? index.rootId;
  const parent = index.nodes.get(parentId)?.node;
  if (parent?.kind !== "frame") return [...selection];
  return parent.children.filter((c) => !c.locked).map((c) => c.id);
}

/** Keep only selected IDs that still exist (an agent or undo may have removed them). */
export function pruneSelection(index: SlideIndex, selection: readonly string[]): string[] {
  const kept = selection.filter((id) => index.nodes.has(id) && id !== index.rootId);
  return kept.length === selection.length ? (selection as string[]) : kept;
}

/**
 * Text layers you can type into on the canvas (double-click or Enter): `text` elements that
 * aren't locked, directly or through a locked frame around them.
 */
export function editableText(index: SlideIndex, id: string | undefined): boolean {
  const node = id ? index.nodes.get(id)?.node : undefined;
  if (!id || node?.kind !== "element" || node.type !== "text") return false;
  return !chainOf(index, id).some((at) => index.nodes.get(at)?.node.locked);
}
