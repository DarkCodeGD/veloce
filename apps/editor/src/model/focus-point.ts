/**
 * An image's focus point (D82), pure: `{ x, y }` as fractions of the image (0–1), the point that
 * stays in view when the layer crops it. The renderer turns it into `object-position: x% y%`,
 * which lines the image's x% point up with the box's x% point, so the visible part slides
 * toward the focus without ever leaving the image.
 */

export interface Focus {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
/** A rectangle in fractions of the image (0–1). */
export interface FractionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The default: the centre (what the renderer uses when `focus` isn't set). */
export const CENTER: Focus = { x: 0.5, y: 0.5 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
/** Stored to 0.1%: finer than a pixel on any slide image, and short in the JSON. */
const round = (v: number) => Math.round(v * 1000) / 1000;

/** A stored value made safe to draw: missing → centre, out of range → clamped. */
export function focusOf(value: unknown): Focus {
  if (!value || typeof value !== "object") return CENTER;
  const { x, y } = value as Partial<Focus>;
  return {
    x: typeof x === "number" ? clamp01(x) : 0.5,
    y: typeof y === "number" ? clamp01(y) : 0.5,
  };
}

/** The part of the image a `cover` fit shows in `box`, with the focus where it is. */
export function visibleCrop(image: Size, box: Size, focus: Focus): FractionRect {
  if (image.w <= 0 || image.h <= 0 || box.w <= 0 || box.h <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  // Cover scales the image up until it fills the box on both axes; the excess is cropped.
  const scale = Math.max(box.w / image.w, box.h / image.h);
  const w = Math.min(1, box.w / (image.w * scale));
  const h = Math.min(1, box.h / (image.h * scale));
  return { x: (1 - w) * focus.x, y: (1 - h) * focus.y, w, h };
}

/** True when the box crops the image at all (else the focus changes nothing). */
export const crops = (crop: FractionRect) => crop.w < 0.999 || crop.h < 0.999;

/** The focus under a pointer on the image's preview (screen pixels), clamped to the image. */
export function focusAt(pointer: { x: number; y: number }, image: DOMRectLike): Focus {
  return {
    x: round(clamp01((pointer.x - image.left) / (image.width || 1))),
    y: round(clamp01((pointer.y - image.top) / (image.height || 1))),
  };
}
export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Arrow keys move it 1% (Shift: 10%). Null for any other key. */
export function nudgeFocus(focus: Focus, key: string, shift: boolean): Focus | null {
  const step = shift ? 0.1 : 0.01;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = moves[key];
  if (!move) return null;
  return { x: round(clamp01(focus.x + move[0])), y: round(clamp01(focus.y + move[1])) };
}

/** "50% across, 20% down": for the readout and screen readers. */
export const focusText = (f: Focus) =>
  `${Math.round(f.x * 100)}% across, ${Math.round(f.y * 100)}% down`;
