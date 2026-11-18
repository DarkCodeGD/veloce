/**
 * Navigating and immutably updating the slide → node tree.
 *
 * Updates use path copying: only the nodes on the path from the root to the change are
 * copied; every untouched subtree is shared with the previous version. That keeps edits
 * cheap and lets old versions stay valid (great for undo, diffing and React rendering).
 *
 * Lookups are linear scans. Fine for hundreds of slides; if profiling ever says otherwise,
 * add an id → location index cached per deck object (WeakMap) here, behind the same API.
 */
import type { Deck, Slide } from "./schema/deck.js";
import type { FrameNode, Node } from "./schema/node.js";

export interface SlideLocation {
  slide: Slide;
  index: number;
}

export interface NodeLocation {
  node: Node;
  slide: Slide;
  slideIndex: number;
  /** Child indexes from the slide's root frame to the node; `[]` for the root itself. */
  path: readonly number[];
  /** `null` for a slide's root frame. */
  parent: FrameNode | null;
  /** Index within the parent's children; -1 for the root. */
  index: number;
}

export function findSlide(deck: Deck, id: string): SlideLocation | null {
  const index = deck.slides.findIndex((s) => s.id === id);
  const slide = deck.slides[index];
  return slide ? { slide, index } : null;
}

export function findNode(deck: Deck, id: string): NodeLocation | null {
  for (const [slideIndex, slide] of deck.slides.entries()) {
    const found = findInSubtree(slide.root, id, [], null, -1);
    if (found) return { ...found, slide, slideIndex };
  }
  return null;
}

function findInSubtree(
  node: Node,
  id: string,
  path: number[],
  parent: FrameNode | null,
  index: number,
): Pick<NodeLocation, "node" | "path" | "parent" | "index"> | null {
  if (node.id === id) return { node, path, parent, index };
  if (node.kind !== "frame") return null;
  for (const [i, child] of node.children.entries()) {
    const found = findInSubtree(child, id, [...path, i], node, i);
    if (found) return found;
  }
  return null;
}

/** Depth-first walk over a subtree (the node itself first). */
export function* walkNodes(
  node: Node,
  depth = 0,
): Generator<{ node: Node; depth: number }, void, undefined> {
  yield { node, depth };
  if (node.kind === "frame") {
    for (const child of node.children) yield* walkNodes(child, depth + 1);
  }
}

/** Every slide and node ID in the deck. */
export function collectIds(deck: Deck): Set<string> {
  const ids = new Set<string>();
  for (const slide of deck.slides) {
    ids.add(slide.id);
    for (const { node } of walkNodes(slide.root)) ids.add(node.id);
  }
  return ids;
}

/** How many levels a subtree adds below its own node (an element or empty frame → 0). */
export function subtreeHeight(node: Node): number {
  if (node.kind !== "frame" || node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(subtreeHeight));
}

export function containsNode(ancestor: Node, id: string): boolean {
  for (const { node } of walkNodes(ancestor)) if (node.id === id) return true;
  return false;
}

/** Replace the node at `path` (relative to `root`) with `update(node)`, copying only the path. */
export function updateAtPath(
  root: FrameNode,
  path: readonly number[],
  update: (node: Node) => Node,
): FrameNode {
  if (path.length === 0) {
    const next = update(root);
    if (next.kind !== "frame") throw new Error("A slide's root must stay a frame");
    return next;
  }
  const [head, ...rest] = path as [number, ...number[]];
  const child = root.children[head];
  if (!child) throw new Error(`Invalid path segment ${head}`);
  let nextChild: Node;
  if (rest.length === 0) nextChild = update(child);
  else if (child.kind === "frame") nextChild = updateAtPath(child, rest, update);
  else throw new Error("Path goes through an element");
  const children = child === nextChild ? root.children : root.children.with(head, nextChild);
  return children === root.children ? root : { ...root, children };
}

/** Replace one slide, returning a new deck that shares everything else. */
export function replaceSlide(deck: Deck, index: number, slide: Slide): Deck {
  return { ...deck, slides: deck.slides.with(index, slide) };
}
