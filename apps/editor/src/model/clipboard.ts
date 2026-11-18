/**
 * Copy, cut and paste of layers as pure op builders. The payload is plain JSON (the layers,
 * deep-copied) under our own MIME type, so it goes through the system clipboard: between
 * slides, decks, editor tabs and app restarts. A plain-text version goes alongside, for
 * pasting into other apps. Text from other apps pastes as a new text layer.
 *
 * Where a paste lands (Figma's rules):
 * - nothing selected: on the slide (the end of its root frame);
 * - one frame selected (that isn't what was copied): inside it, at the end;
 * - otherwise: right after the (last) selected layer, in its frame.
 * Pasted layers get fresh IDs. In a free (absolute) frame they keep their position, shifted
 * by 20 px while it's taken (pasting twice doesn't stack copies invisibly); in a stack or
 * grid, `position` is dropped (it only means something in a free frame).
 */
import {
  collectAssetRefs,
  element,
  type Node,
  NodeSchema,
  type Op,
  TextContentSchema,
  toPlainText,
} from "@veloce/core";
import { type Command, cloneWithNewIds } from "./commands.js";
import { nodeLabel, type SlideIndex, topmost } from "./slide-index.js";

export const CLIPBOARD_MIME = "application/x-veloce+json";
const PASTE_OFFSET = 20;
const MAX_TEXT = 100_000;

export interface ClipboardPayload {
  veloce: 1;
  nodes: Node[];
}

const plural = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);
/** The selection's top-level layers (not the slide's root), in document order. */
function selectedLayers(index: SlideIndex, selection: readonly string[]): string[] {
  const order = [...index.nodes.keys()];
  return topmost(
    index,
    selection.filter((id) => id !== index.rootId && index.nodes.has(id)),
  ).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

// ── Copy / cut ────────────────────────────────────────────────────────────────────────

export function copyNodes(
  index: SlideIndex,
  selection: readonly string[],
): ClipboardPayload | null {
  const ids = selectedLayers(index, selection);
  const nodes = ids.flatMap((id) => {
    const node = index.nodes.get(id)?.node;
    return node ? [structuredClone(node)] : [];
  });
  return nodes.length > 0 ? { veloce: 1, nodes } : null;
}

export function cutNodes(index: SlideIndex, selection: readonly string[]): Command | null {
  const ids = selectedLayers(index, selection);
  if (ids.length === 0) return null;
  const only = ids.length === 1 ? index.nodes.get(ids[0] as string)?.node : undefined;
  return {
    label: only ? `Cut "${nodeLabel(only)}"` : `Cut ${plural(ids.length, "layer")}`,
    ops: ids.map((id) => ({ op: "node.remove", id })),
    select: [],
  };
}

export const serializePayload = (payload: ClipboardPayload) => JSON.stringify(payload);

/** The payload in clipboard text, or null if it isn't one (or isn't valid). */
export function parsePayload(text: string): ClipboardPayload | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as { veloce?: unknown; nodes?: unknown };
    if (value.veloce !== 1 || !Array.isArray(value.nodes)) return null;
    const nodes = value.nodes.flatMap((n) => {
      const parsed = NodeSchema.safeParse(n);
      return parsed.success ? [parsed.data] : [];
    });
    return nodes.length > 0 ? { veloce: 1, nodes } : null;
  } catch {
    return null;
  }
}

/** The copied layers as text, for pasting into other apps: their text content, in order. */
export function plainTextOf(nodes: readonly Node[]): string {
  const lines: string[] = [];
  const visit = (node: Node) => {
    if (node.kind === "frame") node.children.forEach(visit);
    else {
      const content = TextContentSchema.safeParse(node.props.content);
      if (content.success) lines.push(toPlainText(content.data));
    }
  };
  nodes.forEach(visit);
  return lines.join("\n");
}

// ── Paste ─────────────────────────────────────────────────────────────────────────────

/** Where pasted layers go (see the module comment). `index` undefined means "at the end". */
export function pasteTarget(
  index: SlideIndex,
  selection: readonly string[],
  copiedIds: ReadonlySet<string>,
): { parentId: string; index?: number } {
  const layers = selectedLayers(index, selection);
  const anchor = layers.at(-1);
  const at = anchor ? index.nodes.get(anchor) : undefined;
  if (!anchor || !at?.parentId) return { parentId: index.rootId };
  if (layers.length === 1 && at.node.kind === "frame" && !copiedIds.has(anchor)) {
    return { parentId: anchor };
  }
  return { parentId: at.parentId, index: at.index + 1 };
}

export type PasteResult = { ok: true; command: Command } | { ok: false; message: string };

export function pasteNodes(
  index: SlideIndex,
  payload: ClipboardPayload,
  selection: readonly string[],
  /** Asset IDs this deck has (layers using other assets can't land here yet). */
  assets: ReadonlySet<string>,
): PasteResult {
  const missing = [...collectAssetRefs(payload.nodes)].filter((id) => !assets.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      message: "These layers use images from another deck, which can't be pasted here yet",
    };
  }
  const target = pasteTarget(index, selection, new Set(payload.nodes.map((n) => n.id)));
  const copies = payload.nodes.map((n) => cloneWithNewIds(n));
  place(index, target.parentId, copies);
  const ops: Op[] = copies.map((node, i) => ({
    op: "node.insert",
    parentId: target.parentId,
    node,
    ...(target.index === undefined ? {} : { index: target.index + i }),
  }));
  const only = copies.length === 1 ? copies[0] : undefined;
  return {
    ok: true,
    command: {
      label: only ? `Paste "${nodeLabel(only)}"` : `Paste ${plural(copies.length, "layer")}`,
      ops,
      select: copies.map((c) => c.id),
    },
  };
}

/** Text from another app: a new text layer. Null for empty or oversized text. */
export function pasteText(
  index: SlideIndex,
  selection: readonly string[],
  text: string,
): Command | null {
  const content = text.replace(/\r\n?/g, "\n").trim();
  if (!content || content.length > MAX_TEXT) return null;
  const node = element("text", { content });
  const target = pasteTarget(index, selection, new Set());
  place(index, target.parentId, [node]);
  return {
    label: "Paste text",
    ops: [
      {
        op: "node.insert",
        parentId: target.parentId,
        node,
        ...(target.index === undefined ? {} : { index: target.index }),
      },
    ],
    select: [node.id],
  };
}

/** Positions for nodes about to go into `parentId` (mutates the fresh copies). */
function place(index: SlideIndex, parentId: string, nodes: Node[]): void {
  const parent = index.nodes.get(parentId)?.node;
  const free = parent?.kind === "frame" && parent.layout.mode === "absolute";
  if (!free) {
    for (const node of nodes) delete (node as { position?: unknown }).position;
    return;
  }
  const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const taken = new Set(parent.children.map((c) => key(c.position ?? { x: 0, y: 0 })));
  for (const node of nodes) {
    let p = node.position ?? { x: 0, y: 0 };
    while (taken.has(key(p))) p = { x: p.x + PASTE_OFFSET, y: p.y + PASTE_OFFSET };
    taken.add(key(p));
    node.position = p;
  }
}
