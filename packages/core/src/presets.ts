/**
 * Saved animation presets (D119): how an animation that plays a preset by name turns into a
 * plain one, and the helpers the ops, the editor and agents share.
 *
 * **Expansion is the whole trick.** `expandAnimation` swaps a preset's name for what it holds
 * (its installed effect with the settings merged, or its keyframes) and fills in the timing
 * the animation doesn't set itself. Everything downstream (the schedule, the evaluator, the
 * compositor plan, export) only ever sees plain animations, so a preset plays exactly as the
 * same animation written out in full would. Pure and deterministic, like the rest of the
 * timeline.
 */
import type { ApplyContext } from "./checks.js";
import type { ErrorCode } from "./errors.js";
import { isPlainObject } from "./json.js";
import type { Op } from "./ops/schema.js";
import type { Animation } from "./schema/animation.js";
import type { Deck, Slide } from "./schema/deck.js";
import type { Preset, Presets } from "./schema/preset.js";
import { suggest } from "./suggest.js";
import type { AnimationLocation } from "./timeline.js";

type WithPresets = Pick<Deck, "presets">;

/** The timing a preset carries with its motion; the animation's own value wins. */
export const PRESET_TIMING = ["duration", "easing", "repeat", "alternate"] as const;

/** The preset saved under exactly `name` (own keys only: "constructor" is just a name). */
export function getPreset(deck: WithPresets, name: string): Preset | undefined {
  return lookup(deck.presets, name);
}

export function presetNames(deck: WithPresets): string[] {
  return Object.keys(deck.presets ?? {});
}

/** What people see: its title, else its name. */
export const presetTitle = (name: string, preset: Preset): string => preset.title ?? name;

/** The preset `animation` plays, when its effect names one of the deck's. */
export function presetOf(
  presets: Presets | undefined,
  animation: Animation,
): { name: string; preset: Preset } | undefined {
  const name = animation.effect?.name;
  const preset = name === undefined ? undefined : lookup(presets, name);
  return name !== undefined && preset ? { name, preset } : undefined;
}

/**
 * The plain animation `animation` stands for: when it plays a preset, the preset's effect
 * (with the animation's own settings over the preset's) or keyframes, and the preset's timing
 * wherever the animation sets none. Any other animation comes back as it is.
 */
export function expandAnimation(animation: Animation, presets: Presets | undefined): Animation {
  const found = presetOf(presets, animation);
  if (!found) return animation;
  const { effect, tracks } = found.preset;
  const { effect: own, ...rest } = animation;
  const timing = presetTiming(found.preset);
  if (tracks) return { ...timing, ...rest, tracks };
  const params = { ...effect?.params, ...own?.params };
  return {
    ...timing,
    ...rest,
    effect: {
      name: effect?.name ?? "",
      ...(Object.keys(params).length > 0 && { params }),
    },
  };
}

/** `slide` with every preset expanded; the same object when none of its animations uses one. */
export function expandSlide<S extends Pick<Slide, "animations">>(
  slide: S,
  presets: Presets | undefined,
): S {
  const list = slide.animations;
  if (!list || !presets || !list.some((a) => presetOf(presets, a))) return slide;
  return { ...slide, animations: list.map((a) => expandAnimation(a, presets)) };
}

/** Every animation in the deck that plays the preset `name`, in deck order. */
export function presetUses(deck: Pick<Deck, "slides">, name: string): AnimationLocation[] {
  const uses: AnimationLocation[] = [];
  deck.slides.forEach((slide, slideIndex) => {
    (slide.animations ?? []).forEach((animation, index) => {
      if (animation.effect?.name === name) uses.push({ animation, slide, slideIndex, index });
    });
  });
  return uses;
}

/**
 * A preset made from a tuned animation: how it moves (its effect and settings, or its
 * keyframes) and its timing, never its target, start or delay. An animation that plays a
 * preset itself gives what it plays, its own changes included.
 */
export function presetFromAnimation(
  animation: Animation,
  presets: Presets | undefined,
  about: { title?: string; description?: string } = {},
): Preset {
  const plain = expandAnimation(animation, presets);
  const title = about.title?.trim();
  const description = about.description?.trim();
  return {
    ...(title && { title }),
    ...(description && { description }),
    ...(plain.effect ? { effect: plain.effect } : { tracks: plain.tracks ?? {} }),
    ...presetTiming(plain),
  };
}

/**
 * What an animation that plays a preset sets for itself on top of it: timing fields and
 * effect settings by name (`"duration"`, `"params.direction"`). Empty: it plays the preset
 * as saved.
 */
export function presetOverrides(animation: Animation): string[] {
  return [
    ...PRESET_TIMING.filter((key) => animation[key] !== undefined),
    ...Object.keys(animation.effect?.params ?? {}).map((key) => `params.${key}`),
  ];
}

/** The `animation.update` patch that drops an animation's own changes to its preset. */
export function clearOverridesPatch(animation: Animation): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of PRESET_TIMING) if (animation[key] !== undefined) patch[key] = null;
  if (animation.effect?.params) patch.effect = { params: null };
  return patch;
}

/**
 * The ops that give every use of preset `name` its own copy of what the preset holds, so
 * removing the preset afterwards (`preset.remove`) changes nothing on screen. The editor's
 * Delete preset sends these and the remove as one transaction; agents can too.
 */
export function inlinePresetOps(deck: Pick<Deck, "slides" | "presets">, name: string): Op[] {
  return presetUses(deck, name).map(({ animation }) => ({
    op: "animation.update",
    id: animation.id,
    set: inlinePatch(animation, deck.presets),
  }));
}

/** The merge patch that turns `animation` into its expansion. */
export function inlinePatch(
  animation: Animation,
  presets: Presets | undefined,
): Record<string, unknown> {
  const plain = expandAnimation(animation, presets);
  const patch: Record<string, unknown> = {};
  for (const key of PRESET_TIMING) {
    if (plain[key] !== undefined && animation[key] === undefined) patch[key] = plain[key];
  }
  if (plain.tracks) {
    patch.effect = null;
    patch.tracks = plain.tracks;
  } else if (plain.effect) {
    // Replace the effect whole: its name changes, and its params are the merged ones.
    patch.effect = { name: plain.effect.name, params: plain.effect.params ?? null };
  }
  return patch;
}

export interface PresetProblem {
  code: ErrorCode;
  message: string;
  /** Inside the preset, e.g. `"effect.params"`. */
  path: string;
  hint?: string;
  /** Only the plugin of its effect is missing: a file that has it still opens (D113 §5). */
  missing?: true;
}

/**
 * What's wrong with a preset on its own, or null: its effect must be an installed one (not
 * another preset) with valid settings. Whether it suits the layers that play it is checked
 * per use (`animationProblem`), since that depends on the layer.
 */
export function presetProblem(
  preset: Preset,
  ctx: ApplyContext,
  presets?: Presets,
): PresetProblem | null {
  if (!preset.effect || !ctx.validateEffect) return null;
  const check = ctx.validateEffect(preset.effect);
  if (check.ok) return null;
  const base = preset.effect.name;
  if (check.reason === "unknown-effect") {
    const other = lookup(presets, base);
    return {
      code: "NOT_FOUND",
      message: `Its effect, ${check.message.charAt(0).toLowerCase()}${check.message.slice(1)}`,
      path: "effect.name",
      ...(other
        ? {
            hint: `"${base}" is a preset too. A preset builds on an installed effect: use what "${base}" plays${other.effect ? ` ("${other.effect.name}")` : " (its tracks)"}.`,
          }
        : check.hint && { hint: check.hint }),
      ...(!other && { missing: true as const }),
    };
  }
  return {
    code: "INVALID",
    message: check.message,
    path: check.reason === "invalid-params" ? "effect.params" : "effect.name",
    ...(check.hint && { hint: check.hint }),
  };
}

/** "Did you mean …?" for a preset name, or the deck's presets. */
export function presetNotFoundHint(deck: WithPresets, name: string): string {
  const names = presetNames(deck);
  const close = suggest(name, names);
  if (close.length) return `Did you mean ${close.map((n) => `"${n}"`).join(" or ")}?`;
  return names.length
    ? `This deck's presets: ${names
        .slice(0, 20)
        .map((n) => `"${n}"`)
        .join(", ")}.`
    : "This deck has no presets yet. Save one with preset.save.";
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────

function lookup(presets: Presets | undefined, name: string): Preset | undefined {
  return presets && Object.hasOwn(presets, name) && isPlainObject(presets[name])
    ? presets[name]
    : undefined;
}

function presetTiming(from: Pick<Animation, (typeof PRESET_TIMING)[number]>) {
  const timing: Partial<Pick<Animation, (typeof PRESET_TIMING)[number]>> = {};
  for (const key of PRESET_TIMING) {
    if (from[key] !== undefined) Object.assign(timing, { [key]: from[key] });
  }
  return timing;
}
