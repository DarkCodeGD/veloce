/**
 * Drag a slide thumbnail to reorder the deck (Alt+↑/↓ is the keyboard path). Same pattern as
 * the canvas drags: a press only becomes a drag past a small threshold (else it's a click
 * that selects the slide), the rows are measured once when the drag starts (the list doesn't
 * reflow under the pointer), an insertion line shows the slot, and the drop sends ONE
 * `slide.move`. Esc or losing the window cancels. Near the rail's top/bottom edge it scrolls.
 */
import type { Slide } from "@veloce/core";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { run } from "../actions.js";
import { moveSlideTo } from "../model/commands.js";
import type { Rect } from "../model/geometry.js";
import { insertionIndex } from "../model/reorder.js";

const THRESHOLD = 4;
/** Distance from the scroller's edge (px) where auto-scrolling starts, and its top speed. */
const SCROLL_ZONE = 48;
const SCROLL_SPEED = 14;

export interface SlideDrag {
  id: string;
  /** Where the slide will go (its final index). */
  index: number;
  /** The insertion line, in list pixels. */
  lineY: number;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at;
  }
  return null;
}

export function useSlideDrag(
  listRef: RefObject<HTMLOListElement | null>,
  slides: readonly Slide[],
  onMoved: (id: string) => void,
) {
  const [drag, setDrag] = useState<SlideDrag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const begin = useCallback(
    (e: React.PointerEvent, id: string) => {
      const list = listRef.current;
      if (e.button !== 0 || !list) return;
      cleanup.current?.();
      const start = { x: e.clientX, y: e.clientY };
      const pointer = { ...start };
      const scroller = scrollParent(list);
      /** The other rows, in list pixels, measured when the drag starts. */
      let others: Rect[] | null = null;
      let current: SlideDrag | null = null;
      let frame = 0;

      const update = () => {
        frame = 0;
        if (!others) return;
        const origin = list.getBoundingClientRect(); // moves when the rail scrolls
        const p = { x: pointer.x - origin.left, y: pointer.y - origin.top };
        const index = insertionIndex(p, others, "column");
        const above = others[index - 1];
        const below = others[index];
        const lineY =
          above && below
            ? (above.y + above.h + below.y) / 2
            : below
              ? below.y - 5
              : above
                ? above.y + above.h + 5
                : 0;
        current = { id, index, lineY };
        setDrag(current);
        // Auto-scroll near the edges, faster the closer the pointer gets.
        if (scroller) {
          const r = scroller.getBoundingClientRect();
          const speed =
            pointer.y < r.top + SCROLL_ZONE
              ? -SCROLL_SPEED * (1 - Math.max(0, pointer.y - r.top) / SCROLL_ZONE)
              : pointer.y > r.bottom - SCROLL_ZONE
                ? SCROLL_SPEED * (1 - Math.max(0, r.bottom - pointer.y) / SCROLL_ZONE)
                : 0;
          if (speed !== 0) {
            scroller.scrollTop += speed;
            frame = requestAnimationFrame(update);
          }
        }
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        pointer.x = ev.clientX;
        pointer.y = ev.clientY;
        if (!others) {
          if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < THRESHOLD) return;
          const origin = list.getBoundingClientRect();
          others = [...list.querySelectorAll<HTMLElement>(":scope > .thumb-row")]
            .filter((_, i) => slides[i]?.id !== id)
            .map((row) => {
              const r = row.getBoundingClientRect();
              return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
            });
          list.setPointerCapture(e.pointerId);
        }
        if (!frame) frame = requestAnimationFrame(update);
      };
      const end = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("blur", end);
        if (list.hasPointerCapture(e.pointerId)) list.releasePointerCapture(e.pointerId);
        cleanup.current = null;
        setDrag(null);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const dropped = current;
        end();
        if (!dropped) return; // never became a drag: the click selects the slide
        // The click that follows a drag isn't a click on a thumbnail.
        const swallow = (c: MouseEvent) => c.stopPropagation();
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
        const command = moveSlideTo(slides, dropped.id, dropped.index);
        if (command) void run(command).then((ok) => ok && onMoved(dropped.id));
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !others) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        end();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", end);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", end);
      cleanup.current = end;
    },
    [listRef, slides, onMoved],
  );

  return { drag, begin };
}
