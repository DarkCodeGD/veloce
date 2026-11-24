/**
 * The timeline evaluator (D105 §1, D114): where every animated layer of a slide is at one
 * moment. Pure and deterministic: the same slide and moment give the same frame, which is
 * what scrubbing, MP4 export and the determinism test rely on (golden rule 3).
 *
 * **A moment is a time and the clicks before it.** `time` is milliseconds since the slide
 * appeared; `clicks` are when each step after the first began. Presenting passes the real
 * clicks, export and scrubbing pass ones where each step plays out first (`seek`), and the
 * same function draws all three.
 *
 * Compile once per edit (`compileSlide`: easings solved, colors parsed, the schedule laid
 * out), then evaluate per frame (`at`), which only does arithmetic.
 *
 * **Which animation shows**, per layer and per channel or property: the one that started
 * last (by time; in list order on a tie). Before any has started, the first one's start
 * holds, so a layer that fades in on the third click stays hidden until then. After one
 * ends, its end holds until another starts.
 */
import { mixColors, rgbaToHex } from "./color-mix.js";
import { type EasingFunction, easingFunction } from "./easing.js";
import { parseCssColor, type Rgba } from "./measure.js";
import { MOTION_CHANNELS, type MotionState, resolveMotion } from "./motion.js";
import {
  type MotionTokens,
  resolveEasing,
  resolveTime,
  slideMotionTokens,
} from "./motion-tokens.js";
import type { Animation, EffectRef, Keyframe, Tracks } from "./schema/animation.js";
import type { Deck, Slide } from "./schema/deck.js";
import type { Node } from "./schema/node.js";
import type { Theme } from "./schema/theme.js";
import {
  type AnimationDefaults,
  DEFAULT_DURATION,
  DEFAULT_EASING,
  type Step,
  scheduleSlide,
} from "./timeline.js";
import { isTokenRef, resolveColor, resolveToken } from "./tokens.js";
import { walkNodes } from "./tree.js";

// ── Public types ─────────────────────────────────────────────────────────────────────

/** A slide's playback moment: milliseconds since it appeared, and when each click came. */
export interface PlayPosition {
  time: number;
  /** `clicks[0]` is when step 1 began, `clicks[1]` step 2… Steps not clicked yet: absent. */
  clicks: readonly number[];
}

/** One layer at one moment: only what its animations set. */
export interface LayerFrame {
  /** Motion channels, drawn on top of the layout by the motion slot (D103). */
  motion: MotionState;
  /** `props.*` and `style.*` tracks by key: numbers, colors as hex, or a value as stored. */
  properties: Record<string, unknown>;
}

/** Every animated layer at one moment, by layer ID. */
export type SlideFrame = ReadonlyMap<string, LayerFrame>;

/** What an effect turns into for one animation (the effect presets item provides them). */
export interface ResolvedEffect extends AnimationDefaults {
  tracks: Tracks;
}
export interface EffectContext {
  animation: Animation;
  target: Node;
  tokens: MotionTokens;
}
/** Turns an effect into tracks, or null when it's unknown (the animation then does nothing). */
export type EffectResolver = (effect: EffectRef, context: EffectContext) => ResolvedEffect | null;

export interface CompileOptions {
  effects?: EffectResolver;
}

export interface CompiledSlide {
  /** When each animation plays (the same schedule the editor's steps list shows). */
  steps: Step[];
  /** The frame at a moment of a performance. */
  at(position: PlayPosition): SlideFrame;
  /** The frame `time` ms into `step`, every step before it played to its end. */
  seek(step: number, time: number): SlideFrame;
}

/**
 * Where `seek(step, time)` is as a performance: each click comes as the step before it ends
 * (`forever` animations count one play, as in the schedule).
 */
export function seekPosition(steps: readonly Step[], step: number, time: number): PlayPosition {
  const last = Math.max(0, Math.min(Math.floor(step), steps.length - 1));
  const clicks: number[] = [];
  let at = 0;
  for (let s = 0; s < last; s++) {
    at += steps[s]?.duration ?? 0;
    clicks.push(at);
  }
  return { time: at + time, clicks };
}

// ── Compile ──────────────────────────────────────────────────────────────────────────

/** A track value, parsed once: numbers and colors interpolate; anything else switches. */
type Value =
  | { kind: "number"; n: number }
  | { kind: "color"; c: Rgba }
  | { kind: "other"; v: unknown };

interface Segment {
  from: number;
  to: number;
  a: Value;
  b: Value;
  ease: EasingFunction;
}

interface CompiledTrack {
  channel: boolean;
  segments: Segment[];
  /** A property's numbers stay within the values its keyframes give (no overshoot). */
  min: number;
  max: number;
}

interface Entry {
  step: number;
  /** Milliseconds from its step's start. */
  start: number;
  /** One play. */
  duration: number;
  plays: number;
  alternate: boolean;
  track: CompiledTrack;
}

const REST = resolveMotion(undefined);
const CHANNELS: ReadonlySet<string> = new Set(MOTION_CHANNELS);

/** Prepares a slide's animations for evaluation, with the deck's theme and motion level. */
export function compileSlide(
  deck: Pick<Deck, "theme" | "motionLevel">,
  slide: Slide,
  options: CompileOptions = {},
): CompiledSlide {
  const tokens = slideMotionTokens(deck, slide);
  const nodes = new Map<string, Node>();
  for (const { node } of walkNodes(slide.root)) nodes.set(node.id, node);

  const effects = new Map<string, ResolvedEffect | null>();
  for (const animation of slide.animations ?? []) {
    const target = nodes.get(animation.target);
    if (!animation.effect || !target) continue;
    effects.set(
      animation.id,
      options.effects?.(animation.effect, { animation, target, tokens }) ?? null,
    );
  }
  const steps = scheduleSlide(slide, tokens, (a) => effects.get(a.id) ?? undefined);

  // target → track key → entries in play order (step, start, list order).
  const groups = new Map<string, Map<string, Entry[]>>();
  steps.forEach((step, stepIndex) => {
    for (const { animation, start, forever } of step.animations) {
      const target = nodes.get(animation.target);
      const effect = effects.get(animation.id);
      const tracks = animation.tracks ?? effect?.tracks;
      if (!target || !tracks) continue;
      const easing = resolveEasing(animation.easing ?? effect?.easing ?? DEFAULT_EASING, tokens);
      const duration = resolveTime(
        animation.duration ?? effect?.duration ?? DEFAULT_DURATION,
        tokens,
      );
      const plays = forever
        ? Number.POSITIVE_INFINITY
        : typeof animation.repeat === "number"
          ? animation.repeat
          : 1;
      for (const [key, keyframes] of Object.entries(tracks)) {
        const track = compileTrack(
          key,
          keyframes,
          target,
          easingFunction(easing),
          tokens,
          deck.theme,
        );
        if (!track) continue;
        const byKey = groups.get(target.id) ?? new Map<string, Entry[]>();
        groups.set(target.id, byKey);
        const entries = byKey.get(key) ?? [];
        byKey.set(key, entries);
        entries.push({
          step: stepIndex,
          start,
          duration,
          plays,
          alternate: animation.alternate === true,
          track,
        });
      }
    }
  });
  for (const byKey of groups.values()) {
    for (const entries of byKey.values())
      entries.sort((x, y) => x.step - y.step || x.start - y.start);
  }

  const at = (position: PlayPosition): SlideFrame => evaluate(groups, position);
  return { steps, at, seek: (step, time) => at(seekPosition(steps, step, time)) };
}

function compileTrack(
  key: string,
  keyframes: readonly Keyframe[],
  target: Node,
  easing: EasingFunction,
  tokens: MotionTokens,
  theme: Theme,
): CompiledTrack | null {
  const channel = CHANNELS.has(key);
  const own = channel ? REST[key as keyof typeof REST] : ownValue(target, key);
  const points: { at: number; value: Value; ease: EasingFunction }[] = keyframes.map((k) => ({
    at: k.at,
    value: parseValue(k.value, theme),
    ease: k.easing ? easingFunction(resolveEasing(k.easing, tokens)) : easing,
  }));
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  // A track without a keyframe at 0 or 1 runs from or to the layer's own value (D110 §3);
  // a property the layer doesn't set holds the nearest keyframe instead.
  const fallback = own === undefined ? undefined : parseValue(own, theme);
  if (first.at > 0) points.unshift({ at: 0, value: fallback ?? first.value, ease: easing });
  if (last.at < 1) points.push({ at: 1, value: fallback ?? last.value, ease: easing });

  const segments: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b) segments.push({ from: a.at, to: b.at, a: a.value, b: b.value, ease: a.ease });
  }
  const numbers = points.flatMap((p) => (p.value.kind === "number" ? [p.value.n] : []));
  return {
    channel,
    segments,
    min: Math.min(...numbers, Number.POSITIVE_INFINITY),
    max: Math.max(...numbers, Number.NEGATIVE_INFINITY),
  };
}

/** The value a layer itself has at a `props.*` or `style.*` path, if any. */
function ownValue(node: Node, key: string): unknown {
  const [group, ...path] = key.split(".");
  let value: unknown =
    group === "props" && node.kind === "element"
      ? node.props
      : group === "style" && node.kind === "frame"
        ? node.style
        : undefined;
  for (const part of path) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, part))
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Numbers as numbers, colors (hex, tokens, `transparent`) as RGBA, number tokens resolved. */
function parseValue(raw: unknown, theme: Theme): Value {
  if (typeof raw === "number") return { kind: "number", n: raw };
  if (typeof raw === "string") {
    if (raw.startsWith("#") || raw.startsWith("$color.") || raw === "transparent") {
      const resolved = resolveColor(theme, raw);
      const c = resolved === undefined ? null : parseCssColor(resolved);
      if (c) return { kind: "color", c };
    } else if (isTokenRef(raw)) {
      const token = resolveToken(theme, raw);
      if (typeof token === "number") return { kind: "number", n: token };
    }
  }
  return { kind: "other", v: raw };
}

// ── Evaluate ─────────────────────────────────────────────────────────────────────────

function evaluate(groups: Map<string, Map<string, Entry[]>>, position: PlayPosition): SlideFrame {
  const frame = new Map<string, LayerFrame>();
  for (const [target, byKey] of groups) {
    const layer: LayerFrame = { motion: {}, properties: {} };
    for (const [key, entries] of byKey) {
      // The animation that started last shows; before any started, the first one's start.
      let chosen: Entry | undefined;
      let chosenStart = Number.NEGATIVE_INFINITY;
      for (const entry of entries) {
        const stepStart = entry.step === 0 ? 0 : position.clicks[entry.step - 1];
        if (stepStart === undefined) continue;
        const start = stepStart + entry.start;
        if (start <= position.time && start >= chosenStart) {
          chosen = entry;
          chosenStart = start;
        }
      }
      const entry = chosen ?? entries[0];
      if (!entry) continue;
      const progress = chosen ? progressAt(position.time - chosenStart, entry) : 0;
      const value = valueAt(entry.track, progress);
      if (entry.track.channel) {
        if (typeof value === "number") layer.motion[key as keyof MotionState] = value;
      } else {
        layer.properties[key] = value;
      }
    }
    frame.set(target, layer);
  }
  return frame;
}

/** Where in one play an animation is, `elapsed` ms after it started: 0 → 1. */
function progressAt(elapsed: number, entry: Entry): number {
  const { duration, plays, alternate } = entry;
  if (elapsed >= duration * plays) {
    // Finished: it holds where its last play ended (backwards after an even alternate).
    return alternate && (plays - 1) % 2 === 1 ? 0 : 1;
  }
  const play = Math.floor(elapsed / duration);
  const progress = (elapsed - play * duration) / duration;
  return alternate && play % 2 === 1 ? 1 - progress : progress;
}

function valueAt(track: CompiledTrack, progress: number): unknown {
  const { segments } = track;
  let segment = segments[0];
  for (const s of segments) {
    if (progress >= s.from) segment = s;
    else break;
  }
  if (!segment) return undefined;
  const span = segment.to - segment.from;
  const eased = segment.ease(
    span > 0 ? Math.min(1, Math.max(0, (progress - segment.from) / span)) : 1,
  );
  const { a, b } = segment;
  if (a.kind === "number" && b.kind === "number") {
    const n = a.n + (b.n - a.n) * eased;
    // Motion channels may overshoot (that's a spring); a property can't leave its range.
    return track.channel ? n : Math.min(track.max, Math.max(track.min, n));
  }
  if (a.kind === "color" && b.kind === "color") return rgbaToHex(mixColors(a.c, b.c, eased));
  // Values that can't blend (a gradient and a color, two words) switch halfway, as in CSS.
  return output(eased < 0.5 ? a : b);
}

function output(value: Value): unknown {
  if (value.kind === "number") return value.n;
  if (value.kind === "color") return rgbaToHex(value.c);
  return value.v;
}
