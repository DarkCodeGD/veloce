/**
 * Which layers morph into which between two slides (D109). Layer IDs are unique in the deck,
 * so matching by ID alone would never find anything across slides. Instead every layer has a
 * **match key**: its `matchKey`, or its ID when it has none. Duplicate slide gives each copy
 * its original's key, so the pairs exist without anyone setting a key, and agents (and
 * people, in the inspector) set the same `matchKey` on layers they build separately.
 *
 * Layers no key pairs fall back to their name and type (PowerPoint's `!!name` idea, without
 * the prefix): two "Logo" images pair even if they were made separately.
 *
 * Pure data, used by the morph transition and by the editor's copy commands.
 */
import type { Slide } from "./schema/deck.js";
import type { Node } from "./schema/node.js";

/** The key morph pairs a layer by: its `matchKey`, else its ID. */
export const matchKeyOf = (node: Pick<Node, "id" | "matchKey">): string => node.matchKey ?? node.id;

/** A slide's layers (not its root frame), in tree order: parents before their children. */
function layersOf(slide: Slide): Node[] {
  const out: Node[] = [];
  const visit = (node: Node) => {
    out.push(node);
    if (node.kind === "frame") node.children.forEach(visit);
  };
  slide.root.children.forEach(visit);
  return out;
}

/** The match keys a slide's layers already use: a copy landing there mustn't reuse one. */
export function slideMatchKeys(slide: Slide): Set<string> {
  return new Set(layersOf(slide).map(matchKeyOf));
}

/**
 * Match keys used by more than one layer of a slide (lint warns: morph pairs only the
 * first), with the layers that use each, in tree order.
 */
export function duplicateMatchKeys(slide: Slide): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const node of layersOf(slide)) {
    const key = matchKeyOf(node);
    byKey.set(key, [...(byKey.get(key) ?? []), node.id]);
  }
  return new Map([...byKey].filter(([, ids]) => ids.length > 1));
}

export interface MorphPair {
  from: Node;
  to: Node;
  /** How they were paired: by match key, or by the name-and-type fallback. */
  by: "key" | "name";
}

const typeOf = (node: Node) => (node.kind === "frame" ? "frame" : node.type);

/**
 * The layers of `from` that morph into layers of `to`. Each layer pairs at most once: by
 * match key first (the first layer with a key on each slide, if a key is repeated), then
 * by name and type among the layers still unpaired, in tree order. Layers left over fade
 * out (`from`) or in (`to`).
 */
export function morphPairs(from: Slide, to: Slide): MorphPair[] {
  const fromLayers = layersOf(from);
  const toLayers = layersOf(to);
  const pairs: MorphPair[] = [];
  const paired = new Set<Node>();

  const toByKey = new Map<string, Node>();
  for (const node of toLayers) {
    const key = matchKeyOf(node);
    if (!toByKey.has(key)) toByKey.set(key, node);
  }
  const seenKeys = new Set<string>();
  for (const node of fromLayers) {
    const key = matchKeyOf(node);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const match = toByKey.get(key);
    if (match) {
      pairs.push({ from: node, to: match, by: "key" });
      paired.add(node).add(match);
    }
  }

  const named = (node: Node) => !paired.has(node) && node.name !== undefined;
  const nameKey = (node: Node) => `${typeOf(node)}\u0000${node.name}`;
  const toByName = new Map<string, Node[]>();
  for (const node of toLayers.filter(named)) {
    toByName.set(nameKey(node), [...(toByName.get(nameKey(node)) ?? []), node]);
  }
  for (const node of fromLayers.filter(named)) {
    const match = toByName.get(nameKey(node))?.shift();
    if (match) {
      pairs.push({ from: node, to: match, by: "name" });
      paired.add(node).add(match);
    }
  }
  return pairs;
}
