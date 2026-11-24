/**
 * Editor commands as pure op builders: (document state, intent) → ops for one transaction.
 * The UI sends them with `client.transact(label, ops)`; the server validates and applies them
 * exactly like an agent's (golden rule #1), and each command is one undo step.
 */
import {
  createId,
  createSlide,
  matchKeyOf,
  type Node,
  type Op,
  type Slide,
  slideMatchKeys,
} from "@veloce/core";
import { nodeLabel, type SlideIndex, topmost } from "./slide-index.js";

export interface Command {
  label: string;
  ops: Op[];
  /** IDs to select afterwards (e.g. the copies a duplicate created). */
  select?: string[];
}

const plural = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);

/**
 * A deep copy with fresh IDs for every node, so it can live next to the original. Each copy
 * keeps its original's morph match key (D109: its `matchKey`, else its ID), so a duplicated
 * slide or a layer pasted onto another slide morphs with the original, unless the slide it
 * lands on already uses that key (`taken`, e.g. the original itself): then the copy has no
 * key of its own, like any new layer. The keys it gives out are added to `taken`, so copies
 * made one after another for the same slide never share one. `renamed`, if given, collects
 * each old ID → new ID (to point copied animations at the copies).
 */
export function cloneWithNewIds<T extends Node>(
  node: T,
  taken: Set<string>,
  renamed?: Map<string, string>,
): T {
  const copy = structuredClone(node) as Node;
  const renew = (n: Node) => {
    const key = matchKeyOf(n);
    if (taken.has(key)) delete n.matchKey;
    else {
      n.matchKey = key;
      taken.add(key);
    }
    const id = createId("nd");
    renamed?.set(n.id, id);
    (n as { id: string }).id = id;
    if (n.kind === "frame") n.children.forEach(renew);
  };
  renew(copy);
  return copy as T;
}

export function deleteNodes(index: SlideIndex, ids: readonly string[]): Command | null {
  const candidates = ids.filter((id) => id !== index.rootId && index.nodes.has(id));
  const targets = topmost(index, candidates);
  if (targets.length === 0) return null;
  const only = targets.length === 1 ? index.nodes.get(targets[0] ?? "")?.node : undefined;
  return {
    label: only ? `Delete "${nodeLabel(only)}"` : `Delete ${plural(targets.length, "layer")}`,
    ops: targets.map((id) => ({ op: "node.remove", id })),
    select: [],
  };
}

export function duplicateNodes(index: SlideIndex, ids: readonly string[]): Command | null {
  const targets = topmost(
    index,
    ids.filter((id) => id !== index.rootId),
  )
    .flatMap((id) => {
      const at = index.nodes.get(id);
      return at?.parentId ? [{ ...at, parentId: at.parentId }] : [];
    })
    // Insert from the last position backwards so earlier insertions don't shift later ones.
    .sort((a, b) => b.index - a.index);
  if (targets.length === 0) return null;
  // The originals stay on this slide with their keys, so the copies don't take them.
  const taken = slideMatchKeys(index.slide);
  const copies = targets.map((t) => ({ ...t, copy: cloneWithNewIds(t.node, taken) }));
  return {
    label: `Duplicate ${plural(copies.length, "layer")}`,
    ops: copies.map(({ parentId, index: i, copy }) => ({
      op: "node.insert",
      parentId,
      node: copy,
      index: i + 1,
    })),
    select: copies.map((c) => c.copy.id).reverse(),
  };
}

/** Move a layer up (-1) or down (+1) among its siblings: the keyboard alternative to dragging. */
export function reorderNode(index: SlideIndex, id: string, delta: number): Command | null {
  const at = index.nodes.get(id);
  const parent = at?.parentId ? index.nodes.get(at.parentId)?.node : undefined;
  if (!at || parent?.kind !== "frame") return null;
  const target = Math.min(parent.children.length - 1, Math.max(0, at.index + delta));
  if (target === at.index) return null;
  return {
    label: `Move "${nodeLabel(at.node)}" ${delta < 0 ? "up" : "down"}`,
    ops: [{ op: "node.move", id, parentId: parent.id, index: target }],
    select: [id],
  };
}

/** Patch one node's fields. `null` values reset a field to its default. */
export function updateNode(id: string, set: Record<string, unknown>, label: string): Command {
  return { label, ops: [{ op: "node.update", id, set }] };
}

// ── Slides ──────────────────────────────────────────────────────────────────────────

/**
 * A slide made by hand starts Free (D83): layers go wherever they're put, like Keynote or
 * Figma, and structure is opted into per block (Add auto layout). Agents' slides still start
 * as the stack `createSlide` gives them, since they describe structure, not pixels (D3).
 */
export const HAND_SLIDE_LAYOUT = { mode: "absolute" } as const;

export function addSlide(afterIndex: number): Command {
  const slide = createSlide({ id: createId("sl"), layout: HAND_SLIDE_LAYOUT });
  return {
    label: "Add slide",
    ops: [{ op: "slide.insert", slide, index: afterIndex + 1 }],
    select: [slide.id],
  };
}

export function duplicateSlide(slide: Slide, index: number): Command {
  // The copy joins the original's section (D97): it doesn't start one of its own.
  const { section: _section, ...fields } = structuredClone(slide);
  // Every layer keeps its original's match key, so the two slides morph (D109). The root
  // frame isn't a layer: it never morphs, so it gets no key it didn't have.
  const renamed = new Map<string, string>();
  const root = cloneWithNewIds(slide.root, new Set(), renamed);
  if (slide.root.matchKey === undefined) delete root.matchKey;
  // Its animations come along, with IDs of their own, animating the copies (D110).
  const animations = fields.animations?.map((a) => ({
    ...a,
    id: createId("an"),
    target: renamed.get(a.target) ?? a.target,
  }));
  const copy: Slide = {
    ...fields,
    ...(animations && { animations }),
    id: createId("sl"),
    root,
  };
  return {
    label: "Duplicate slide",
    ops: [{ op: "slide.insert", slide: copy, index: index + 1 }],
    select: [copy.id],
  };
}
