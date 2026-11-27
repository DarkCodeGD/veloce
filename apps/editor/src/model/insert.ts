/**
 * Adding layers by hand (D81), pure: what can be added, what a new layer looks like, and
 * where it lands. The tool bar, the Add menu (Shift+A, right-click) and drawing on the canvas
 * all end here, in ONE `node.insert`: the op an agent sends (golden rule 1), so undo, history
 * and the AI's view of the deck need nothing new.
 *
 * Where it lands follows the rules a dragged layer follows (model/reorder.ts): the innermost
 * unlocked frame under the point; in a stack or grid, the slot nearest the point; in a free
 * frame, at the point (centred on it, kept inside the frame). Without a point (the ➕ button,
 * Shift+A away from the canvas) it goes where a paste would: into the selected frame, or right
 * after the selected layer.
 */
import { element, type FrameNode, frame, type Node, type Point } from "@veloce/core";
import { pasteTarget } from "./clipboard.js";
import type { Command } from "./commands.js";
import type { Rect } from "./geometry.js";
import { childIndexForSlot, dropTarget, type FrameSnapshot, insertionIndex } from "./reorder.js";
import type { SlideIndex } from "./slide-index.js";

/** An element type as its plugin describes it (the registry's definitions, D79). */
export interface ElementInfo {
  type: string;
  title: string;
  description?: string;
  defaultProps: Readonly<Record<string, unknown>>;
  defaultSize?: { width?: unknown; height?: unknown };
}

export type InsertGroup = "Basic" | "Shapes" | "Media" | "Plugins";

/** One entry of the Add menu (and, for the built-ins, a tool). */
export interface Insertable {
  /** Stable ID: also the command ID suffix (`add.<id>`) and the "recent" key. */
  id: string;
  label: string;
  group: InsertGroup;
  /** Extra words the Add menu's search matches ("square", "circle"…). */
  keywords: string;
  /** What gets made: a frame, an element of a type, or an image (a file is picked first). */
  make:
    | { kind: "frame" }
    | { kind: "element"; type: string; props?: Record<string, unknown>; name?: string }
    | { kind: "image" };
}

/** The built-ins, in menu order. Image needs a file, so it's never a drawing tool. */
export const BUILTIN_INSERTABLES: readonly Insertable[] = [
  {
    id: "text",
    label: "Text",
    group: "Basic",
    keywords: "type words heading title paragraph",
    make: { kind: "element", type: "text" },
  },
  {
    id: "frame",
    label: "Frame",
    group: "Basic",
    keywords: "container box card group stack layout",
    make: { kind: "frame" },
  },
  {
    id: "rect",
    label: "Rectangle",
    group: "Shapes",
    keywords: "square box shape bar",
    make: { kind: "element", type: "shape", props: { shape: "rect" }, name: "Rectangle" },
  },
  {
    id: "ellipse",
    label: "Ellipse",
    group: "Shapes",
    keywords: "circle oval round dot shape",
    make: { kind: "element", type: "shape", props: { shape: "ellipse" }, name: "Ellipse" },
  },
  ...(
    [
      ["triangle", "Triangle", "pyramid delta warning shape"],
      ["polygon", "Polygon", "hexagon pentagon octagon shape"],
      ["star", "Star", "rating favourite burst shape"],
      ["arrow", "Block arrow", "pointer direction next shape"],
      ["chevron", "Chevron", "process step pointer shape"],
    ] as const
  ).map(
    ([shape, label, keywords]): Insertable => ({
      id: shape,
      label,
      group: "Shapes",
      keywords,
      make: { kind: "element", type: "shape", props: { shape }, name: label },
    }),
  ),
  {
    id: "line",
    label: "Line",
    group: "Shapes",
    keywords: "rule divider connector stroke straight",
    make: { kind: "element", type: "line", props: { end: "none" }, name: "Line" },
  },
  {
    id: "arrow-line",
    label: "Arrow",
    group: "Shapes",
    keywords: "pointer connector direction callout line",
    make: { kind: "element", type: "line", props: { end: "triangle" }, name: "Arrow" },
  },
  {
    id: "image",
    label: "Image…",
    group: "Media",
    keywords: "picture photo png jpg upload file",
    make: { kind: "image" },
  },
];

/**
 * Element types the built-in entries already cover. `vector` isn't offered on its own: a
 * path comes from an agent or a pasted SVG, not an empty insert (no pen tool yet, D127).
 */
const COVERED = new Set(["text", "shape", "line", "vector", "image"]);

/**
 * Everything the Add menu offers: the built-ins, then one entry per other registered
 * element type, so a plugin's element shows up with no extra code (D79 §4).
 */
export function insertables(elements: readonly ElementInfo[]): Insertable[] {
  const extra = elements
    .filter((e) => !COVERED.has(e.type))
    .map(
      (e): Insertable => ({
        id: `element:${e.type}`,
        label: e.title,
        group: "Plugins",
        keywords: `${e.type} ${e.description ?? ""}`,
        make: { kind: "element", type: e.type },
      }),
    );
  return [...BUILTIN_INSERTABLES, ...extra];
}

/**
 * The Add menu's search: every word typed must start a word of the label or keywords
 * ("rec" → Rectangle, "circ" → Ellipse). Labels that start with the query come first.
 */
export function searchInsertables<T extends { label: string; keywords?: string | undefined }>(
  items: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  const matches = items.filter((item) => {
    const haystack = `${item.label} ${item.keywords ?? ""}`.toLowerCase().split(/[^a-z0-9]+/);
    return words.every((w) => haystack.some((h) => h.startsWith(w)));
  });
  const first = words[0] as string;
  const leads = (i: T) => (i.label.toLowerCase().startsWith(first) ? 0 : 1);
  return matches.sort((a, b) => leads(a) - leads(b)); // stable: menu order otherwise
}

/** The most recently used first, without repeats, at most `max`. */
export function rememberRecent(recent: readonly string[], id: string, max = 3): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}

/** A titled run of Add menu entries. */
export interface MenuSection<T> {
  title: string;
  items: T[];
}

/**
 * The Add menu's sections: with a search, the matches; otherwise the recently used ones on
 * top (by ID, skipping any that are gone), then each section in the order it first appears.
 */
export function menuSections<
  T extends {
    id: string;
    label: string;
    keywords?: string | undefined;
    section?: string | undefined;
  },
>(items: readonly T[], query: string, recent: readonly string[]): MenuSection<T>[] {
  if (query.trim()) {
    const found = searchInsertables(items, query);
    return found.length > 0 ? [{ title: "Results", items: found }] : [];
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const sections: MenuSection<T>[] = [];
  const recentItems = recent.flatMap((id) => byId.get(id) ?? []);
  if (recentItems.length > 0) sections.push({ title: "Recent", items: recentItems });
  const named = new Map<string, MenuSection<T>>();
  for (const item of items) {
    const title = item.section ?? "More";
    let section = named.get(title);
    if (!section) {
      section = { title, items: [] };
      named.set(title, section);
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

/** Where to add: the point (slide pixels) that picks the frame and slot; a drawn box sizes it. */
export interface InsertAt {
  point: Point;
  /** Drawn on the canvas: the layer takes this box (in a free frame) or this size (in a flow). */
  rect?: Rect;
  /** A drawn line: where its ends are, as fractions of `rect`. */
  ends?: { from: Point; to: Point };
}

/** A new frame's look: a card in the theme's surface color, laying out what goes inside. */
const NEW_FRAME_SIZE = { width: 400, height: 300 };
const NEW_SHAPE_SIZE = 200;

/**
 * A new layer for `item` (not for images: those come from a file). `size` is the drawn box;
 * `free` says it lands in a free frame, where text sizes to what's typed (it has no column to
 * fill there).
 */
export function newLayer(
  item: Insertable,
  elements: readonly ElementInfo[],
  size: { w: number; h: number } | null,
  free: boolean,
  ends?: { from: Point; to: Point },
): Node | null {
  const drawn = size && {
    width: Math.max(1, Math.round(size.w)),
    height: Math.max(1, Math.round(size.h)),
  };
  const { make } = item;
  if (make.kind === "frame") {
    return frame({
      name: "Frame",
      ...(drawn ?? NEW_FRAME_SIZE),
      layout: { mode: "stack", gap: "$space.sm", padding: "$space.md" },
      style: { fill: "$color.surface", radius: "$radius.md" },
    });
  }
  if (make.kind !== "element") return null;
  const info = elements.find((e) => e.type === make.type);
  if (!info) return null;
  const props = structuredClone({ ...info.defaultProps, ...make.props });
  const name = make.name ? { name: make.name } : {};
  if (make.type === "text") {
    // Drawn: that width, growing down as you type. Clicked: the plugin's column-filling
    // default in a flow; in a free frame, as wide as its text (it has no column to fill).
    const width = drawn ? drawn.width : free ? "hug" : undefined;
    return element("text", props, {
      ...name,
      ...(width !== undefined && { width, height: "hug" }),
    });
  }
  if (make.type === "shape") {
    return element("shape", props, {
      ...name,
      ...(drawn ?? { width: NEW_SHAPE_SIZE, height: NEW_SHAPE_SIZE }),
    });
  }
  if (make.type === "line" && drawn && ends) {
    return element("line", { ...props, from: ends.from, to: ends.to }, { ...name, ...drawn });
  }
  // A plugin's element: its own default size unless drawn.
  return element(make.type, props, { ...name, ...drawn });
}

/** A layer's size in slide pixels when it's a fixed number (for centring), else 0. */
function fixedSize(node: Node): { w: number; h: number } {
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return { w: n(node.width), h: n(node.height) };
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max));

/**
 * Where a new layer goes and how: its parent, its index among the parent's children, and
 * (in a free frame) its position. `frames` is the slide as laid out now (CanvasSpace.frames).
 */
export function placeNew(
  index: SlideIndex,
  frames: readonly FrameSnapshot[],
  node: Node,
  at: InsertAt | null,
  selection: readonly string[],
  band = 12,
): { parentId: string; index?: number; position?: Point } {
  const byId = new Map(frames.map((f) => [f.id, f]));
  const size = fixedSize(node);
  const target = at
    ? (dropTarget(frames, at.point, band) ?? byId.get(index.rootId))
    : byId.get(pasteTarget(index, selection, new Set()).parentId);

  if (!target) {
    // Nothing measured (no canvas): the paste rules alone.
    return pasteTarget(index, selection, new Set());
  }
  const parent = index.nodes.get(target.id)?.node as FrameNode | undefined;
  if (target.flow === "absolute" || parent?.layout.mode === "absolute") {
    const box = target.rect;
    // Drawn: exactly there. A point: centred on it (or top-left at it, for a layer that
    // sizes itself). No point: the frame's middle.
    const centre = at?.point ?? { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const x = at?.rect ? at.rect.x : size.w ? centre.x - size.w / 2 : centre.x;
    const y = at?.rect ? at.rect.y : size.h ? centre.y - size.h / 2 : centre.y;
    return {
      parentId: target.id,
      // Kept inside the frame where it fits (a click near the edge doesn't hang off it).
      position: {
        x: Math.round(clamp(x - box.x, 0, box.w - size.w)),
        y: Math.round(clamp(y - box.y, 0, box.h - size.h)),
      },
    };
  }
  if (!at) {
    // The paste rules already chose the slot (after the selected layer), or the end.
    const paste = pasteTarget(index, selection, new Set());
    return paste.parentId === target.id ? paste : { parentId: target.id };
  }
  const flow = target.flow;
  const siblings = target.children.filter((c) => !c.free).map((c) => c.rect);
  const slot = insertionIndex(at.point, siblings, flow);
  return { parentId: target.id, index: childIndexForSlot(target.children, slot) };
}

/** The whole addition, as one command: the new layer, selected afterwards. */
export function insertCommand(
  index: SlideIndex,
  frames: readonly FrameSnapshot[],
  item: Insertable,
  elements: readonly ElementInfo[],
  at: InsertAt | null,
  selection: readonly string[],
  band?: number,
): Command | null {
  // Free or not decides the new layer's shape (text width), so find the parent first.
  const probe = newLayer(item, elements, at?.rect ?? null, false, at?.ends);
  if (!probe) return null;
  const placed = placeNew(index, frames, probe, at, selection, band);
  const parent = index.nodes.get(placed.parentId)?.node;
  const free = parent?.kind === "frame" && parent.layout.mode === "absolute";
  const base = free ? newLayer(item, elements, at?.rect ?? null, true, at?.ends) : probe;
  if (!base) return null;
  const node: Node = placed.position ? { ...base, position: placed.position } : base;
  return {
    label: `Add ${item.label.replace(/…$/, "").toLowerCase()}`,
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

/**
 * The box drawn from `start` to `pointer` (slide pixels): Shift makes it square (the longer
 * side wins), Alt draws it out from `start` as its centre, like Figma.
 */
export function drawnRect(
  start: Point,
  pointer: Point,
  mods: { shift: boolean; alt: boolean },
): Rect {
  let dx = pointer.x - start.x;
  let dy = pointer.y - start.y;
  if (mods.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  if (mods.alt)
    return {
      x: start.x - Math.abs(dx),
      y: start.y - Math.abs(dy),
      w: 2 * Math.abs(dx),
      h: 2 * Math.abs(dy),
    };
  return {
    x: Math.min(start.x, start.x + dx),
    y: Math.min(start.y, start.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}
