/**
 * The motion level and `$motion` tokens, resolved (D104, D111).
 *
 * A theme gives `$motion` tokens their values at the `subtle` level (its motion
 * personality); the deck's level, or a slide's own, scales them. Think of the theme as the
 * band's style and the level as the volume knob: Paper at `absurd` is still Paper, just
 * loud. Explicit numbers are never scaled: an animation that says 800 ms plays 800 ms at
 * every level, so a person's or agent's exact choice always wins.
 */
import type { Deck, Slide } from "./schema/deck.js";
import type {
  Easing,
  EasingValue,
  MotionLevel,
  ThemeMotion,
  Time,
  TimeToken,
} from "./schema/motion.js";
import type { Theme } from "./schema/theme.js";

/** The level a deck moves at when it sets none. */
export const DEFAULT_MOTION_LEVEL: MotionLevel = "subtle";

/**
 * Veloce's own motion personality, for themes that have none (every theme before format
 * v3, and custom ones that skip it): quick, with a long soft landing on the way in.
 */
export const DEFAULT_THEME_MOTION: ThemeMotion = {
  fast: 200,
  normal: 400,
  slow: 700,
  stagger: 80,
  enter: { cubicBezier: [0.16, 1, 0.3, 1] },
  exit: { cubicBezier: [0.7, 0, 0.84, 0] },
  move: { cubicBezier: [0.65, 0, 0.35, 1] },
  // Quick and clean: a fade, at the theme's normal speed.
  transition: { type: "fade", duration: "$motion.normal" },
};

/**
 * Which layers animate, by their role on the slide (D111 §7):
 * - `key`: the title and the slide's main point (the number, the chart, the hero image);
 * - `content`: everything that carries content, in reading order; not decoration;
 * - `most`: content plus supporting visuals (icons, dividers, backgrounds of cards);
 * - `all`: every layer.
 */
export type MotionReach = "key" | "content" | "most" | "all";
/** Which layers keep moving after they arrive (pulses, floats, loops), by the same roles. */
export type AmbientReach = "none" | "key" | "content" | "all";

/**
 * What a level does: how things move (the multipliers, relative to `subtle`, all 1) and how
 * much moves (reach, effects per layer, ambient motion).
 */
export interface MotionLevelScale {
  /** One line for people and agents: what this level looks like. */
  summary: string;
  /** Which layers animate. */
  reach: MotionReach;
  /** Most effects one layer gets on a slide (entrance, emphasis…); null: no limit. */
  effectsPerLayer: number | null;
  /** Which layers keep moving once they're in. */
  ambient: AmbientReach;
  /** Multiplies the duration tokens: calmer is slower, wilder is snappier. */
  time: number;
  /** Multiplies the stagger: wilder reveals pile up closer together. */
  stagger: number;
  /** How far effects travel and how big they get (read by the effect presets). */
  distance: number;
  /** Multiplies spring bounce (capped at 1): `calm` never bounces. */
  bounce: number;
}

/**
 * The five levels (D104 §1, D111). `calm` to `lively` stay tasteful; `intense` and `absurd`
 * are opt-in. This table is the whole definition: the choreography engine, the effect
 * presets, agents' docs and lint all read it, so tune here, nowhere else. Performance
 * budgets (D107 §4) still cap every level, `absurd` included.
 */
export const MOTION_LEVEL_SCALES: Readonly<Record<MotionLevel, MotionLevelScale>> = {
  calm: {
    summary: "Only the key content moves, once, with soft fades. Nothing decorative, no loops.",
    reach: "key",
    effectsPerLayer: 1,
    ambient: "none",
    time: 1.25,
    stagger: 1.5,
    distance: 0.5,
    bounce: 0,
  },
  subtle: {
    summary: "Content enters in reading order, lists one item at a time; one effect per layer.",
    reach: "content",
    effectsPerLayer: 1,
    ambient: "none",
    time: 1,
    stagger: 1,
    distance: 1,
    bounce: 1,
  },
  lively: {
    summary:
      "Most layers animate; numbers count up, charts grow, key elements get an emphasis and a gentle loop.",
    reach: "most",
    effectsPerLayer: 2,
    ambient: "key",
    time: 0.9,
    stagger: 0.8,
    distance: 1.6,
    bounce: 1.3,
  },
  intense: {
    summary: "Everything animates in layered choreography with depth; content keeps moving.",
    reach: "all",
    effectsPerLayer: 3,
    ambient: "content",
    time: 0.8,
    stagger: 0.6,
    distance: 2.5,
    bounce: 1.6,
  },
  absurd: {
    summary:
      "Everything moves, all the time: the biggest entrances, bounces, 3D flips where there's perspective, loops everywhere.",
    reach: "all",
    effectsPerLayer: null,
    ambient: "all",
    time: 0.7,
    stagger: 0.4,
    distance: 4,
    bounce: 2,
  },
};

/** Every `$motion` token's value at one level, ready to play. */
export interface MotionTokens extends ThemeMotion {
  level: MotionLevel;
  /** The level's travel multiplier, for effect presets. */
  distance: number;
}

/** The `$motion` tokens of `theme` at `level`. */
export function motionTokens(
  theme: Pick<Theme, "motion"> | undefined,
  level: MotionLevel = DEFAULT_MOTION_LEVEL,
): MotionTokens {
  const base = theme?.motion ?? DEFAULT_THEME_MOTION;
  const scale = MOTION_LEVEL_SCALES[level];
  const ms = (value: number, by: number) => Math.round(value * by);
  return {
    level,
    distance: scale.distance,
    fast: Math.max(1, ms(base.fast, scale.time)),
    normal: Math.max(1, ms(base.normal, scale.time)),
    slow: Math.max(1, ms(base.slow, scale.time)),
    stagger: ms(base.stagger, scale.stagger),
    enter: scaleBounce(base.enter, scale.bounce),
    exit: scaleBounce(base.exit, scale.bounce),
    move: scaleBounce(base.move, scale.bounce),
  };
}

function scaleBounce(easing: EasingValue, by: number): EasingValue {
  if (typeof easing !== "object" || !("spring" in easing)) return easing;
  const bounce = Math.min(1, (easing.spring.bounce ?? 0) * by);
  return { spring: bounce > 0 ? { bounce: Number(bounce.toFixed(3)) } : {} };
}

/** The level a slide moves at: its own, else the deck's, else `subtle`. */
export function slideMotionLevel(
  deck: Pick<Deck, "motionLevel">,
  slide: Pick<Slide, "motionLevel">,
): MotionLevel {
  return slide.motionLevel ?? deck.motionLevel ?? DEFAULT_MOTION_LEVEL;
}

/** The tokens a slide's animations play with: the deck's theme at the slide's level. */
export function slideMotionTokens(
  deck: Pick<Deck, "theme" | "motionLevel">,
  slide: Pick<Slide, "motionLevel">,
): MotionTokens {
  return motionTokens(deck.theme, slideMotionLevel(deck, slide));
}

const TIME_TOKEN_KEYS = {
  "$motion.fast": "fast",
  "$motion.normal": "normal",
  "$motion.slow": "slow",
  "$motion.stagger": "stagger",
} as const satisfies Record<TimeToken, keyof ThemeMotion>;

/** Milliseconds for a time: a number as it is, a token from `tokens`. */
export function resolveTime(time: Time, tokens: MotionTokens): number {
  return typeof time === "number" ? time : tokens[TIME_TOKEN_KEYS[time]];
}

/** A concrete easing: a `$motion` token from `tokens`, anything else as it is. */
export function resolveEasing(easing: Easing, tokens: MotionTokens): EasingValue {
  switch (easing) {
    case "$motion.enter":
      return tokens.enter;
    case "$motion.exit":
      return tokens.exit;
    case "$motion.move":
      return tokens.move;
    default:
      return easing;
  }
}
