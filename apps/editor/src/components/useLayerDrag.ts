/**
 * Dragging rows in the Layers panel: reorder, and move layers into or out of frames. The
 * pure rules live in model/layer-drop.ts; this hook turns the pointer into a row, a
 * fraction of it and a depth, previews the result live on the canvas, and commits one
 * transaction on release (Escape cancels).
 *
 * The panel itself is frozen while dragging (it keeps showing the slide as it was at the
 * press): the canvas preview reorders the document, and rows moving under the pointer
 * would make the drop target oscillate (the same reason canvas drags freeze their layout,
 * D43 §3).
 */
import type { Slide } from "@veloce/core";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { run } from "../actions.js";
import { type LayerDrop, type LayerRow, layerDropAt, moveLayers } from "../model/layer-drop.js";
import { indexSlide, topmost } from "../model/slide-index.js";
import { setPreview } from "../preview.js";
import { mainCanvasSpace } from "./canvas-space.js";

/** Pixels before a press becomes a drag (a click stays a click). */
const THRESHOLD = 4;
/** Indent per depth level and the row's own left padding (matches LayersPanel). */
export const INDENT = 16;
export const ROW_PAD = 8;
/** Where a row's name starts after the indent: the chevron and the icon. */
const NAME_OFFSET = 36;
/** Auto-scroll when the pointer is this close to the panel's top or bottom edge. */
const SCROLL_EDGE = 28;

export interface LayerDragState {
  /** The slide as it was when the drag started: what the panel keeps showing. */
  slide: Slide;
  ids: readonly string[];
  drop: LayerDrop | null;
}

interface Options {
  list: RefObject<HTMLElement | null>;
  slide: Slide;
  selection: readonly string[];
  onSelect(ids: string[], additive: boolean): void;
}

export function useLayerDrag({ list, slide, selection, onSelect }: Options) {
  const [drag, setDrag] = useState<LayerDragState | null>(null);
  /** Set by a drag so the click that ends it doesn't also select the row under it. */
  const suppressClick = useRef(false);
  const latest = useRef({ slide, selection, onSelect });
  latest.current = { slide, selection, onSelect };
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (e.button !== 0 || e.shiftKey) return;
      const el = e.target as HTMLElement;
      if (el.closest(".layer-actions, .layer-chevron, input")) return;
      const start = { x: e.clientX, y: e.clientY };
      let state: LayerDragState | null = null;
      let command: ReturnType<typeof moveLayers> = null;

      /** The pointer as a row, a fraction of it and a depth (frozen panel: stable rows). */
      const pointerAt = (x: number, y: number) => {
        const root = list.current;
        if (!root) return null;
        const els = [...root.querySelectorAll<HTMLElement>("[data-layer-id]")];
        const rows: LayerRow[] = els.map((r) => ({
          id: r.dataset.layerId ?? "",
          depth: Number(r.dataset.depth ?? 0),
        }));
        if (els.length === 0) return null;
        let row = els.findIndex((r) => r.getBoundingClientRect().bottom > y);
        if (row < 0) row = els.length - 1;
        const r = (els[row] as HTMLElement).getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, (y - r.top) / r.height));
        const left = root.getBoundingClientRect().left;
        const depth = (x - left - ROW_PAD - NAME_OFFSET / 2) / INDENT;
        return { rows, pointer: { row, fraction, depth } };
      };

      /** Spots on the slide, per (layer, free frame), measured at the start of the drag. */
      const positions = new Map<string, { x: number; y: number }>();
      const measure = (ids: readonly string[], frozen: Slide) => {
        const space = mainCanvasSpace();
        if (!space) return;
        const index = indexSlide(frozen);
        for (const [frameId, at] of index.nodes) {
          if (at.node.kind !== "frame" || at.node.layout.mode !== "absolute") continue;
          for (const id of ids) {
            const p = space.positionIn(id, frameId);
            if (p) positions.set(`${id}→${frameId}`, p);
          }
        }
      };

      const update = (x: number, y: number) => {
        if (!state) return;
        const at = pointerAt(x, y);
        const index = indexSlide(state.slide);
        const drop = at ? layerDropAt(index, at.rows, state.ids, at.pointer) : null;
        // Into a free frame, layers keep their spot on the slide (measured at the press).
        const kept = new Map(
          state.ids.flatMap((id) => {
            const p = drop && positions.get(`${id}→${drop.parentId}`);
            return p ? [[id, p] as const] : [];
          }),
        );
        command = drop ? moveLayers(index, state.ids, drop.parentId, drop.beforeId, kept) : null;
        setPreview(command?.ops ?? null);
        state = { ...state, drop };
        setDrag(state);
      };

      const scroller = scrollParent(list.current);
      const onMove = (ev: PointerEvent) => {
        if (!state) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < THRESHOLD) return;
          const { slide: frozen, selection: selected, onSelect: select } = latest.current;
          const index = indexSlide(frozen);
          const ids = selected.includes(id) ? topmost(index, selected) : [id];
          if (!selected.includes(id)) select([id], false);
          suppressClick.current = true;
          measure(ids, frozen);
          state = { slide: frozen, ids, drop: null };
        }
        if (scroller) {
          const box = scroller.getBoundingClientRect();
          if (ev.clientY < box.top + SCROLL_EDGE) scroller.scrollTop -= 8;
          else if (ev.clientY > box.bottom - SCROLL_EDGE) scroller.scrollTop += 8;
        }
        update(ev.clientX, ev.clientY);
      };
      const finish = (commit: boolean) => {
        cleanup.current?.();
        if (!state) return;
        const moved = state.ids;
        state = null;
        setDrag(null);
        if (commit && command) {
          const sent = command;
          void run(sent)
            .then((ok) => ok && latest.current.onSelect([...moved], false))
            .finally(() => setPreview(null));
        } else {
          setPreview(null);
        }
        // The click that ends a drag lands on some row: don't let it select that row.
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      };
      const onUp = (ev: PointerEvent) => {
        if (state) update(ev.clientX, ev.clientY);
        finish(true);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !state) return;
        ev.preventDefault();
        ev.stopImmediatePropagation(); // Esc here cancels the drag, not the selection
        finish(false);
      };
      const onCancel = () => finish(false);

      cleanup.current?.();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      cleanup.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        cleanup.current = null;
      };
    },
    [list],
  );

  return { drag, onPointerDown, suppressClick };
}

/** The nearest ancestor that scrolls vertically (the panel body). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let at = el?.parentElement ?? null; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if (overflow === "auto" || overflow === "scroll") return at;
  }
  return null;
}
