/**
 * Motion design tokens and levels (D104, D111): how a deck moves, as a theme's personality
 * and a deck's (or slide's) intensity.
 *
 * - **Easing**: CSS names, a cubic Bézier, or a duration-based spring.
 * - **`$motion` tokens**, a fixed set every theme gives values to: three durations
 *   (`fast`, `normal`, `slow`), the `stagger` between items revealed one after another, and
 *   three easings (`enter`, `exit`, `move`). Fixed names: the schema catches a typo, and
 *   agents get a small vocabulary instead of milliseconds.
 * - **Motion level**: `calm` → `absurd`, chosen by the user or an agent. It scales the
 *   tokens (never an explicit number of milliseconds) and, later, how far and how much
 *   effects and choreography move.
 */
import { z } from "zod";

export const EASING_NAMES = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;

/** A concrete easing (no token): what a theme's `enter`, `exit` and `move` hold. */
export const EasingValueSchema = z.union([
  z.enum(EASING_NAMES),
  z.strictObject({
    cubicBezier: z.tuple([
      z.number().min(0).max(1),
      z.number().min(-5).max(5),
      z.number().min(0).max(1),
      z.number().min(-5).max(5),
    ]),
  }),
  z.strictObject({ spring: z.strictObject({ bounce: z.number().min(0).max(1).optional() }) }),
]);
export type EasingValue = z.infer<typeof EasingValueSchema>;

export const TIME_TOKENS = [
  "$motion.fast",
  "$motion.normal",
  "$motion.slow",
  "$motion.stagger",
] as const;
export type TimeToken = (typeof TIME_TOKENS)[number];
export const EASING_TOKENS = ["$motion.enter", "$motion.exit", "$motion.move"] as const;
export type EasingToken = (typeof EASING_TOKENS)[number];

const MAX_MS = 600_000;

/** Milliseconds, or a `$motion` time token (scaled by the motion level). */
export function timeSchema(min = 0) {
  return z.union([z.number().min(min).max(MAX_MS), z.enum(TIME_TOKENS)], {
    error: `Milliseconds (${min}–${MAX_MS}), or a theme token: ${TIME_TOKENS.map((t) => `"${t}"`).join(", ")}`,
  });
}
export type Time = number | TimeToken;

/** An easing, or a `$motion` easing token (the theme's). */
export const EasingSchema = z.union([EasingValueSchema, z.enum(EASING_TOKENS)], {
  error: `An easing: ${EASING_NAMES.map((n) => `"${n}"`).join(", ")}, { "cubicBezier": [x1, y1, x2, y2] }, { "spring": { "bounce": 0–1 } }, or a theme token: ${EASING_TOKENS.map((t) => `"${t}"`).join(", ")}`,
});
export type Easing = z.infer<typeof EasingSchema>;

/** A theme's motion personality: every `$motion` token's value. */
export const ThemeMotionSchema = z.strictObject({
  /** Durations in milliseconds, at the `subtle` level. */
  fast: z.number().min(1).max(10_000),
  normal: z.number().min(1).max(10_000),
  slow: z.number().min(1).max(10_000),
  /** Between items revealed one after another, in milliseconds. */
  stagger: z.number().min(0).max(5000),
  /** How things arrive, leave, and move or change while staying. */
  enter: EasingValueSchema,
  exit: EasingValueSchema,
  move: EasingValueSchema,
});
export type ThemeMotion = z.infer<typeof ThemeMotionSchema>;

export const MOTION_LEVELS = ["calm", "subtle", "lively", "intense", "absurd"] as const;
export const MotionLevelSchema = z.enum(MOTION_LEVELS, {
  error: `A motion level: ${MOTION_LEVELS.map((l) => `"${l}"`).join(", ")} (calmest to wildest)`,
});
export type MotionLevel = z.infer<typeof MotionLevelSchema>;
