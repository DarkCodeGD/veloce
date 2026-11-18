/**
 * Geometry for direct manipulation on the canvas, in slide pixels. Pure (no DOM), so every
 * handle's behaviour is unit-tested.
 *
 * A node's box is described by its centre, its unrotated size and its rotation, because
 * that's how CSS renders it: `rotate()` turns the box around its centre, so the centre is
 * also the centre of the on-screen bounding box, and the size is the layout size.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation: number;
}

/** Axis-aligned rectangle (top-left + size). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Which way a handle pulls: -1 = left/top, 1 = right/bottom, 0 = not on that axis. */
export function handleDirection(handle: Handle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  return {
    x: handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
    y: handle.startsWith("n") ? -1 : handle.startsWith("s") ? 1 : 0,
  };
}

const RAD = Math.PI / 180;

/** Rotate a vector clockwise by `degrees` (screen coordinates: y points down). */
export function rotateVector(v: Point, degrees: number): Point {
  const a = degrees * RAD;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

export interface ResizeOptions {
  /** Shift: keep the aspect ratio. */
  keepRatio?: boolean;
  /** Alt: resize around the centre instead of the opposite side. */
  fromCenter?: boolean;
  /** Smallest size allowed (default 1). */
  minSize?: number;
}

/**
 * Resize `start` by dragging `handle` by `delta` (pointer movement in slide pixels). The
 * opposite side (or corner) stays where it is, also for rotated boxes: the movement is
 * measured along the box's own axes, and the centre moves to keep the anchor fixed.
 */
export function resizeBox(
  start: Box,
  handle: Handle,
  delta: Point,
  options: ResizeOptions = {},
): Box {
  const dir = handleDirection(handle);
  const min = options.minSize ?? 1;
  const factor = options.fromCenter ? 2 : 1;
  const local = rotateVector(delta, -start.rotation);

  let w = dir.x === 0 ? start.w : Math.max(min, start.w + dir.x * local.x * factor);
  let h = dir.y === 0 ? start.h : Math.max(min, start.h + dir.y * local.y * factor);

  if (options.keepRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (dir.x !== 0 && dir.y !== 0) {
      // Corner: follow whichever axis moved more, proportionally.
      const sx = w / start.w;
      const sy = h / start.h;
      const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      w = Math.max(min, start.w * s);
      h = Math.max(min, start.h * s);
    } else if (dir.x !== 0) {
      h = Math.max(min, w / ratio);
    } else {
      w = Math.max(min, h * ratio);
    }
  }

  return anchoredBox(start, handle, w, h, options.fromCenter);
}

/**
 * `start` resized to `w` × `h` by `handle`, with the opposite side (or the centre, with
 * `fromCenter`) kept in place. Lets callers round sizes without the anchor drifting.
 */
export function anchoredBox(
  start: Box,
  handle: Handle,
  w: number,
  h: number,
  fromCenter = false,
): Box {
  if (fromCenter) return { ...start, w, h };
  const dir = handleDirection(handle);
  // Shift the centre by half the growth towards the dragged side(s), in the box's axes.
  const shift = rotateVector(
    { x: (dir.x * (w - start.w)) / 2, y: (dir.y * (h - start.h)) / 2 },
    start.rotation,
  );
  return { ...start, w, h, cx: start.cx + shift.x, cy: start.cy + shift.y };
}

/** Normalise an angle to (-180, 180]. */
export function normalizeAngle(degrees: number): number {
  let a = degrees % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return a;
}

/** Rotation snaps to this step while Shift is held. */
export const ROTATION_SNAP = 15;

/**
 * The rotation after dragging the rotate handle from `from` to `to` around the box centre.
 * Shift snaps to 15° steps; otherwise one decimal place.
 */
export function rotateBox(start: Box, from: Point, to: Point, snap = false): number {
  const a0 = Math.atan2(from.y - start.cy, from.x - start.cx);
  const a1 = Math.atan2(to.y - start.cy, to.x - start.cx);
  const angle = normalizeAngle(start.rotation + (a1 - a0) / RAD);
  const rounded = snap
    ? Math.round(angle / ROTATION_SNAP) * ROTATION_SNAP
    : Math.round(angle * 10) / 10;
  return normalizeAngle(rounded) + 0; // + 0 turns -0 into 0
}

/** The unrotated top-left corner of a box (what CSS `left`/`top` position). */
export function topLeft(box: Box): Point {
  return { x: box.cx - box.w / 2, y: box.cy - box.h / 2 };
}

/** The axis-aligned bounding rectangle of a (possibly rotated) box. */
export function boundingRect(box: Box): Rect {
  const a = box.rotation * RAD;
  const w = Math.abs(box.w * Math.cos(a)) + Math.abs(box.h * Math.sin(a));
  const h = Math.abs(box.w * Math.sin(a)) + Math.abs(box.h * Math.cos(a));
  return { x: box.cx - w / 2, y: box.cy - h / 2, w, h };
}

const HANDLE_ANGLE: Record<Handle, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};
const CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/** The resize cursor for a handle on a box rotated by `rotation` (it turns with the box). */
export function resizeCursor(handle: Handle, rotation: number): (typeof CURSORS)[number] {
  const angle = (((HANDLE_ANGLE[handle] + rotation) % 180) + 180) % 180;
  return CURSORS[Math.round(angle / 45) % 4] as (typeof CURSORS)[number];
}
