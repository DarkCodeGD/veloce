/**
 * Components in the editor (D94), pure: what "Save as component" proposes and sends, what
 * inserting one sends, and the little deck a component's preview draws. Slide layouts too
 * (D95): saving a slide as one, and a new slide from one.
 *
 * Inserting is a plain copy made by core's `instantiateComponent` (the same expansion agents'
 * `use` gets), placed like a new layer from the Add menu: into the selected frame, after the
 * selected layer, or at the end of the slide.
 */
import {
  type Component,
  type ComponentParam,
  collectIds,
  createId,
  type Deck,
  findComponent,
  getComponent,
  instantiateComponent,
  instantiateSlide,
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
  /** Saving a whole slide as a slide layout (D95): its own fields. `node` is its root. */
  slide?: Pick<Slide, "background" | "hideFooter">;
}

/** What a saved layout keeps of its slide: background, and whether it shows the footer. */
export const slideFieldsOf = ({
  background,
  hideFooter,
}: Pick<Slide, "background" | "hideFooter">) => ({
  ...(background !== undefined && { background }),
  ...(hideFooter && { hideFooter }),
});

export function saveComponentCommand(deck: Deck, input: SaveComponentInput): Command {
  const params: Record<string, ComponentParam> = {};
  for (const { param, target } of input.params) params[param] = { targets: [target] };
  const description = input.description?.trim();
  const layout = input.slide;
  const component: Component = {
    ...(description && { description }),
    ...(input.params.length > 0 && { params }),
    node: layout ? input.node : templateOf(input.node),
    ...(layout && { slide: slideFieldsOf(layout) }),
  };
  const replacing = getComponent(deck, input.name) !== undefined;
  return {
    label: `${replacing ? "Replace" : "Save"} ${layout ? "slide layout" : "component"} "${input.name}"`,
    ops: [{ op: "component.save", name: input.name, component }],
  };
}

export function removeComponentCommand(name: string, layout = false): Command {
  return {
    label: `Delete ${layout ? "layout" : "component"} "${name}"`,
    ops: [{ op: "component.remove", name }],
  };
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
  if (!component || component.slide) return null;
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

/** A new slide from slide layout `name` (D95), after the slide at `afterIndex`; shown next. */
export function newSlideFromLayoutCommand(
  deck: Deck,
  name: string,
  afterIndex: number,
): Command | null {
  const layout = findComponent(deck, name);
  if (!layout?.slide) return null;
  const slide = instantiateSlide(name, layout, createId("sl"), { taken: collectIds(deck) });
  return {
    label: `New slide from "${name}"`,
    ops: [{ op: "slide.insert", slide, index: afterIndex + 1 }],
    select: [slide.id],
  };
}

export const LAYOUT_PREVIEW_ID = "layout-preview";

/** A one-slide deck showing what a slide from layout `name` looks like in this deck. */
export function layoutPreviewDeck(deck: Deck, name: string, layout: Component): Deck {
  return { ...deck, slides: [instantiateSlide(name, layout, LAYOUT_PREVIEW_ID)] };
}
