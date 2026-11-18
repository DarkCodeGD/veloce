/**
 * Number scrubbing (drag a field's label to change its value) and keyboard nudging. Pure, so
 * the feel is tested without a browser.
 *
 * Speed: one `step` per pixel; Shift is 10× faster; Alt is 10× finer. The value keeps the
 * sub-step remainder while dragging (so Alt can creep through an integer field slowly), but
 * what's emitted is rounded to the field's precision. Rounding applies to the *change*, not
 * the value, so precision you already set survives: 60.5 nudged up is 61.5, not 62. Hitting `min`/`max` clamps the internal
 * value too, so dragging back responds at once instead of through a dead zone.
 */

export interface NumberConstraints {
  min?: number;
  max?: number;
  /** One unit of change (default 1). */
  step?: number;
  /** Only whole numbers. */
  integer?: boolean;
}

export interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
}

/** How much the value changes per pixel (scrub) or per key press (nudge). */
export function rate(mods: Modifiers, step = 1): number {
  if (mods.shiftKey) return step * 10;
  if (mods.altKey) return step / 10;
  return step;
}

export function clamp(value: number, c: NumberConstraints): number {
  return Math.min(
    c.max ?? Number.POSITIVE_INFINITY,
    Math.max(c.min ?? Number.NEGATIVE_INFINITY, value),
  );
}

/** More decimals than any slide value needs; also caps float noise in stored values. */
const MAX_DECIMALS = 6;

/** Decimal places in a number like 0.1 or 60.25 (floating-point safe). */
function decimals(n: number): number {
  const text = String(n);
  const exponent = /e-(\d+)$/.exec(text);
  if (exponent) return Math.min(MAX_DECIMALS, Number(exponent[1]));
  return Math.min(MAX_DECIMALS, text.includes(".") ? (text.split(".")[1]?.length ?? 0) : 0);
}

/**
 * Round to the field's precision: whole numbers for integer fields, otherwise the step (or a
 * tenth of it while Alt is held, so fine adjustments are visible). Only the distance from
 * `origin` (where the gesture started) is rounded, so the origin's own precision is kept;
 * pass the value itself as the origin to keep typed values exactly as typed.
 */
export function quantize(value: number, c: NumberConstraints, fine = false, origin = 0): number {
  const step = c.step ?? 1;
  const quantum = c.integer ? Math.max(1, Math.round(step)) : fine ? step / 10 : step;
  const base = c.integer ? Math.round(origin) : origin;
  const rounded = base + Math.round((value - base) / quantum) * quantum;
  // toFixed drops float noise like 0.30000000000000004; Number() drops trailing zeros.
  const places = Math.max(decimals(quantum), decimals(base));
  return clamp(Number(rounded.toFixed(places)), c);
}

/** One keyboard step (↑ = +1, ↓ = -1) with the same modifiers as scrubbing. */
export function nudge(
  value: number,
  direction: 1 | -1,
  mods: Modifiers,
  c: NumberConstraints,
): number {
  return quantize(clamp(value + direction * rate(mods, c.step), c), c, mods.altKey, value);
}

/** A drag in progress. Feed it pointer deltas; it returns the value to show. */
export class Scrub {
  #raw: number;
  readonly start: number;

  constructor(
    start: number,
    readonly constraints: NumberConstraints,
  ) {
    this.start = start;
    this.#raw = clamp(start, constraints);
  }

  /** Apply a horizontal pointer movement (pixels; right is positive). */
  move(dx: number, mods: Modifiers): number {
    this.#raw = clamp(this.#raw + dx * rate(mods, this.constraints.step), this.constraints);
    return quantize(this.#raw, this.constraints, mods.altKey, this.start);
  }
}

/**
 * Parse what someone typed into a number field: "12", " 12.5px", "50%", "-90°".
 * `null` for anything else (the field then keeps its value).
 */
export function parseNumber(text: string): number | null {
  const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(?:px|%|°|deg)?\s*$/i.exec(text);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}
