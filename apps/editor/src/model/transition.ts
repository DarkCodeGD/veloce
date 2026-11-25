/**
 * The Animate panel's Transition section (D123): how the slide arrives, as commands (the
 * same `slide.update` an agent sends, golden rule 1).
 *
 * A slide with no transition of its own arrives with its theme's signature; picking a type
 * gives it its own, and "Theme's" takes it away again. Tuning the duration or direction of
 * the theme's starts the slide's own from it, so what's shown never jumps.
 */
import {
  DEFAULT_THEME_MOTION,
  DEFAULT_TRANSITION,
  type Deck,
  morphPairs,
  resolveTime,
  type Slide,
  slideMotionTokens,
  type Time,
  type Transition,
  type TransitionDirection,
  type TransitionType,
  transitionInto,
} from "@veloce/core";
import type { Command } from "./commands.js";

export const TRANSITION_LABELS: Readonly<Record<TransitionType, string>> = {
  none: "None (cut)",
  fade: "Fade",
  push: "Push",
  zoom: "Zoom",
  morph: "Morph",
};

/** Push travels this way: the new slide comes from the other side. */
export const DIRECTION_LABELS: Readonly<Record<TransitionDirection, string>> = {
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
};

/** What a slide arrives with when it sets none: its theme's signature, at its level. */
export function themeTransition(deck: Deck, slide: Slide) {
  const { transition: _own, ...rest } = slide;
  return transitionInto(deck, rest);
}

/** The theme's pace for transitions: its signature's duration token (or a number). */
function themePace(deck: Deck): Time | undefined {
  return (deck.theme.motion?.transition ?? DEFAULT_THEME_MOTION.transition ?? DEFAULT_TRANSITION)
    .duration;
}

/** The slide's transition as the panel shows it: its own, else the theme's. */
export function shownTransition(deck: Deck, slide: Slide) {
  const resolved = transitionInto(deck, slide);
  const pace = resolveTime(themePace(deck) ?? "$motion.slow", slideMotionTokens(deck, slide));
  const duration = resolved?.duration ?? 0;
  return {
    own: slide.transition ?? null,
    type: (slide.transition?.type ?? resolved?.type ?? "none") as TransitionType,
    /** Milliseconds it plays for, as resolved (tokens at the slide's level). */
    duration,
    /** The theme's pace in ms, what the duration resets to; and the duration when it differs. */
    pace,
    tunedDuration: duration === pace ? undefined : duration,
    direction: resolved?.direction ?? "left",
  };
}

/** A merge patch from one transition to another: keys it drops are set to null. */
function patchFor(before: Transition | undefined, after: Transition | null) {
  if (after === null) return null;
  const patch: Record<string, unknown> = { ...after };
  for (const key of Object.keys(before ?? {})) if (!(key in after)) patch[key] = null;
  return patch;
}

const update = (slide: Slide, next: Transition | null, label: string): Command => ({
  label,
  ops: [
    { op: "slide.update", id: slide.id, set: { transition: patchFor(slide.transition, next) } },
  ],
});

/** Pick a type; null: back to the theme's. Its duration and easing stay. */
export function setTransitionType(slide: Slide, type: TransitionType | null): Command {
  if (type === null) return update(slide, null, "Use the theme's transition");
  const { direction, ...kept } = slide.transition ?? {};
  const next: Transition = {
    ...kept,
    type,
    ...(type === "push" && direction !== undefined && { direction }),
  };
  if (type === "none") return update(slide, { type }, "No transition");
  return update(slide, next, `${TRANSITION_LABELS[type]} transition`);
}

/**
 * Tune the duration (ms; null: the token's) or a push's direction. On the theme's, the
 * slide gets its own from it.
 */
export function tuneTransition(
  deck: Deck,
  slide: Slide,
  change: { duration?: number | null; direction?: TransitionDirection },
): Command | null {
  const pace = themePace(deck);
  const base: Transition = slide.transition ?? {
    type: themeTransition(deck, slide)?.type ?? "fade",
    ...(pace !== undefined && { duration: pace }),
  };
  if (base.type === "none") return null;
  const next: Transition = { ...base };
  if (change.duration === null) {
    // Back to the theme's pace.
    if (pace === undefined) delete next.duration;
    else next.duration = pace;
  } else if (change.duration !== undefined) next.duration = change.duration;
  if (change.direction !== undefined && next.type === "push") next.direction = change.direction;
  return update(slide, next, "Tune the transition");
}

/** Every slide arrives like this one (or all with the theme's). One undo step. */
export function transitionEverywhere(deck: Deck, slide: Slide): Command | null {
  const ops = deck.slides
    .filter((s) => s.id !== slide.id && !sameTransition(s.transition, slide.transition))
    .map((s) => ({
      op: "slide.update" as const,
      id: s.id,
      set: { transition: patchFor(s.transition, slide.transition ?? null) },
    }));
  return ops.length === 0 ? null : { label: "Same transition on every slide", ops };
}

const sameTransition = (a: Transition | undefined, b: Transition | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * A morph's hint: how many layers glide in from the slide before (D109 pairs). Null when
 * the slide is the first.
 */
export function morphGliders(deck: Deck, slide: Slide): number | null {
  const at = deck.slides.findIndex((s) => s.id === slide.id);
  const before = at > 0 ? deck.slides[at - 1] : undefined;
  return before ? morphPairs(before, slide).length : null;
}
