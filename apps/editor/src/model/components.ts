/**
 * Components in the editor (D94), pure: what "Save as component" proposes and sends, what
 * inserting one sends, and the little deck a component's preview draws.
 *
 * Inserting is a plain copy made by core's `instantiateComponent` (the same expansion agents'
 * `use` gets), placed like a new layer from the Add menu: into the selected frame, after the
 * selected layer, or at the end of the slide.
 */
import {
  type Component,
  type ComponentParam,
  collectIds,
  type Deck,
  getComponent,
  instantiateComponent,
  type Node,
  PARAM_NAME_PATTERN,
  type Slide,
  walkNodes,
} from "@veloce/core";
import type { Command } from "./commands.js";
import { placeNew } from "./insert.js";
import type { FrameSnapshot } from "./reorder.js";
import { nodeLabel, type SlideIndex } from "./slide-index.js";

/** A text in the layer, offered as a param: agents (and the panel's inserts) fill it in. */
export interface ParamProposal {
  /** The param's name, e.g. `title`. */
  param: string;
  /** `<node ID>.props.content`. */
  target: string;
  /** What the person sees: the layer's name or its text. */
  label: string;
}

/** "Card title" → "cardTitle"; letters and digits only, starting with a letter. */
function paramName(label: string): string {
  const words = label
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  const name = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join("")
    .slice(0, 32);
  return PARAM_NAME_PATTERN.test(name) ? name : "";
}

/**
 * Every text inside `node` as a param. Named after the layer when it has a name ("Title" →
 * `title`), else `text`, `text2`…, never twice the same.
 */
export function proposeParams(node: Node): ParamProposal[] {
  const used = new Set<string>();
  const proposals: ParamProposal[] = [];
  for (const { node: n } of walkNodes(node)) {
    if (n.kind !== "element" || n.type !== "text") continue;
    const base = (n.name && paramName(n.name)) || "text";
    let param = base;
    for (let i = 2; used.has(param); i++) param = `${base}${i}`;
    used.add(param);
    proposals.push({ param, target: `${n.id}.props.content`, label: nodeLabel(n) });
  }
  return proposals;
}

/**
 * The layer as a component's template. Where it sat (position, anchor, free) isn't part of
 * it: each copy is placed where it's inserted.
 */
export function templateOf(node: Node): Node {
  const { position: _p, anchor: _a, positioning: _f, ...rest } = node;
  return rest as Node;
}

export interface SaveComponentInput {
  name: string;
  description?: string;
  node: Node;
  /** The params kept, by name. */
  params: ReadonlyArray<{ param: string; target: string }>;
}

export function saveComponentCommand(deck: Deck, input: SaveComponentInput): Command {
  const params: Record<string, ComponentParam> = {};
  for (const { param, target } of input.params) params[param] = { targets: [target] };
  const description = input.description?.trim();
  const component: Component = {
    ...(description && { description }),
    ...(input.params.length > 0 && { params }),
    node: templateOf(input.node),
  };
  const replacing = getComponent(deck, input.name) !== undefined;
  return {
    label: `${replacing ? "Replace" : "Save"} component "${input.name}"`,
    ops: [{ op: "component.save", name: input.name, component }],
  };
}

export function removeComponentCommand(name: string): Command {
  return { label: `Delete component "${name}"`, ops: [{ op: "component.remove", name }] };
}

/** A copy of component `name` on the current slide, selected afterwards. */
export function insertComponentCommand(
  deck: Deck,
  index: SlideIndex,
  frames: readonly FrameSnapshot[],
  name: string,
  selection: readonly string[],
): Command | null {
  const component = getComponent(deck, name);
  if (!component) return null;
  const copy = instantiateComponent(name, component, { taken: collectIds(deck) });
  const placed = placeNew(index, frames, copy, null, selection);
  const node: Node = placed.position ? { ...copy, position: placed.position } : copy;
  return {
    label: `Insert "${name}"`,
    ops: [
      {
        op: "node.insert",
        parentId: placed.parentId,
        node,
        ...(placed.index !== undefined && { index: placed.index }),
      },
    ],
    select: [node.id],
  };
}

export const PREVIEW_SLIDE_ID = "component-preview";

/**
 * A one-slide deck with the component's template alone on it, for its preview. It lays out
 * at the deck's own stage size, so text wraps as it will on a slide; the preview then frames
 * the template's box (SlideCanvas `focus`).
 */
export function componentPreviewDeck(deck: Deck, component: Component): Deck {
  const slide: Slide = {
    id: PREVIEW_SLIDE_ID,
    root: {
      id: `${PREVIEW_SLIDE_ID}-root`,
      kind: "frame",
      layout: { mode: "stack", align: "center", justify: "center" },
      children: [component.node],
    },
  };
  return { ...deck, slides: [slide] };
}
