/**
 * Convenience builders for decks, slides and nodes. They fill in generated IDs and sensible
 * defaults; the result is plain data that still goes through ops to enter a document.
 */
import { DEFAULT_THEME } from "./default-theme.js";
import { createId } from "./ids.js";
import { type Deck, type DeckMeta, FORMAT_VERSION, type Slide, type Stage } from "./schema/deck.js";
import type { ElementNode, FrameFields, FrameNode, Layout, Node } from "./schema/node.js";
import type { Theme } from "./schema/theme.js";

export const DEFAULT_STAGE: Stage = { width: 1920, height: 1080 };

/** The root layout new slides get: a centered column with comfortable margins. */
export const DEFAULT_SLIDE_LAYOUT: Layout = {
  mode: "stack",
  direction: "column",
  gap: "$space.md",
  padding: "$space.xl",
  justify: "center",
};

export interface CreateDeckOptions extends Partial<Omit<DeckMeta, "title">> {
  title: string;
  id?: string;
  theme?: Theme;
  stage?: Stage;
  slides?: Slide[];
}

export function createDeck(options: CreateDeckOptions): Deck {
  const { id, theme, stage, slides, title, ...meta } = options;
  return {
    id: id ?? createId("dk"),
    formatVersion: FORMAT_VERSION,
    meta: { title, ...meta },
    stage: stage ?? DEFAULT_STAGE,
    theme: theme ?? DEFAULT_THEME,
    slides: slides ?? [],
    assets: {},
  };
}

export interface CreateSlideOptions extends Partial<Omit<Slide, "root">> {
  /** Layout of the slide's root frame. Default: `DEFAULT_SLIDE_LAYOUT`. */
  layout?: Layout;
  children?: Node[];
  rootId?: string;
}

export function createSlide(options: CreateSlideOptions = {}): Slide {
  const { id, layout, children, rootId, ...fields } = options;
  return {
    id: id ?? createId("sl"),
    ...fields,
    root: frame({ id: rootId, layout: layout ?? DEFAULT_SLIDE_LAYOUT, children: children ?? [] }),
  };
}

export type FrameOptions = Partial<Omit<FrameFields, "kind" | "id">> & {
  id?: string | undefined;
  children?: Node[];
};

export function frame(options: FrameOptions = {}): FrameNode {
  const { id, layout, children, ...fields } = options;
  return {
    id: id ?? createId("nd"),
    kind: "frame",
    layout: layout ?? { mode: "stack" },
    ...fields,
    children: children ?? [],
  };
}

export type ElementOptions = Partial<Omit<ElementNode, "kind" | "type" | "props" | "id">> & {
  id?: string;
};

export function element(
  type: string,
  props: Record<string, unknown>,
  options: ElementOptions = {},
): ElementNode {
  const { id, ...fields } = options;
  return { id: id ?? createId("nd"), kind: "element", type, ...fields, props };
}
