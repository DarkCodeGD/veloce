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
 *
 * Images travel too: the payload names the deck it came from and the files the layers use.
 * Pasting into another deck copies those files over first (`sourceAssets`), then the paste
 * registers them with `asset.add` in the same transaction as the layers.
 */
import {
  type AssetInfo,
  AssetInfoSchema,
  collectAssetRefs,
  element,
  isFreeLayer,
  type Node,
  NodeSchema,
  type Op,
  shiftAnchored,
  TextContentSchema,
  toPlainText,
} from "@veloce/core";
import { assetAddOps, type Imported } from "./asset-insert.js";
import { type Command, cloneWithNewIds } from "./commands.js";
import { nodeLabel, type SlideIndex, topmost } from "./slide-index.js";

export const CLIPBOARD_MIME = "application/x-veloce+json";
const PASTE_OFFSET = 20;
const MAX_TEXT = 100_000;

export interface ClipboardPayload {
  veloce: 1;
  nodes: Node[];
  /** Where the layers came from, and the files they use (to copy into another deck). */
  source?: { deckId: string; assets: Record<string, AssetInfo> };
}

const DECK_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
  /** The deck being copied from: its ID and asset registry. */
  from?: { deckId: string; assets: Readonly<Record<string, AssetInfo>> },
): ClipboardPayload | null {
  const ids = selectedLayers(index, selection);
  const nodes = ids.flatMap((id) => {
    const node = index.nodes.get(id)?.node;
    return node ? [structuredClone(node)] : [];
  });
  if (nodes.length === 0) return null;
  if (!from) return { veloce: 1, nodes };
  const assets: Record<string, AssetInfo> = {};
  for (const id of collectAssetRefs(nodes)) {
    const info = from.assets[id];
    if (info) assets[id] = info;
  }
  return { veloce: 1, nodes, source: { deckId: from.deckId, assets } };
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
    const value = JSON.parse(text) as { veloce?: unknown; nodes?: unknown; source?: unknown };
    if (value.veloce !== 1 || !Array.isArray(value.nodes)) return null;
    const nodes = value.nodes.flatMap((n) => {
      const parsed = NodeSchema.safeParse(n);
      return parsed.success ? [parsed.data] : [];
    });
    if (nodes.length === 0) return null;
    const source = parseSource(value.source);
    return { veloce: 1, nodes, ...(source && { source }) };
  } catch {
    return null;
  }
}

/** The payload's source, if it's well-formed (it comes from the clipboard: anyone's data). */
function parseSource(value: unknown): ClipboardPayload["source"] | undefined {
  const { deckId, assets } = (value ?? {}) as { deckId?: unknown; assets?: unknown };
  if (typeof deckId !== "string" || !DECK_ID.test(deckId)) return undefined;
  if (typeof assets !== "object" || assets === null) return undefined;
  const valid: Record<string, AssetInfo> = {};
  for (const [id, info] of Object.entries(assets)) {
    const parsed = AssetInfoSchema.safeParse(info);
    if (/^[0-9a-f]{64}$/.test(id) && parsed.success) valid[id] = parsed.data;
  }
  return { deckId, assets: valid };
}

/** Files the layers use that the deck doesn't have, and whether they can be copied over. */
export function missingAssets(payload: ClipboardPayload, deckAssets: ReadonlySet<string>) {
  const missing = [...collectAssetRefs(payload.nodes)].filter((id) => !deckAssets.has(id));
  const copyable = missing.filter((id) => payload.source?.assets[id] !== undefined);
  return { missing, copyable, fromDeck: payload.source?.deckId };
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
  /** Asset IDs this deck has. */
  assets: ReadonlySet<string>,
  /** Files just copied over from the source deck: registered in this same transaction. */
  copied: readonly Imported[] = [],
): PasteResult {
  const available = new Set([...assets, ...copied.map((c) => c.id)]);
  const missing = [...collectAssetRefs(payload.nodes)].filter((id) => !available.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        "These layers use images that aren't available here (their deck isn't open in Veloce)",
    };
  }
  const target = pasteTarget(index, selection, new Set(payload.nodes.map((n) => n.id)));
  const copies = payload.nodes.map((n) => cloneWithNewIds(n));
  place(index, target.parentId, copies);
  const ops: Op[] = [
    ...assetAddOps(copied, assets),
    ...copies.map(
      (node, i): Op => ({
        op: "node.insert",
        parentId: target.parentId,
        node,
        ...(target.index === undefined ? {} : { index: target.index + i }),
      }),
    ),
  ];
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

/**
 * Positions for nodes about to go into `parentId` (mutates the fresh copies). Free layers
 * (in an absolute frame, or `positioning: "free"` ones pasted into a stack or grid) step
 * off any free sibling they'd land exactly on; the rest drop their meaningless `position`.
 */
function place(index: SlideIndex, parentId: string, nodes: Node[]): void {
  const parent = index.nodes.get(parentId)?.node;
  if (parent?.kind !== "frame") return;
  const absolute = parent.layout.mode === "absolute";
  // Same position and same anchor: the same spot (an anchor keeps its meaning in any frame,
  // so a badge pinned to one card's corner lands on the other card's corner).
  const key = (n: Node, p: { x: number; y: number }) =>
    `${n.anchor?.x ?? "start"},${n.anchor?.y ?? "start"},${p.x},${p.y}`;
  const taken = new Set(
    parent.children
      .filter((c) => isFreeLayer(c, parent.layout))
      .map((c) => key(c, c.position ?? { x: 0, y: 0 })),
  );
  for (const node of nodes) {
    if (absolute) delete node.positioning; // every child of an absolute frame is free anyway
    if (!isFreeLayer(node, parent.layout)) {
      delete node.position;
      delete node.anchor;
      continue;
    }
    let p = node.position ?? { x: 0, y: 0 };
    // Step down-right on screen, whichever edges the layer is measured from.
    const step = { x: PASTE_OFFSET, y: PASTE_OFFSET };
    while (taken.has(key(node, p))) p = shiftAnchored(p, node.anchor, step);
    taken.add(key(node, p));
    node.position = p;
  }
}
