/**
 * Editor commands as pure op builders: (document state, intent) → ops for one transaction.
 * The UI sends them with `client.transact(label, ops)`; the server validates and applies them
 * exactly like an agent's (golden rule #1), and each command is one undo step.
 */
import { createId, createSlide, type Node, type Op, type Slide } from "@veloce/core";
import { nodeLabel, type SlideIndex, topmost } from "./slide-index.js";

export interface Command {
  label: string;
  ops: Op[];
  /** IDs to select afterwards (e.g. the copies a duplicate created). */
  select?: string[];
}

const plural = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);

/** A deep copy with fresh IDs for every node, so it can live next to the original. */
export function cloneWithNewIds<T extends Node>(node: T): T {
  const copy = structuredClone(node) as Node;
  const renew = (n: Node) => {
    (n as { id: string }).id = createId("nd");
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
  const copies = targets.map((t) => ({ ...t, copy: cloneWithNewIds(t.node) }));
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

/**
 * A JSON merge patch that turns `before` into `after`: changed values, plus `null` for removed
 * keys. Needed when a value's shape changes (e.g. layout stack → grid drops `direction`).
 */
export function replacePatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(before)) if (!(key in after)) patch[key] = null;
  for (const [key, value] of Object.entries(after)) {
    const old = before[key];
    if (isPlainObject(old) && isPlainObject(value)) {
      const nested = replacePatch(old, value);
      if (Object.keys(nested).length > 0) patch[key] = nested;
    } else if (JSON.stringify(old) !== JSON.stringify(value)) {
      patch[key] = value;
    }
  }
  return patch;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Slides ──────────────────────────────────────────────────────────────────────────

export function addSlide(afterIndex: number): Command {
  const slide = createSlide({ id: createId("sl") });
  return {
    label: "Add slide",
    ops: [{ op: "slide.insert", slide, index: afterIndex + 1 }],
    select: [slide.id],
  };
}

export function duplicateSlide(slide: Slide, index: number): Command {
  const copy: Slide = {
    ...structuredClone(slide),
    id: createId("sl"),
    root: cloneWithNewIds(slide.root),
  };
  return {
    label: "Duplicate slide",
    ops: [{ op: "slide.insert", slide: copy, index: index + 1 }],
    select: [copy.id],
  };
}

export function deleteSlide(slide: Slide): Command {
  return {
    label: `Delete slide${slide.name ? ` "${slide.name}"` : ""}`,
    ops: [{ op: "slide.remove", id: slide.id }],
  };
}

/** Move a slide up (-1) or down (+1): the keyboard alternative to dragging it in the rail. */
export function moveSlide(slides: readonly Slide[], id: string, delta: number): Command | null {
  const from = slides.findIndex((s) => s.id === id);
  return from === -1 ? null : moveSlideTo(slides, id, from + delta);
}

/** Put a slide at position `index` (0-based, clamped). Null when it's already there. */
export function moveSlideTo(slides: readonly Slide[], id: string, index: number): Command | null {
  const from = slides.findIndex((s) => s.id === id);
  const to = Math.min(slides.length - 1, Math.max(0, index));
  if (from === -1 || to === from) return null;
  return {
    label: `Move slide ${from + 1} to position ${to + 1}`,
    ops: [{ op: "slide.move", id, index: to }],
    select: [id],
  };
}
