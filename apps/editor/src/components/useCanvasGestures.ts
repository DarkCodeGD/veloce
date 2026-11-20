/**
 * Drives the canvas drags (components/canvas-drags.ts) with the same contract as scrubbing
 * (D41): the gesture previews locally (preview.ts), at most once per frame, and commits ONE
 * transaction on release. Esc, losing the window, or a refused drag cancels it and leaves no
 * trace. A press that never moves past the threshold is a click (`onClick`).
 *
 * Pointer capture starts only once a press becomes a drag: while captured, Chrome sends
 * click/dblclick to the capturing element, which would break double-click drill-in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { run } from "../actions.js";
import type { Command } from "../model/commands.js";
import type { Point } from "../model/geometry.js";
import { setPreview } from "../preview.js";
import type { Drag, Feedback, Modifiers } from "./canvas-drags.js";

/** Movement (screen px) before a press on a layer becomes a move: below it, it's a click. */
export const DRAG_THRESHOLD = 3;

export type GestureKind = "move" | "resize" | "rotate" | "marquee" | "draw";

interface Gesture {
  kind: GestureKind;
  pointerId: number;
  start: Point;
  threshold: number;
  /** Creates the drag once the threshold is passed (it measures the layout then). */
  make: () => Drag | null;
  onClick: (() => void) | undefined;
  onCommitted: ((command: Command) => void) | undefined;
  drag: Drag | null;
  pointer: Point;
  mods: Modifiers;
  command: Command | null;
  frame: number;
  capture: Element;
}

const modsOf = (e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => ({
  shift: e.shiftKey,
  alt: e.altKey,
  mod: e.ctrlKey || e.metaKey,
});

export function useCanvasGestures() {
  const [active, setActive] = useState<GestureKind | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const listeners = useRef<(() => void) | null>(null);

  const end = useCallback((g: Gesture) => {
    if (gesture.current !== g) return;
    gesture.current = null;
    cancelAnimationFrame(g.frame);
    listeners.current?.();
    listeners.current = null;
    if (g.capture.hasPointerCapture(g.pointerId)) g.capture.releasePointerCapture(g.pointerId);
    setActive(null);
    setFeedback(null);
  }, []);

  const cancel = useCallback(
    (g: Gesture) => {
      if (g.drag) setPreview(null);
      end(g);
    },
    [end],
  );

  /** Recompute the drag for the latest pointer/modifiers and show it. */
  const apply = useCallback((g: Gesture) => {
    g.frame = 0;
    if (!g.drag) return;
    const { command, feedback: next } = g.drag.update(g.pointer, g.mods);
    g.command = command;
    setPreview(command?.ops ?? null);
    setFeedback(next);
  }, []);

  const schedule = useCallback(
    (g: Gesture) => {
      if (!g.frame) g.frame = requestAnimationFrame(() => apply(g));
    },
    [apply],
  );

  const begin = useCallback(
    (
      e: React.PointerEvent,
      kind: GestureKind,
      make: () => Drag | null,
      {
        threshold = DRAG_THRESHOLD,
        onClick,
        onCommitted,
        capture = e.currentTarget,
      }: {
        threshold?: number;
        onClick?: () => void;
        /** After the server applied the drag's command (select what a draw added). */
        onCommitted?: (command: Command) => void;
        /** Keeps receiving the pointer during the drag (must outlive it: not a handle). */
        capture?: Element;
      } = {},
    ) => {
      if (gesture.current) cancel(gesture.current);
      const g: Gesture = {
        kind,
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        threshold,
        make,
        onClick,
        onCommitted,
        drag: null,
        pointer: { x: e.clientX, y: e.clientY },
        mods: modsOf(e),
        command: null,
        frame: 0,
        capture,
      };
      gesture.current = g;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== g.pointerId) return;
        g.pointer = { x: ev.clientX, y: ev.clientY };
        g.mods = modsOf(ev);
        if (!g.drag) {
          if (Math.hypot(g.pointer.x - g.start.x, g.pointer.y - g.start.y) < g.threshold) return;
          g.drag = g.make();
          if (!g.drag) return end(g); // nothing to drag (e.g. only stack layers in a group)
          g.capture.setPointerCapture(g.pointerId); // keep the pointer even off the window
          setActive(g.kind);
        }
        schedule(g);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== g.pointerId) return;
        if (!g.drag) {
          end(g);
          g.onClick?.();
          return;
        }
        // Final position, synchronously: the release point is what the user aimed for.
        g.pointer = { x: ev.clientX, y: ev.clientY };
        cancelAnimationFrame(g.frame);
        apply(g);
        const command = g.command;
        end(g);
        if (command) {
          void run(command)
            .then((ok) => ok && g.onCommitted?.(command))
            .finally(() => setPreview(null));
        } else setPreview(null);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          // Ours, not the editor's "select parent".
          ev.preventDefault();
          ev.stopImmediatePropagation();
          return cancel(g);
        }
        // Modifier pressed/released without moving: update the drag (e.g. Shift → keep ratio).
        if (g.drag && ["Shift", "Alt", "Control", "Meta"].includes(ev.key)) {
          if (ev.key === "Alt") ev.preventDefault(); // don't focus the browser menu
          g.mods = modsOf(ev);
          schedule(g);
        }
      };
      const onBlur = () => cancel(g);
      const onLost = (ev: PointerEvent) => {
        if (ev.pointerId === g.pointerId && gesture.current === g) cancel(g);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onLost);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", onKey, true);
      window.addEventListener("blur", onBlur);
      capture.addEventListener("lostpointercapture", onLost as EventListener);
      listeners.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onLost);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("keyup", onKey, true);
        window.removeEventListener("blur", onBlur);
        capture.removeEventListener("lostpointercapture", onLost as EventListener);
      };
    },
    [apply, cancel, end, schedule],
  );

  // Unmounting mid-gesture: drop the preview and every listener.
  useEffect(
    () => () => {
      if (gesture.current) cancel(gesture.current);
    },
    [cancel],
  );

  return { begin, active, feedback };
}
