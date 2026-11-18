/**
 * The bridge between the rendered slide (DOM, screen pixels) and the pure geometry in
 * model/ (slide pixels). A CanvasSpace is taken when a gesture starts and then frozen: the
 * live preview may reflow the layout, but every calculation keeps using the layout the user
 * saw when they grabbed the layer.
 */
import type { Layout } from "@veloce/core";
import { NODE_ID_ATTR } from "@veloce/renderer";
import type { Point, Rect } from "../model/geometry.js";
import type { FlowAxis, FrameSnapshot } from "../model/reorder.js";
import type { SlideIndex } from "../model/slide-index.js";

export class CanvasSpace {
  readonly stage: HTMLElement;
  /** Screen pixels per slide pixel. */
  readonly scale: number;
  /** Where the slide's top-left corner is on screen. */
  readonly #origin: Point;

  constructor(stage: HTMLElement, scale: number) {
    const r = stage.getBoundingClientRect();
    this.stage = stage;
    this.scale = scale || 1;
    this.#origin = { x: r.left, y: r.top };
  }

  /** A screen point (e.g. `clientX/Y`) in slide pixels. */
  toSlide(p: Point): Point {
    return { x: (p.x - this.#origin.x) / this.scale, y: (p.y - this.#origin.y) / this.scale };
  }

  element(id: string): HTMLElement | null {
    return this.stage.querySelector<HTMLElement>(`[${NODE_ID_ATTR}="${CSS.escape(id)}"]`);
  }

  /** The axis-aligned box a layer covers on the slide (rotation included). */
  rect(id: string): Rect | null {
    const el = this.element(id);
    return el ? this.#rectOf(el) : null;
  }

  /** The layer's own size, before rotation: what `width`/`height` describe. */
  size(id: string): { w: number; h: number } | null {
    const el = this.element(id);
    return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
  }

  #rectOf(el: Element): Rect {
    const r = el.getBoundingClientRect();
    const tl = this.toSlide({ x: r.left, y: r.top });
    return { x: tl.x, y: tl.y, w: r.width / this.scale, h: r.height / this.scale };
  }

  /** Every frame on the slide as laid out right now, except `exclude` (the dragged subtree). */
  frames(index: SlideIndex, exclude: ReadonlySet<string>): FrameSnapshot[] {
    const frames: FrameSnapshot[] = [];
    for (const [id, at] of index.nodes) {
      const node = at.node;
      if (node.kind !== "frame" || exclude.has(id)) continue;
      const el = this.element(id);
      if (!el) continue;
      const rect = this.#rectOf(el);
      const style = getComputedStyle(el);
      const pad = (side: "Top" | "Right" | "Bottom" | "Left") =>
        Number.parseFloat(style[`padding${side}`]) || 0;
      frames.push({
        id,
        parentId: at.parentId,
        depth: at.depth,
        rect,
        content: {
          x: rect.x + pad("Left"),
          y: rect.y + pad("Top"),
          w: Math.max(0, rect.w - pad("Left") - pad("Right")),
          h: Math.max(0, rect.h - pad("Top") - pad("Bottom")),
        },
        flow: flowOf(node.layout),
        locked: node.locked === true,
        children: node.children.flatMap((child) => {
          const r = exclude.has(child.id) ? null : this.rect(child.id);
          return r ? [{ id: child.id, rect: r }] : [];
        }),
      });
    }
    return frames;
  }
}

/** How a frame places its children, for drop calculations. */
export function flowOf(layout: Layout): FlowAxis | "absolute" {
  if (layout.mode === "absolute") return "absolute";
  if (layout.mode === "grid" || layout.wrap) return "grid"; // wrapping rows behave like cells
  return layout.direction ?? "column";
}

/** IDs of a node and everything inside it. */
export function subtree(index: SlideIndex, id: string): Set<string> {
  const ids = new Set<string>();
  const visit = (nodeId: string) => {
    ids.add(nodeId);
    const node = index.nodes.get(nodeId)?.node;
    if (node?.kind === "frame") for (const child of node.children) visit(child.id);
  };
  visit(id);
  return ids;
}
