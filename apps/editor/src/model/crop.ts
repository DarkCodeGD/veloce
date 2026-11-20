/**
 * Crop mode's maths (D84), pure. A crop is the part of a picture a layer shows, as fractions
 * of the picture (`{ x, y, w, h }`). In crop mode the layer's box is a **window** onto the
 * whole **picture** laid out behind it; both are rectangles in the layer's own axes (slide
 * pixels, rotation removed), measured from the window's top-left as it was when the gesture
 * started. Every gesture moves one of them and reads the crop back:
 *
 * - **move**: the window slides over a fixed picture (the layer moves on the slide);
 * - **pan**: the picture slides behind a fixed window;
 * - **trim**: the window's edges move over a fixed picture (the layer gets smaller or bigger);
 * - **scale**: the picture grows or shrinks behind a fixed window, keeping its aspect ratio.
 *
 * The one invariant: the window always stays on the picture, so a crop never shows empty
 * space. When the window has the crop's aspect ratio (crop mode keeps it so), the layer
 * shows exactly the crop and `fit`/`focus` have nothing left to do.
 */

import { type Focus, type Size, visibleCrop } from "./focus-point.js";
import type { Handle, Point, Rect } from "./geometry.js";
import { handleDirection } from "./geometry.js";

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest a trimmed window gets, in slide pixels. */
export const MIN_WINDOW = 8;
/** How far the picture can be scaled up: its width at most this many windows. */
export const MAX_ZOOM = 40;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/** A stored crop, if `value` is one (anything else counts as no crop). */
export function cropOf(value: unknown): Crop | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, w, h } = value as Record<string, unknown>;
  const ok = [x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v));
  return ok && (w as number) > 0 && (h as number) > 0 ? (value as Crop) : null;
}

/**
 * The crop crop mode starts from: the stored one, else exactly what the layer shows now
 * (the picture covering the box, aimed by its focus).
 */
export function startingCrop(stored: unknown, image: Size, box: Size, focus: Focus): Crop {
  return cropOf(stored) ?? visibleCrop(image, box, focus);
}

/** Where the whole picture sits for `crop`, relative to a window of `size` at the origin. */
export function pictureRect(crop: Crop, size: Size): Rect {
  const w = size.w / crop.w;
  const h = size.h / crop.h;
  return { x: -crop.x * w, y: -crop.y * h, w, h };
}

/** The crop a window shows of a picture (same coordinates), on the picture, to 0.01%. */
export function cropFor(picture: Rect, window: Rect): Crop {
  const w = clamp(window.w / picture.w, 0.0001, 1);
  const h = clamp(window.h / picture.h, 0.0001, 1);
  const x = clamp((window.x - picture.x) / picture.w, 0, 1 - w);
  const y = clamp((window.y - picture.y) / picture.h, 0, 1 - h);
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}

/** Pan: the picture moves by `d`, as far as the window stays on it. */
export function panPicture(picture: Rect, window: Rect, d: Point): Rect {
  return {
    ...picture,
    x: clamp(picture.x + d.x, window.x + window.w - picture.w, window.x),
    y: clamp(picture.y + d.y, window.y + window.h - picture.h, window.y),
  };
}

/** Move: the window slides by `d` over the picture, as far as it stays on it. */
export function moveWindow(picture: Rect, window: Rect, d: Point): Rect {
  return {
    ...window,
    x: clamp(window.x + d.x, picture.x, picture.x + picture.w - window.w),
    y: clamp(window.y + d.y, picture.y, picture.y + picture.h - window.h),
  };
}

/**
 * Trim: the dragged edge(s) of the window move by `d`, stopping at the picture's edges and
 * at `MIN_WINDOW` (or the window's own size, if it's already smaller).
 */
export function trimWindow(picture: Rect, window: Rect, handle: Handle, d: Point): Rect {
  const dir = handleDirection(handle);
  let [x0, x1] = [window.x, window.x + window.w];
  let [y0, y1] = [window.y, window.y + window.h];
  const minW = Math.min(MIN_WINDOW, window.w);
  const minH = Math.min(MIN_WINDOW, window.h);
  if (dir.x < 0) x0 = clamp(x0 + d.x, picture.x, x1 - minW);
  if (dir.x > 0) x1 = clamp(x1 + d.x, x0 + minW, picture.x + picture.w);
  if (dir.y < 0) y0 = clamp(y0 + d.y, picture.y, y1 - minH);
  if (dir.y > 0) y1 = clamp(y1 + d.y, y0 + minH, picture.y + picture.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Scale: dragging a corner of the picture by `d` grows or shrinks it about the opposite
 * corner (or its centre), keeping its aspect ratio. It never gets so small that the window
 * would leave it, nor wider than `MAX_ZOOM` windows.
 */
export function scalePicture(
  picture: Rect,
  window: Rect,
  corner: Handle,
  d: Point,
  fromCenter = false,
): Rect {
  const dir = handleDirection(corner);
  const ax = fromCenter ? picture.x + picture.w / 2 : dir.x > 0 ? picture.x : picture.x + picture.w;
  const ay = fromCenter ? picture.y + picture.h / 2 : dir.y > 0 ? picture.y : picture.y + picture.h;
  const spanX = fromCenter ? picture.w / 2 : picture.w;
  const spanY = fromCenter ? picture.h / 2 : picture.h;
  // How far the corner moved outwards, as a share of the picture, averaged over both axes.
  const wanted = 1 + ((dir.x * d.x) / spanX + (dir.y * d.y) / spanY) / 2;

  // The smallest scale that still covers the window: each picture edge on the far side of
  // the anchor must stay beyond the window's edge.
  const x0 = picture.x;
  const x1 = picture.x + picture.w;
  const y0 = picture.y;
  const y1 = picture.y + picture.h;
  const needs = [
    x0 < ax ? (ax - window.x) / (ax - x0) : 0,
    x1 > ax ? (window.x + window.w - ax) / (x1 - ax) : 0,
    y0 < ay ? (ay - window.y) / (ay - y0) : 0,
    y1 > ay ? (window.y + window.h - ay) / (y1 - ay) : 0,
  ];
  const most = (MAX_ZOOM * window.w) / picture.w;
  const s = clamp(wanted, Math.max(...needs), Math.max(most, Math.max(...needs)));
  return {
    x: ax + (x0 - ax) * s,
    y: ay + (y0 - ay) * s,
    w: picture.w * s,
    h: picture.h * s,
  };
}
