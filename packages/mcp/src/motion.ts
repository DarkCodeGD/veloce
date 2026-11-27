/**
 * Animations as agents write and read them (the MCP animation item, D126).
 *
 * Agents describe a slide's animations as **steps**: `steps[0]` plays as the slide appears,
 * each later step is one click. Inside a step everything starts together unless an
 * animation says `"start": "after"` (when the one before it ends). That's the model people
 * see in the Animate panel ("As the slide appears", "Click 1"…); it's turned here into core's
 * stored form, a list in play order with triggers (D110), so the editor, undo and the file
 * never learn about steps.
 *
 * Compared with core's `AnimationSchema`, agents may leave out `id` (a readable one is made,
 * `<slide id>-a1`) and write an effect as just its name (`"effect": "fade-in"`).
 */
import {
  type Animation,
  AnimationSchema,
  collectIds,
  compileSlide,
  type Deck,
  EffectRefSchema,
  type EffectResolver,
  formatIssues,
  formatPath,
  IdSchema,
  type Slide,
  type Step,
  slideMotionLevel,
  VeloceError,
} from "@veloce/core";
import { z } from "zod";

const shape = AnimationSchema.shape;

const EffectInputSchema = z
  .union([EffectRefSchema.shape.name, EffectRefSchema])
  .describe(
    'An effect by name ("fade-in", "slide-in", a saved preset…), or { "name", "params" } for its settings. get_docs("animation") lists them.',
  );

/** What every animation input takes, whatever says when it starts. */
const animationFields = {
  id: IdSchema.optional().describe(
    'Optional; a readable one is made ("<slide id>-a1") and returned.',
  ),
  target: shape.target.describe("The layer it animates: a node ID on this slide."),
  effect: EffectInputSchema.optional(),
  tracks: shape.tracks.describe(
    'Or your own keyframes instead of an effect: { "opacity": [{ "at": 0, "value": 0 }], "y": [{ "at": 0, "value": 40 }] }.',
  ),
  delay: shape.delay.describe('After its start: ms or "$motion.stagger". Default 0.'),
  duration: shape.duration.describe(
    'ms or "$motion.fast" | "$motion.normal" | "$motion.slow" (tokens follow the motion level). Default: the effect\'s.',
  ),
  easing: shape.easing,
  repeat: shape.repeat.describe('How many times it plays, or "forever" (a loop).'),
  alternate: shape.alternate.describe("Repeats play back and forth."),
  space: shape.space.describe(
    '"makeRoom": the layer takes its place in its stack/grid as this starts (the others glide aside); "collapse": it leaves the layout when this ends.',
  ),
  stagger: shape.stagger.describe(
    'On a frame: play on its children one by one in reading order: { "each"?: ms, "from"?: "start" | "end" | "center" | "edges" | "random" }.',
  ),
};

/** One animation inside a step (set_animations). */
export const StepAnimationInputSchema = z.strictObject({
  ...animationFields,
  start: z
    .enum(["with", "after"])
    .optional()
    .describe(
      '"with" (default): together with the animation before it in this step; "after": when that one ends.',
    ),
});
export type StepAnimationInput = z.infer<typeof StepAnimationInputSchema>;

/** One animation for `animation.insert` in apply_ops: core's, with the shorthand above. */
export const AnimationInputSchema = z.strictObject({
  ...animationFields,
  trigger: shape.trigger.describe(
    '"onClick" (default: starts a new step), "withPrevious" or "afterPrevious".',
  ),
});
export type AnimationInput = z.infer<typeof AnimationInputSchema>;

export const MAX_STEPS = 100;

export const StepsInputSchema = z
  .array(z.array(StepAnimationInputSchema).max(200))
  .max(MAX_STEPS)
  .describe(
    'steps[0] plays as the slide appears ([] for nothing), each later step is one click. Inside a step animations start together unless "start": "after". [] removes every animation.',
  );

/**
 * Readable, deck-unique animation IDs for one slide: `s3-a1`, `s3-a2`… skipping any taken.
 * `free` are IDs this change removes first (a slide's old animations), so they can be reused.
 */
export function animationIdMaker(
  deck: Deck,
  slideId: string,
  free: Iterable<string> = [],
  taken: Set<string> = collectIds(deck),
): () => string {
  for (const id of free) taken.delete(id);
  let n = 0;
  return () => {
    let id: string;
    do id = `${slideId}-a${++n}`;
    while (taken.has(id) || !IdSchema.safeParse(id).success);
    taken.add(id);
    return id;
  };
}

/** An agent's animation as core stores it, checked by core's schema (errors point at `at`). */
export function normalizeAnimation(
  input: AnimationInput | Omit<StepAnimationInput, "start">,
  newId: () => string,
  at: string,
): Animation {
  const { id, effect, ...rest } = input;
  const animation = {
    id: id ?? newId(),
    ...rest,
    ...(effect !== undefined && {
      effect: typeof effect === "string" ? { name: effect } : effect,
    }),
  };
  const parsed = AnimationSchema.safeParse(animation);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path ?? [];
    throw new VeloceError("INVALID", formatIssues(parsed.error.issues, [at]), {
      path: `${at}${formatPath(where).replace(/^(?=[^[])/, ".")}`,
      hint: schemaHint(where),
    });
  }
  return parsed.data;
}

/** The fix for a schema problem, by where it is (the message already says what's wrong). */
export function schemaHint(path: readonly PropertyKey[]): string {
  const key = path.at(-1);
  if (path[0] === "tracks" && key === "at") {
    return '`at` is where a keyframe sits in the animation: 0 is its start, 1 its end (use "duration" for how long it takes).';
  }
  if (path[0] === "tracks") {
    return 'Tracks map a motion channel ("x", "opacity"…) or a property path ("props.fill") to keyframes [{ "at": 0–1, "value" }], in time order.';
  }
  if (path.length === 0) {
    return 'e.g. { "target": "title", "effect": "fade-in" }. get_docs("animation") has the fields.';
  }
  return 'get_docs("animation") lists each field and its values.';
}

/** Where each animation came from in the agent's steps, by its index in the stored list. */
export type StepPaths = string[];

/**
 * Steps → the stored list (D110): step 0's animations start with the slide (`withPrevious`
 * from nothing), each later step's first one is an `onClick` (stored as no trigger, as the
 * editor does), and the rest start with or after the one before.
 */
export function stepsToAnimations(
  steps: readonly (readonly StepAnimationInput[])[],
  newId: () => string,
  /** Where `steps` sits in the input (`slide.steps`), for error paths. */
  base = "steps",
): { animations: Animation[]; paths: StepPaths } {
  const animations: Animation[] = [];
  const paths: StepPaths = [];
  steps.forEach((step, s) => {
    if (s > 0 && step.length === 0) {
      throw new VeloceError("INVALID", `${base}[${s}] is empty: a click has to start something`, {
        path: `${base}[${s}]`,
        hint: "Remove the empty step (only steps[0], what plays as the slide appears, may be []).",
      });
    }
    step.forEach(({ start, ...input }, i) => {
      const at = `${base}[${s}][${i}]`;
      const animation = normalizeAnimation(input, newId, at);
      const trigger =
        i === 0
          ? s === 0
            ? "withPrevious"
            : undefined
          : start === "after"
            ? "afterPrevious"
            : "withPrevious";
      const { trigger: _ignored, ...rest } = animation;
      animations.push(trigger ? { ...rest, trigger } : rest);
      paths.push(at);
    });
  });
  return { animations, paths };
}

// ── Reading them back ─────────────────────────────────────────────────────────────────

const seconds = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s` : `${Math.round(ms)}ms`;

/** "title fade-in", "cards slide-in(direction up) one by one, after": one animation, short. */
export function animationLabel(
  animation: Animation,
  withId = true,
  presets?: Deck["presets"],
): string {
  const what = animation.effect
    ? `${animation.effect.name}${presets?.[animation.effect.name] ? " (saved preset)" : ""}${
        animation.effect.params && Object.keys(animation.effect.params).length
          ? `(${Object.entries(animation.effect.params)
              .map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`)
              .join(", ")})`
          : ""
      }`
    : `keyframes(${Object.keys(animation.tracks ?? {}).join(", ")})`;
  const time = (t: Animation["delay"]) => (typeof t === "number" ? `${t}ms` : t);
  const marks = [
    animation.trigger === "afterPrevious" && "after",
    animation.delay !== undefined && animation.delay !== 0 && `delay ${time(animation.delay)}`,
    animation.duration !== undefined && `for ${time(animation.duration)}`,
    animation.repeat === "forever"
      ? "loops"
      : animation.repeat !== undefined && `×${animation.repeat}`,
    animation.alternate && "back and forth",
    animation.stagger &&
      `one by one${animation.stagger.from ? ` from ${animation.stagger.from}` : ""}`,
    animation.space === "makeRoom" && "makes room",
    animation.space === "collapse" && "closes the gap",
  ].filter(Boolean);
  return `${withId ? `${animation.id} ` : ""}${animation.target} ${what}${marks.length ? ` [${marks.join(", ")}]` : ""}`;
}

/** When each step plays, with the effects' own durations (D114) when a resolver is given. */
export function slideSteps(
  deck: Pick<Deck, "theme" | "motionLevel" | "presets">,
  slide: Slide,
  effects?: EffectResolver,
): Step[] {
  return compileSlide(deck, slide, effects ? { effects } : {}).steps;
}

/**
 * The slide's animations by step, for outlines and tool results:
 * `As the slide appears (900ms): s3-a1 title fade-in; s3-a2 sub slide-in [after]`.
 * Lines are indented by `indent`; empty when the slide has none.
 */
export function stepsOutline(
  deck: Pick<Deck, "theme" | "motionLevel" | "presets">,
  slide: Slide,
  {
    effects,
    indent = "",
    timing = true,
  }: { effects?: EffectResolver; indent?: string; timing?: boolean } = {},
): string[] {
  if (!slide.animations?.length) return [];
  const steps = slideSteps(deck, slide, effects);
  const stored = new Map(slide.animations.map((a) => [a.id, a]));
  const lines: string[] = [];
  steps.forEach((step, n) => {
    if (n === 0 && step.animations.length === 0) return;
    const name = n === 0 ? "As the slide appears" : `Click ${n}`;
    const length = timing ? ` (${seconds(step.duration)})` : "";
    // The schedule plays presets expanded (D119): show what's stored, by ID.
    const list = step.animations
      .map(({ animation }) =>
        animationLabel(stored.get(animation.id) ?? animation, true, deck.presets),
      )
      .join("; ");
    lines.push(`${indent}${name}${length}: ${list}`);
  });
  return lines;
}

/** "level lively (the deck's)": the level a slide moves at, and where it comes from. */
export function levelLabel(deck: Pick<Deck, "motionLevel">, slide: Slide): string {
  const level = slideMotionLevel(deck, slide);
  return slide.motionLevel ? `level ${level} (this slide's own)` : `level ${level}`;
}
