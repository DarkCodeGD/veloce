/**
 * A slide's animations as a timeline (D110): where each one is, what the schema alone can't
 * check about it, and when it plays.
 *
 * Steps are derived from the list's order and each animation's trigger, never stored: step 0
 * plays when the slide appears (the animations before the first click), and every `onClick`
 * animation starts the next step. Inside a step, times are milliseconds from the click.
 * Pure and deterministic: the clock (`seek`) and the editor's steps list both read this.
 */
import type { ApplyContext } from "./checks.js";
import type { ErrorCode } from "./errors.js";
import { type MotionTokens, motionTokens, resolveTime } from "./motion-tokens.js";
import type { Animation } from "./schema/animation.js";
import type { Deck, Slide } from "./schema/deck.js";
import type { Easing, Time } from "./schema/motion.js";
import { FrameStyleSchema, type Node } from "./schema/node.js";
import { walkNodes } from "./tree.js";

/** An animation's duration and easing when it (and its effect) give none (D111). */
export const DEFAULT_DURATION: Time = "$motion.normal";
export const DEFAULT_EASING: Easing = "$motion.enter";

export interface AnimationLocation {
  animation: Animation;
  slide: Slide;
  slideIndex: number;
  /** Its position in the slide's `animations`. */
  index: number;
}

export function findAnimation(deck: Deck, id: string): AnimationLocation | null {
  for (const [slideIndex, slide] of deck.slides.entries()) {
    const index = slide.animations?.findIndex((a) => a.id === id) ?? -1;
    const animation = slide.animations?.[index];
    if (animation) return { animation, slide, slideIndex, index };
  }
  return null;
}

/** Every animation ID in the deck (they share the deck's ID space with slides and nodes). */
export function animationIds(deck: Deck): string[] {
  return deck.slides.flatMap((s) => s.animations?.map((a) => a.id) ?? []);
}

/** The animations of `slide` that target `ids`, with their positions, in list order. */
export function animationsTargeting(
  slide: Slide,
  ids: ReadonlySet<string>,
): { index: number; animation: Animation }[] {
  return (slide.animations ?? []).flatMap((animation, index) =>
    ids.has(animation.target) ? [{ index, animation }] : [],
  );
}

export interface AnimationProblem {
  code: ErrorCode;
  message: string;
  /** Inside the animation, e.g. `"target"` or `"tracks.props.fill[1].value"`. */
  path: string;
  hint?: string;
  /**
   * Only a plugin is missing (an effect nobody installed provides): an edit can't add it,
   * but a file that has it still opens, with a warning, and the animation keeps its place
   * in time without moving (D113 §5, D117).
   */
  missing?: true;
}

/**
 * What's wrong with one animation on `slide`, or null: the schema checks its shape, this
 * checks it against the slide. Its target must be a layer on the slide (not the root frame),
 * and a `props.*` or `style.*` track must give values the target's own schema accepts
 * (golden rule 5): each keyframe is tried in place of the property.
 */
export function animationProblem(
  slide: Slide,
  animation: Animation,
  ctx: ApplyContext = {},
): AnimationProblem | null {
  if (animation.target === slide.root.id) {
    return {
      code: "FORBIDDEN",
      message: `"${animation.target}" is slide "${slide.id}"'s root frame, which doesn't animate`,
      path: "target",
      hint: 'Animate the layers on it instead (one animation each, with trigger "withPrevious" to play them together).',
    };
  }
  let target: Node | undefined;
  for (const { node } of walkNodes(slide.root)) if (node.id === animation.target) target = node;
  if (!target) {
    return {
      code: "NOT_FOUND",
      message: `Animation "${animation.id}" targets "${animation.target}", which isn't on slide "${slide.id}"`,
      path: "target",
      hint: "An animation's target is the ID of a layer on the same slide.",
    };
  }
  if (animation.effect && ctx.validateEffect) {
    const check = ctx.validateEffect(animation.effect, target);
    if (!check.ok) {
      return {
        code: check.reason === "unknown-effect" ? "NOT_FOUND" : "INVALID",
        message: `Animation "${animation.id}": ${check.message}`,
        path: check.reason === "invalid-params" ? "effect.params" : "effect.name",
        ...(check.hint && { hint: check.hint }),
        ...(check.reason === "unknown-effect" && { missing: true as const }),
      };
    }
  }
  for (const [key, keyframes] of Object.entries(animation.tracks ?? {})) {
    const [group, ...path] = key.split(".");
    if (group !== "props" && group !== "style") continue; // a motion channel: any layer
    if (group === "props" && target.kind !== "element") {
      return {
        code: "INVALID",
        message: `"${key}": "${target.id}" is a frame, which has no props`,
        path: `tracks.${key}`,
        hint: 'Animate a frame\'s look with "style.*" tracks, e.g. "style.fill".',
      };
    }
    if (group === "style" && target.kind !== "frame") {
      return {
        code: "INVALID",
        message: `"${key}": "${target.id}" is a ${target.type} element, which has no style`,
        path: `tracks.${key}`,
        hint: 'Animate an element\'s look with "props.*" tracks, e.g. "props.fill".',
      };
    }
    for (const [i, keyframe] of keyframes.entries()) {
      const problem = valueProblem(target, path, keyframe.value, ctx);
      if (problem) {
        return {
          code: "INVALID",
          message: `"${key}" can't be ${JSON.stringify(keyframe.value)} on "${target.id}": ${problem}`,
          path: `tracks.${key}[${i}].value`,
          hint: "Track values must be ones the property itself accepts: a number for sizes, a color for fills.",
        };
      }
    }
  }
  return null;
}

/** Why `value` can't stand in for the property at `path` of `node`, or null if it can. */
function valueProblem(
  node: Node,
  path: readonly string[],
  value: unknown,
  ctx: ApplyContext,
): string | null {
  if (node.kind === "frame") {
    const parsed = FrameStyleSchema.safeParse(setPath(node.style ?? {}, path, value));
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? "not a valid style");
  }
  if (!ctx.validateElement) return null; // without plugins, props aren't checked (as elements)
  const check = ctx.validateElement(node.type, setPath(node.props, path, value));
  if (check.ok || check.reason === "unknown-type") return null;
  return check.message;
}

function setPath(
  object: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return object;
  const inner = object[head];
  return {
    ...object,
    [head]:
      rest.length === 0
        ? value
        : setPath(
            typeof inner === "object" && inner !== null && !Array.isArray(inner)
              ? (inner as Record<string, unknown>)
              : {},
            rest,
            value,
          ),
  };
}

// ── Schedule ─────────────────────────────────────────────────────────────────────────

export interface ScheduledAnimation {
  animation: Animation;
  /** Milliseconds from the start of its step. */
  start: number;
  /** When it ends: one play for `repeat: "forever"`, so what comes after it still plays. */
  end: number;
  forever: boolean;
}

export interface Step {
  animations: ScheduledAnimation[];
  /** Until its last animation ends (forever ones count one play). */
  duration: number;
}

/** What an effect gives an animation that doesn't set its own (D114). */
export interface AnimationDefaults {
  duration?: Time;
  easing?: Easing;
}

/**
 * When every animation of a slide plays. Step 0 holds the animations before the first
 * `onClick` (they play as the slide appears) and is always there, even empty; each `onClick`
 * starts a step. `withPrevious` starts with the animation before it, `afterPrevious` when it
 * ends; the first animation of a step starts at its delay. `$motion` times resolve from
 * `tokens` (`slideMotionTokens(deck, slide)`; default: Veloce's own motion, `subtle`).
 * `defaults` gives an effect's own duration to animations that set none.
 */
export function scheduleSlide(
  slide: Pick<Slide, "animations">,
  tokens: MotionTokens = motionTokens(undefined),
  defaults?: (animation: Animation) => AnimationDefaults | undefined,
): Step[] {
  const steps: Step[] = [{ animations: [], duration: 0 }];
  let previous: ScheduledAnimation | null = null;
  for (const animation of slide.animations ?? []) {
    const trigger = animation.trigger ?? "onClick";
    if (trigger === "onClick") {
      steps.push({ animations: [], duration: 0 });
      previous = null;
    }
    const step = steps.at(-1) as Step;
    const from: number =
      previous === null ? 0 : trigger === "afterPrevious" ? previous.end : previous.start;
    const start: number = from + resolveTime(animation.delay ?? 0, tokens);
    const forever = animation.repeat === "forever";
    const plays = typeof animation.repeat === "number" ? animation.repeat : 1;
    const duration = animation.duration ?? defaults?.(animation)?.duration ?? DEFAULT_DURATION;
    const end = start + resolveTime(duration, tokens) * plays;
    const scheduled: ScheduledAnimation = { animation, start, end, forever };
    step.animations.push(scheduled);
    step.duration = Math.max(step.duration, end);
    previous = scheduled;
  }
  return steps;
}
