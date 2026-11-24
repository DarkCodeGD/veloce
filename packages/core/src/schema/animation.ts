/**
 * Animations on a slide (D110). A slide's `animations` list is in play order, and each
 * animation's `trigger` says when it starts: on a click (a new step), with the one before it,
 * or after it ends. So steps are derived, never numbered in storage, and an op that adds or
 * moves one animation still means the same thing after other edits (D101 §2.2).
 *
 * The list is never patched as a whole: `animation.insert/update/remove/move` edit one
 * animation at a time, by ID (D101 §2.1), and removing a node removes the animations that
 * target it in the same op (D101 §2.3).
 *
 * An animation either plays an `effect` (a named preset, built in or from a plugin, which
 * turns into keyframe tracks) or its own keyframe `tracks`. Tracks move motion channels
 * (drawn on top of the layout by the motion slot, D103) or any number or color in the
 * target's own schema (`props.*` for elements, `style.*` for frames, D105 §1).
 */
import { z } from "zod";
import { MOTION_CHANNELS } from "../motion.js";
import { EasingSchema, timeSchema } from "./motion.js";
import { ELEMENT_TYPE_PATTERN } from "./node.js";
import { IdSchema } from "./primitives.js";

/** The longest delay or duration, in milliseconds: ten minutes. */
export const MAX_ANIMATION_MS = 600_000;
export const MAX_ANIMATIONS_PER_SLIDE = 1000;
export const MAX_KEYFRAMES = 100;

/** A value at one point of the animation: `at` 0 is its start, 1 its end. */
export const KeyframeSchema = z.strictObject({
  at: z.number().min(0).max(1),
  /** A number, or a color (`"#ff0000"`, `"$color.accent"`) for color properties. */
  value: z.union([z.number(), z.string().min(1).max(200)]),
  /** How the value travels from this keyframe to the next. Default: the animation's easing. */
  easing: EasingSchema.optional(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

const CHANNELS: ReadonlySet<string> = new Set(MOTION_CHANNELS);
const PROPERTY_PATH = /^(?:props|style)(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;

/**
 * One property's keyframes, in time order. Where a track has no keyframe at 0 or 1, that end
 * is the layer's own value, so `[{ "at": 0, "value": 0 }]` on `opacity` fades the layer in to
 * however opaque it is.
 */
export const TrackSchema = z
  .array(KeyframeSchema)
  .min(1)
  .max(MAX_KEYFRAMES)
  .superRefine((keyframes, ctx) => {
    for (let i = 1; i < keyframes.length; i++) {
      if ((keyframes[i]?.at ?? 0) <= (keyframes[i - 1]?.at ?? 0)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "at"],
          message: "Keyframes go in time order, each `at` later than the one before",
        });
      }
    }
  });

/** Keyframe tracks by property: a motion channel (`"x"`, `"opacity"`…) or a schema path. */
export const TracksSchema = z.record(z.string(), TrackSchema).superRefine((tracks, ctx) => {
  const entries = Object.entries(tracks);
  if (entries.length === 0) {
    ctx.addIssue({ code: "custom", message: 'Give at least one track, e.g. { "opacity": [...] }' });
  }
  for (const [key, keyframes] of entries) {
    if (CHANNELS.has(key)) {
      const i = keyframes.findIndex((k) => typeof k.value !== "number");
      if (i >= 0) {
        ctx.addIssue({
          code: "custom",
          path: [key, i, "value"],
          message: `"${key}" is a number: ${channelHint(key)}`,
        });
      }
    } else if (!PROPERTY_PATH.test(key)) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `"${key}" isn't something an animation can move. Use a motion channel (${MOTION_CHANNELS.join(", ")}) or a property path like "props.fill" (elements) or "style.fill" (frames)`,
      });
    }
  }
});
export type Tracks = z.infer<typeof TracksSchema>;

function channelHint(channel: string): string {
  if (channel === "opacity") return "0 (invisible) to 1";
  if (channel.startsWith("scale")) return "1 is the layer's own size";
  if (channel.startsWith("rotate")) return "degrees";
  return "stage pixels";
}

/** A preset by name (`"fade-in"`, `"acme.sparkle"`) and its settings, checked by the preset. */
export const EffectRefSchema = z.strictObject({
  name: z.string().max(100).regex(ELEMENT_TYPE_PATTERN, {
    error: 'Effect names are lowercase, e.g. "fade-in" or "acme.sparkle"',
  }),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type EffectRef = z.infer<typeof EffectRefSchema>;

export const TriggerSchema = z.enum(["onClick", "withPrevious", "afterPrevious"]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const AnimationSchema = z
  .strictObject({
    id: IdSchema,
    /** The layer it animates: a node on the same slide, not the slide's root frame. */
    target: IdSchema,
    /**
     * When it starts. `"onClick"` (default) begins a new step; `"withPrevious"` starts with
     * the animation before it; `"afterPrevious"` when that one ends. The first animations,
     * before any click, play when the slide appears.
     */
    trigger: TriggerSchema.optional(),
    /** After its trigger: milliseconds, or `"$motion.stagger"`. Default: 0. */
    delay: timeSchema().optional(),
    /** One play: milliseconds, or a `$motion` duration. Default: the effect's, or `"$motion.normal"`. */
    duration: timeSchema(1).optional(),
    /** Over the whole animation. Default: the effect's, or `"$motion.enter"`. */
    easing: EasingSchema.optional(),
    effect: EffectRefSchema.optional(),
    tracks: TracksSchema.optional(),
    /** How many times it plays (default 1), or "forever" (until the slide changes). */
    repeat: z.union([z.number().int().min(1).max(1000), z.literal("forever")]).optional(),
    /** Repeats play back and forth instead of starting over. */
    alternate: z.boolean().optional(),
  })
  .superRefine((animation, ctx) => {
    if ((animation.effect === undefined) === (animation.tracks === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: animation.effect ? ["tracks"] : [],
        message: animation.effect
          ? 'An animation plays an effect or its own tracks, not both: remove "tracks" or "effect"'
          : 'An animation needs an "effect" (e.g. { "name": "fade-in" }) or keyframe "tracks"',
      });
    }
  });
export type Animation = z.infer<typeof AnimationSchema>;

export const AnimationsSchema = z.array(AnimationSchema).max(MAX_ANIMATIONS_PER_SLIDE);
