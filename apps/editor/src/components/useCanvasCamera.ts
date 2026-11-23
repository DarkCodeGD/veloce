/**
 * Canvas zoom and pan (D60), wired to the pointer and the keyboard. The math lives in
 * model/camera.ts; the renderer's SlideView draws the camera; this hook turns input into
 * cameras:
 *
 * - Ctrl/⌘ + wheel, and trackpad pinch (Chromium sends it as Ctrl + wheel): zoom at the pointer.
 * - Wheel / two-finger scroll: pan. Shift + wheel pans sideways.
 * - Space + drag, or middle-button drag: pan.
 * - Zoom commands for the registry (D89): Mod+= / Mod+- in/out, Shift+1 fit, Shift+0 100%,
 *   Shift+2 the selection, and the View menu (camera-controls.ts).
 *
 * Wheel and drag updates are coalesced to one camera per animation frame: a trackpad fires
 * far more events than the screen shows, and each camera re-measures the overlay.
 * Nothing here touches the document: zoom is view state, not an op.
 */
import type { SlideView } from "@veloce/renderer";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { setCameraControls } from "../camera-controls.js";
import { typing } from "../keyboard.js";
import {
  type Camera,
  cameraFor,
  keepVisible,
  panBy,
  type Size,
  wheelPan,
  wheelZoomFactor,
  zoomAt,
  zoomStep,
} from "../model/camera.js";
import type { Point, Rect } from "../model/geometry.js";

interface Options {
  /** The canvas element: wheel, pointer and Space are taken while the pointer is over it. */
  wrapper: RefObject<HTMLElement | null>;
  view: RefObject<SlideView | null>;
  /** The slide's size in slide pixels. */
  stage: Size;
  /** Resets the camera to fit when it changes (another deck). */
  deckId: string;
  /** True while a drag (move, resize…) runs: the camera must not move under it. */
  busy: boolean;
  /** The Hand tool is on (D81): a left-button drag pans, as with Space held. */
  hand?: boolean;
  /** The selection's bounds in slide pixels, for Zoom to selection. */
  selectionRect(): Rect | null;
  /** Called after the camera changed (the overlay re-measures). */
  onChange(): void;
}

/** What the next frame should show: a camera, or "fit the viewport". */
type Pending = Camera | "fit" | null;

/**
 * On Linux, releasing the middle button pastes the "primary selection" (the last text you
 * highlighted anywhere) into the editable under the pointer: Chromium does it while handling
 * the release, as a `paste` (and `beforeinput`) event. On the canvas the middle button is the
 * hand tool, never a paste, so while it's down (and until the release has been handled)
 * those events are swallowed before the text editor sees them. Returns the guard's remover.
 */
function blockMiddleClickPaste(): () => void {
  const block = (e: Event) => {
    if (e instanceof InputEvent && e.inputType !== "insertFromPaste") return; // real typing
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const types = ["paste", "beforeinput", "auxclick"] as const;
  for (const type of types) window.addEventListener(type, block, true);
  return () => {
    // The paste runs in the same task as the release: lift the guard once that task is done.
    setTimeout(() => {
      for (const type of types) window.removeEventListener(type, block, true);
    }, 0);
  };
}

export function useCanvasCamera({
  wrapper,
  view,
  stage,
  deckId,
  busy,
  hand = false,
  selectionRect,
  onChange,
}: Options) {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const pending = useRef<Pending>(null);
  const frame = useRef(0);
  // Latest values for listeners registered once.
  const latest = useRef({ stage, busy, selectionRect, onChange, spaceHeld, hand });
  latest.current = { stage, busy, selectionRect, onChange, spaceHeld, hand };

  const viewportSize = useCallback((): Size | null => {
    const el = view.current?.stage.parentElement;
    return el ? { w: el.clientWidth, h: el.clientHeight } : null;
  }, [view]);

  /** The camera the next frame will show (a pending one, else what's drawn). */
  const current = useCallback((): Camera | null => {
    const v = view.current;
    if (!v) return null;
    const p = pending.current;
    return p === "fit" ? v.fitCamera : (p ?? v.camera);
  }, [view]);

  const flush = useCallback(() => {
    frame.current = 0;
    const v = view.current;
    const p = pending.current;
    pending.current = null;
    // A drag that started since this camera was asked for measured the slide where it is
    // now: moving it would put the dragged layer off the pointer. Drop the camera instead.
    if (!v || p === null || latest.current.busy) return;
    v.setCamera(p === "fit" ? null : p);
    latest.current.onChange();
  }, [view]);

  /**
   * Show `next` from the next frame on (kept partly on screen), or fit with "fit". Ignored
   * while a drag runs, whichever input asked (wheel, keys, the zoom pill): the drag measured
   * the slide where it is, so the camera must hold still under it.
   */
  const set = useCallback(
    (next: Camera | "fit") => {
      if (latest.current.busy) return;
      const size = viewportSize();
      if (next !== "fit" && size) {
        const { w, h } = latest.current.stage;
        next = keepVisible(next, size, { w, h });
      }
      pending.current = next;
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [flush, viewportSize],
  );

  const centre = useCallback((): Point => {
    const size = viewportSize();
    return size ? { x: size.w / 2, y: size.h / 2 } : { x: 0, y: 0 };
  }, [viewportSize]);

  // ── Commands (the zoom control and the keys) ────────────────────────────────────
  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      const cam = current();
      if (cam) set(zoomAt(cam, zoomStep(cam.scale, dir), centre()));
    },
    [current, set, centre],
  );
  const zoomIn = useCallback(() => zoomBy(1), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(-1), [zoomBy]);
  const zoomToFit = useCallback(() => set("fit"), [set]);
  const zoomTo100 = useCallback(() => {
    const cam = current();
    if (cam) set(zoomAt(cam, 1, centre()));
  }, [current, set, centre]);
  const zoomToSelection = useCallback(() => {
    const rect = latest.current.selectionRect();
    const size = viewportSize();
    set(rect && size ? cameraFor(rect, size) : "fit");
  }, [set, viewportSize]);

  // Another deck (maybe another slide size): start fitted, and drop any camera still on its
  // way from the old deck. Re-measure so the outlines and the zoom label follow at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deckId is the trigger, not an input
  useEffect(() => {
    pending.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const v = view.current;
    if (!v || v.fitted) return;
    v.setCamera(null);
    latest.current.onChange();
  }, [deckId, view]);

  // The canvas resized (window, panels) or the slide size changed while zoomed: a camera stays
  // where it is (StageView), so pull the slide back into reach if it ended up off-screen.
  const reclamp = useCallback(() => {
    const v = view.current;
    const size = viewportSize();
    if (!v || !size || v.fitted || pending.current !== null) return;
    const cam = v.camera;
    const kept = keepVisible(cam, size, latest.current.stage);
    if (kept.x !== cam.x || kept.y !== cam.y) set(kept);
  }, [view, viewportSize, set]);
  useEffect(() => {
    const el = view.current?.stage.parentElement;
    if (!el) return;
    const observer = new ResizeObserver(reclamp);
    observer.observe(el);
    return () => observer.disconnect();
  }, [view, reclamp]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the slide size is the trigger
  useEffect(reclamp, [stage.w, stage.h, reclamp]);

  // ── Wheel: zoom with Ctrl/⌘ (and pinch), pan otherwise ──────────────────────────
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Never the page's own zoom or scroll; and nothing moves under a running drag.
      e.preventDefault();
      if (latest.current.busy) return;
      const cam = current();
      const viewport = view.current?.stage.parentElement;
      if (!cam || !viewport) return;
      if (e.ctrlKey || e.metaKey) {
        const box = viewport.getBoundingClientRect();
        const at = { x: e.clientX - box.left, y: e.clientY - box.top };
        set(zoomAt(cam, cam.scale * wheelZoomFactor(e.deltaY, e.deltaMode), at));
      } else {
        set(panBy(cam, wheelPan(e)));
      }
    };
    // Not passive: preventDefault must stop Ctrl+wheel zooming the whole page.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wrapper, view, current, set]);

  // The zoom commands (View menu, Ctrl + "+"/"-", Shift + 0/1/2) live in the registry (D89).
  useEffect(
    () => setCameraControls({ zoomIn, zoomOut, zoomToFit, zoomTo100, zoomToSelection }),
    [zoomIn, zoomOut, zoomToFit, zoomTo100, zoomToSelection],
  );

  // ── Space (hand tool) while the pointer is over the canvas ──────────────────────
  useEffect(() => {
    let over = false;
    const el = wrapper.current;
    const enter = () => {
      over = true;
    };
    const leave = () => {
      over = false;
    };
    el?.addEventListener("pointerenter", enter);
    el?.addEventListener("pointerleave", leave);

    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return; // typing in a field or into a text layer
      if (e.code === "Space" && (over || latest.current.spaceHeld)) {
        e.preventDefault(); // no page scroll, no pressing a focused button
        if (!e.repeat) setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      el?.removeEventListener("pointerenter", enter);
      el?.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [wrapper]);

  // ── Drag to pan: Space + left button, or the middle button ──────────────────────
  /** Starts a pan if this press is one; returns true when it took the press. */
  const startPan = useCallback(
    (e: React.PointerEvent): boolean => {
      const { spaceHeld: space, hand: handTool, busy: moving } = latest.current;
      const hand = e.button === 1 || (e.button === 0 && (space || handTool));
      if (!hand || moving) return false;
      const el = wrapper.current;
      if (!el) return false;
      e.preventDefault(); // middle button: no autoscroll
      e.stopPropagation();
      const pointerId = e.pointerId;
      const unblockPaste = e.button === 1 ? blockMiddleClickPaste() : null;
      let last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(pointerId);
      setPanning(true);
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const cam = current();
        if (cam) set(panBy(cam, { x: ev.clientX - last.x, y: ev.clientY - last.y }));
        last = { x: ev.clientX, y: ev.clientY };
      };
      // Up, cancelled, or the capture lost some other way (the window lost focus mid-drag):
      // any of them ends the pan, or the hand would stay stuck "grabbing".
      const ends = ["pointerup", "pointercancel", "lostpointercapture"] as const;
      const done = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        el.removeEventListener("pointermove", move);
        for (const type of ends) el.removeEventListener(type, done);
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
        unblockPaste?.();
        setPanning(false);
      };
      el.addEventListener("pointermove", move);
      for (const type of ends) el.addEventListener(type, done);
      return true;
    },
    [wrapper, current, set],
  );

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return {
    spaceHeld,
    panning,
    startPan,
    zoomIn,
    zoomOut,
    zoomToFit,
    zoomTo100,
    zoomToSelection,
  };
}
