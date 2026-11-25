/**
 * Saved animation presets (D119): a tuned animation kept in the deck under a name, and used
 * by that name like a built-in effect (`{ "effect": { "name": "big-bounce" } }`).
 *
 * A preset is *how* something moves, never *when*: an installed effect with its settings, or
 * keyframe tracks, plus the timing that goes with them (duration, easing, repeat). The
 * animation that uses it keeps its own target, trigger and delay, and any field it sets
 * itself wins over the preset's. Unlike components (D94), uses are linked: changing a preset
 * changes every animation that plays it, like a text style.
 *
 * It follows the motion level the way the animation it came from did (D111 §4): settings left
 * unset and `$motion` times scale with the level; numbers given stay put.
 */
import { z } from "zod";
import { EffectRefSchema, RepeatSchema, TracksSchema } from "./animation.js";
import { EasingSchema, timeSchema } from "./motion.js";

/** The most presets one deck keeps. */
export const MAX_PRESETS = 200;

/**
 * Lowercase words joined by "-", like the built-in effects' names ("big-bounce"): agents
 * type them in `effect.name`. Never dotted, so a plugin's effects (always namespaced,
 * "acme.sparkle") can't share one.
 */
export const PRESET_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const PresetNameSchema = z.string().max(60).regex(PRESET_NAME_PATTERN, {
  error:
    'Preset names are lowercase words joined by "-", like the built-in effects, e.g. "big-bounce" (at most 60 characters)',
});

export const PresetSchema = z
  .strictObject({
    /** What people see in the gallery ("Big bounce"). Default: the name. */
    title: z.string().trim().min(1).max(60).optional(),
    /** What it's for: shown on hover and to agents. */
    description: z.string().max(300).optional(),
    /** An installed effect (never another preset) and its settings. */
    effect: EffectRefSchema.optional(),
    /** Or its own keyframes. */
    tracks: TracksSchema.optional(),
    /** One play: milliseconds, or a `$motion` duration (which follows the level). */
    duration: timeSchema(1).optional(),
    easing: EasingSchema.optional(),
    repeat: RepeatSchema.optional(),
    alternate: z.boolean().optional(),
  })
  .superRefine((preset, ctx) => {
    if ((preset.effect === undefined) === (preset.tracks === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: preset.effect ? ["tracks"] : [],
        message: preset.effect
          ? 'A preset plays an effect or its own tracks, not both: remove "tracks" or "effect"'
          : 'A preset needs an "effect" (e.g. { "name": "pop-in", "params": { … } }) or keyframe "tracks"',
      });
    }
  });
export type Preset = z.infer<typeof PresetSchema>;

export const PresetsSchema = z
  .record(PresetNameSchema, PresetSchema)
  .refine((all) => Object.keys(all).length <= MAX_PRESETS, {
    error: `A deck keeps at most ${MAX_PRESETS} presets`,
  });
export type Presets = z.infer<typeof PresetsSchema>;
