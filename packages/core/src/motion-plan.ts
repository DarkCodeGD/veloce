/**
 * Planning motion for the compositor (D107, D115): what presenting hands the browser so it
 * plays on the GPU, smooth even while the app is busy.
 *
 * Each layer's motion from now on, as the evaluator computes it, is sampled into clips of
 * keyframes: one clip up to when it stops changing, and one more that repeats forever when
 * it loops. The browser draws straight lines between keyframes, so keyframes go only where
 * the curve needs them: a stretch is split until the straight line is within a quarter
 * pixel (a tenth of a degree, a 255th of opacity) of the real curve everywhere checked.
 * Calm easing needs few keyframes, a springy bounce many.
 *
 * Why sample instead of handing over the easing: a layer's channels come from several
 * animations at once (a fade-in on its own timing, a pulse looping), and they all land in
 * one `transform`; one Web Animation per animation would replace the others, not add to
 * them. Sampled, the renderer composes every keyframe with its own `drawnCss`.
 */
import type { CompiledSlide, PlayPosition } from "./evaluate.js";
import { MOTION_CHANNELS, type MotionState, resolveMotion } from "./motion.js";

/** Keyframes of one layer's motion, at slide times (ms since the slide appeared). */
export interface MotionClip {
  /** When it starts: `times[0]`. */
  start: number;
  /** Increasing, first and last included. */
  times: number[];
  states: MotionState[];
  /** Repeats from its first keyframe forever (its last state equals its first). */
  loop: boolean;
}

/** A layer's plan: clips for the compositor, or `"clock"` when they can't express it. */
export type LayerMotionPlan = readonly MotionClip[] | "clock";

export interface MotionPlanOptions {
  /** How far apart keyframes start before splitting, in ms. Default: 1/30 s. */
  grid?: number;
  /** The closest two keyframes get, in ms. Default: 4. */
  minGap?: number;
}

/** How much of each channel a straight line may miss by: what nobody can see. */
const TOLERANCE: Record<(typeof MOTION_CHANNELS)[number], number> = {
  x: 0.25,
  y: 0.25,
  z: 0.25,
  rotate: 0.1,
  rotateX: 0.1,
  rotateY: 0.1,
  scale: 0.0005,
  scaleX: 0.0005,
  scaleY: 0.0005,
  opacity: 1 / 255,
  blur: 0.25,
};

/**
 * Every animated layer's motion from `position` on, given the clicks so far. Layers that
 * won't move again get no clips (they hold where `position` puts them); loops that don't
 * line up within a minute play on the clock instead.
 */
export function planMotion(
  compiled: CompiledSlide,
  position: PlayPosition,
  options: MotionPlanOptions = {},
): Map<string, LayerMotionPlan> {
  const grid = options.grid ?? 1000 / 30;
  const minGap = options.minGap ?? 4;
  const plans = new Map<string, LayerMotionPlan>();
  for (const [id, activity] of compiled.activity(position.clicks)) {
    const span = activity.motion;
    if (!span) continue;
    if (span.period === Number.POSITIVE_INFINITY) {
      plans.set(id, "clock");
      continue;
    }
    const stateAt = (time: number): MotionState =>
      compiled.layerAt(id, { time, clicks: position.clicks })?.motion ?? {};
    const clips: MotionClip[] = [];
    const now = position.time;
    if (span.until > now) clips.push(sampleClip(stateAt, now, span.until, grid, minGap, false));
    if (span.period !== null) {
      const from = Math.max(now, span.until);
      clips.push(sampleClip(stateAt, from, from + span.period, grid, minGap, true));
    }
    if (clips.length > 0) plans.set(id, clips);
  }
  return plans;
}

function sampleClip(
  stateAt: (time: number) => MotionState,
  from: number,
  to: number,
  grid: number,
  minGap: number,
  loop: boolean,
): MotionClip {
  const times: number[] = [from];
  const states: MotionState[] = [stateAt(from)];
  const split = (t0: number, s0: MotionState, t1: number, s1: MotionState): void => {
    const mid = (t0 + t1) / 2;
    const sm = stateAt(mid);
    if (t1 - t0 > minGap * 2 && !closeToLine(s0, s1, sm)) {
      split(t0, s0, mid, sm);
      split(mid, sm, t1, s1);
      return;
    }
    times.push(t1);
    states.push(s1);
  };
  const count = Math.max(1, Math.ceil((to - from) / grid));
  for (let i = 1; i <= count; i++) {
    const t = i === count ? to : from + ((to - from) * i) / count;
    const previous = times.length - 1;
    split(times[previous] as number, states[previous] as MotionState, t, stateAt(t));
  }
  // A loop's last keyframe is its first again, exactly: no seam when it repeats.
  if (loop) states[states.length - 1] = states[0] as MotionState;
  return { start: from, times, states, loop };
}

/** True when `mid` is within tolerance of halfway between `a` and `b` on every channel. */
function closeToLine(a: MotionState, b: MotionState, mid: MotionState): boolean {
  const ra = resolveMotion(a);
  const rb = resolveMotion(b);
  const rm = resolveMotion(mid);
  return MOTION_CHANNELS.every((c) => Math.abs((ra[c] + rb[c]) / 2 - rm[c]) <= TOLERANCE[c]);
}
