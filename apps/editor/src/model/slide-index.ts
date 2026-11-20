/**
 * A lookup table for one slide's node tree: parent, position and depth of every node.
 * Cached per slide object; structural sharing means an unchanged slide is never re-indexed.
 */
import { type FrameNode, type Node, type Slide, type TextContent, toPlainText } from "@veloce/core";

export interface IndexedNode {
  node: Node;
  /** `null` for the slide's root frame. */
  parentId: string | null;
  /** Position among the parent's children (-1 for the root). */
  index: number;
  /** 0 for the root frame, 1 for its children, … */
  depth: number;
}

export interface SlideIndex {
  slide: Slide;
  rootId: string;
  nodes: ReadonlyMap<string, IndexedNode>;
}

const cache = new WeakMap<Slide, SlideIndex>();

export function indexSlide(slide: Slide): SlideIndex {
  const cached = cache.get(slide);
  if (cached) return cached;
  const nodes = new Map<string, IndexedNode>();
  const visit = (node: Node, parentId: string | null, index: number, depth: number) => {
    nodes.set(node.id, { node, parentId, index, depth });
    if (node.kind !== "frame") return;
    for (const [i, child] of node.children.entries()) visit(child, node.id, i, depth + 1);
  };
  visit(slide.root, null, -1, 0);
  const index = { slide, rootId: slide.root.id, nodes };
  cache.set(slide, index);
  return index;
}

/** IDs from the root frame down to `id` (inclusive). Empty if `id` isn't on this slide. */
export function chainOf(index: SlideIndex, id: string): string[] {
  const chain: string[] = [];
  for (let at = index.nodes.get(id) ? id : null; at; at = index.nodes.get(at)?.parentId ?? null) {
    chain.unshift(at);
  }
  return chain;
}

export function parentFrame(index: SlideIndex, id: string): FrameNode | null {
  const parentId = index.nodes.get(id)?.parentId;
  const parent = parentId ? index.nodes.get(parentId)?.node : undefined;
  return parent?.kind === "frame" ? parent : null;
}

/** Drop IDs whose ancestor is also listed (acting on the ancestor covers them). */
export function topmost(index: SlideIndex, ids: readonly string[]): string[] {
  const set = new Set(ids);
  return ids.filter(
    (id) =>
      !chainOf(index, id)
        .slice(0, -1)
        .some((a) => set.has(a)),
  );
}

/** A short human label for a node: its name, a text snippet, or its type. */
export function nodeLabel(node: Node): string {
  if (node.name) return node.name;
  if (node.kind === "frame") return node.layout.mode === "grid" ? "Grid" : "Frame";
  const content = node.props.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .flatMap((p: { runs?: Array<{ text?: string }> }) => p.runs ?? [])
            .map((r) => r.text ?? "")
            .join(" ")
        : "";
  const snippet = text.replace(/\s+/g, " ").trim();
  if (snippet) return snippet.length > 40 ? `${snippet.slice(0, 39)}…` : snippet;
  return node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

/**
 * What the history calls an edited text layer: its name, else a snippet of its *new* text
 * ("Edit text "Edited by me"", not the words that were replaced).
 */
export function editLabel(name: string | undefined, content: TextContent): string {
  if (name) return name;
  const text = toPlainText(content).replace(/\s+/g, " ").trim();
  if (!text) return "Text";
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
