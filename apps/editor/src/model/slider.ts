/**
 * The math behind the editor's sliders (D122): where along the track a value sits, and the
 * value a pointer or a key lands on. Pure, so it's tested without a browser.
 *
 * Two flavours share it: **stepped** sliders pick one of a few named stops (the motion
 * level), evenly spaced; **continuous** ones pick a number between `min` and `max`, rounded
 * to `step`.
 */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ── Stepped ───────────────────────────────────────────────────────────────────────────

/** Where stop `index` of `count` sits along the track, 0–1. */
export const stopFraction = (index: number, count: number): number =>
  count <= 1 ? 0 : clamp(index, 0, count - 1) / (count - 1);

/** The stop nearest to a point along the track (0–1). */
export const nearestStop = (fraction: number, count: number): number =>
  count <= 1 ? 0 : Math.round(clamp(fraction, 0, 1) * (count - 1));

/**
 * The stop a key moves to from `index`: arrows step one, Page Up/Down two, Home and End
 * jump to the ends. Up and right go up; down and left go down. Null: not a slider key.
 */
export function stopForKey(key: string, index: number, count: number): number | null {
  const last = Math.max(0, count - 1);
  const by: Record<string, number> = {
    ArrowRight: 1,
    ArrowUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
    PageUp: 2,
    PageDown: -2,
  };
  if (key === "Home") return 0;
  if (key === "End") return last;
  const step = by[key];
  return step === undefined ? null : clamp(index + step, 0, last);
}

// ── Continuous ────────────────────────────────────────────────────────────────────────

export interface Range {
  min: number;
  max: number;
  /** Values land on multiples of it from `min`. Default: 1. */
  step?: number;
}

/** A value rounded to its step and kept in range (no float dust: 0.1 + 0.2 is 0.3). */
export function snapValue(value: number, { min, max, step = 1 }: Range): number {
  const snapped = min + Math.round((clamp(value, min, max) - min) / step) * step;
  const decimals = (String(step).split(".")[1] ?? "").length;
  return clamp(Number(snapped.toFixed(decimals)), min, max);
}

/** Where a value sits along the track, 0–1. */
export const valueFraction = (value: number, { min, max }: Range): number =>
  max === min ? 0 : clamp((value - min) / (max - min), 0, 1);

/** The value at a point along the track (0–1), snapped. */
export const valueAt = (fraction: number, range: Range): number =>
  snapValue(range.min + clamp(fraction, 0, 1) * (range.max - range.min), range);

/**
 * The value a key moves to: arrows one step (ten with Shift), Page Up/Down a tenth of the
 * range, Home and End the ends. Null: not a slider key.
 */
export function valueForKey(key: string, value: number, range: Range, big = false): number | null {
  const step = (range.step ?? 1) * (big ? 10 : 1);
  const page = Math.max(range.step ?? 1, (range.max - range.min) / 10);
  const by: Record<string, number> = {
    ArrowRight: step,
    ArrowUp: step,
    ArrowLeft: -step,
    ArrowDown: -step,
    PageUp: page,
    PageDown: -page,
  };
  if (key === "Home") return range.min;
  if (key === "End") return range.max;
  const delta = by[key];
  return delta === undefined ? null : snapValue(value + delta, range);
}
