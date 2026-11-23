/**
 * Canvas zoom and pan as pure math (D60). A camera says where the slide is drawn in the
 * canvas viewport: its top-left corner in viewport pixels and its scale (screen pixels per
 * slide pixel, 1 = 100%). The renderer's StageView draws whatever camera it's given; this
 * module decides which camera a gesture or command leads to.
 *
 * Think of a map app: zooming keeps the point under your fingers still (`zoomAt`), panning
 * slides the map (`panBy`), and the map can't be flung off-screen entirely (`keepVisible`).
 */
import type { Point, Rect } from "./geometry.js";

/** Same shape as the renderer's `Camera` (model/ stays free of the renderer). */
export interface Camera {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** 10% to 1600%: far enough out to see a 4K stage on a laptop, in far enough to nudge pixels. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 16;

/** Where Zoom in / Zoom out stop (Figma-like: finer steps around 100%). */
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16] as const;

/** Space kept around the slide or selection when zooming to fit it, in screen pixels. */
export const FIT_PADDING = 48;

/** How much of the slide must stay on screen when panning, in screen pixels. */
export const VISIBLE_MARGIN = 64;

export const clampScale = (scale: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));

/** Zoom to `scale`, keeping the slide point under `at` (viewport pixels) where it is. */
export function zoomAt(camera: Camera, scale: number, at: Point): Camera {
  const next = clampScale(scale);
  // The slide point under the pointer, before and after: it must not move.
  const px = (at.x - camera.x) / camera.scale;
  const py = (at.y - camera.y) / camera.scale;
  return { scale: next, x: at.x - px * next, y: at.y - py * next };
}

/** The next zoom step in (`+1`) or out (`-1`) from `scale`. */
export function zoomStep(scale: number, dir: 1 | -1): number {
  const eps = 1e-3;
  const step =
    dir > 0
      ? ZOOM_STEPS.find((s) => s > scale * (1 + eps))
      : [...ZOOM_STEPS].reverse().find((s) => s < scale * (1 - eps));
  return step ?? (dir > 0 ? ZOOM_MAX : ZOOM_MIN);
}

/** Pixels per wheel "line" and "page" (deltaMode 1 and 2), as browsers roughly scroll them. */
const LINE = 16;
const PAGE = 800;
const toPixels = (delta: number, mode: number) =>
  mode === 1 ? delta * LINE : mode === 2 ? delta * PAGE : delta;

/**
 * The zoom factor for one Ctrl/⌘ + wheel event. Trackpad pinches arrive as many small
 * ctrl-wheel deltas (smooth zoom); a mouse wheel notch is ~100px, capped so one notch is
 * about a 22% step instead of a jump.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const d = Math.max(-25, Math.min(25, toPixels(deltaY, deltaMode)));
  return Math.exp(-d * 0.01);
}

/**
 * How far one plain wheel event pans the canvas, in viewport pixels (content moves opposite
 * to the scroll, like scrolling a page). Shift + a vertical wheel pans sideways.
 */
export function wheelPan(e: {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  shiftKey?: boolean;
}): Point {
  const mode = e.deltaMode ?? 0;
  let dx = toPixels(e.deltaX, mode);
  let dy = toPixels(e.deltaY, mode);
  if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
  return { x: -dx, y: -dy };
}

export const panBy = (camera: Camera, d: Point): Camera => ({
  ...camera,
  x: camera.x + d.x,
  y: camera.y + d.y,
});

/**
 * Keep at least `margin` pixels of the slide inside the viewport on each axis, so a fling of
 * the trackpad can't lose it. (A slide smaller than the margin just stays fully visible.)
 */
export function keepVisible(
  camera: Camera,
  viewport: Size,
  stage: Size,
  margin = VISIBLE_MARGIN,
): Camera {
  const clamp = (pos: number, size: number, view: number) => {
    const keep = Math.min(margin, size);
    return Math.min(view - keep, Math.max(keep - size, pos));
  };
  return {
    scale: camera.scale,
    x: clamp(camera.x, stage.w * camera.scale, viewport.w),
    y: clamp(camera.y, stage.h * camera.scale, viewport.h),
  };
}

/** The camera that shows `rect` (slide pixels) as large as fits, centered, with padding. */
export function cameraFor(rect: Rect, viewport: Size, padding = FIT_PADDING): Camera {
  const w = Math.max(1, rect.w);
  const h = Math.max(1, rect.h);
  const scale = clampScale(
    Math.min((viewport.w - padding * 2) / w, (viewport.h - padding * 2) / h),
  );
  return {
    scale,
    x: viewport.w / 2 - (rect.x + w / 2) * scale,
    y: viewport.h / 2 - (rect.y + h / 2) * scale,
  };
}

/**
 * Zoom in (`1`), out (`-1`) or neither (`0`) for a Mod + key press. Matched by the character
 * typed, not the physical key: "+" sits on another key on many layouts (German: right of Ü),
 * where Ctrl + "+" must still zoom the canvas instead of the whole page. The numpad works too.
 */
export function zoomKeyDirection(e: {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): 1 | -1 | 0 {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return 0;
  if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") return 1;
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") return -1;
  return 0;
}
