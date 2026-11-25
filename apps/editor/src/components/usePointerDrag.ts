/**
 * Dragging across a surface (D122): the color picker's square and bars and the editor's
 * sliders. Reports where the pointer is as fractions of the surface (0–1 across and down),
 * captures the pointer so a drag that leaves the surface keeps going, and ends once, on
 * release or when the capture is lost (the window lost focus…), keeping what was dragged to.
 */
import { type PointerEvent, type RefObject, useRef } from "react";

export type DragPhase = "start" | "move" | "end";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function usePointerDrag<E extends HTMLElement>(
  onDrag: (x: number, y: number, phase: DragPhase) => void,
  /** Pass one in to know from outside whether a drag is on. */
  dragging?: RefObject<boolean>,
) {
  // Its own flag when none is passed: one for the component's life, never one per render
  // (a fresh one would forget the drag at the first re-render).
  const fallback = useRef(false);
  const own = useRef<RefObject<boolean>>(dragging ?? fallback);
  own.current = dragging ?? fallback;
  const last = useRef<[number, number]>([0, 0]);

  const at = (e: PointerEvent<E>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };
  const end = () => {
    if (!own.current.current) return;
    own.current.current = false;
    onDrag(last.current[0], last.current[1], "end");
  };

  return {
    onPointerDown(e: PointerEvent<E>) {
      if (e.button !== 0) return;
      e.preventDefault(); // keep the focus (and a text selection) where it is
      e.currentTarget.setPointerCapture(e.pointerId);
      own.current.current = true;
      last.current = at(e);
      onDrag(last.current[0], last.current[1], "start");
    },
    onPointerMove(e: PointerEvent<E>) {
      if (!own.current.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
      last.current = at(e);
      onDrag(last.current[0], last.current[1], "move");
    },
    onPointerUp: end,
    onLostPointerCapture: end,
  };
}
