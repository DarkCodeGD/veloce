/**
 * The Animate panel's model (D106 depths 1 and 2, D118): what the steps list shows, which
 * effects suit the selection, and the ops for adding, tuning, reordering and removing
 * animations. Pure: the registry's effect descriptions come in as data, so it's tested
 * without a browser, and every command is one transaction an agent could send too
 * (golden rule 1).
 */
import {
  type Animation,
  type AnimationSpace,
  type ApplyContext,
  animationProblem,
  clearOverridesPatch,
  createId,
  type Deck,
  getPreset,
  inlinePresetOps,
  isFreeLayer,
  type MotionLevel,
  type MotionTokens,
  type Node,
  type Op,
  PRESET_TIMING,
  presetFromAnimation,
  presetOf,
  presetOverrides,
  presetTitle,
  resolveTime,
  type Slide,
  type STAGGER_FROM,
  scheduleSlide,
  type Time,
  type Trigger,
} from "@veloce/core";
import type { EffectKind } from "@veloce/plugin-api";
import type { Command } from "./commands.js";
import { nodeLabel, type SlideIndex } from "./slide-index.js";

/**
 * What the panel needs to know about an effect (a slice of the registry's `EffectInfo`), or
 * about one of the deck's saved presets (D119), which the panel offers like an effect.
 */
export interface EffectSummary {
  name: string;
  title: string;
  description: string;
  /** A keyframe preset is `custom`: it brings nothing in or out by itself. */
  kind: EffectKind | "custom";
  /** Element types it plays on; absent: any layer. */
  targets?: readonly string[];
  /** A saved preset: whether it suits a layer is asked of core (it may be keyframes). */
  saved?: { suits(layer: Node): boolean };
}

/**
 * The deck's saved presets as the gallery shows them, A to Z by title: an effect preset
 * takes its effect's kind; whether one suits a layer is core's own check, the one an op
 * adding it would run (golden rule 1).
 */
export function savedPresets(
  deck: Deck,
  slide: Slide,
  describe: (name: string) => EffectSummary | undefined,
  ctx: ApplyContext,
): EffectSummary[] {
  return Object.entries(deck.presets ?? {})
    .map(([name, preset]): EffectSummary => {
      const base = preset.effect && describe(preset.effect.name);
      return {
        name,
        title: presetTitle(name, preset),
        description:
          preset.description ??
          (base ? `${base.title}, tuned and saved in this deck` : "Keyframes saved in this deck"),
        kind: preset.tracks ? "custom" : (base?.kind ?? "custom"),
        saved: {
          suits: (layer) =>
            animationProblem(
              slide,
              { id: "preset-check", target: layer.id, effect: { name } },
              ctx,
              deck.presets,
            ) === null,
        },
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Looks a name up among the deck's presets first (they win in their deck), then `describe`. */
export const describeWithPresets =
  (saved: readonly EffectSummary[], describe: (name: string) => EffectSummary | undefined) =>
  (name: string): EffectSummary | undefined =>
    saved.find((p) => p.name === name) ?? describe(name);

// ── The gallery ───────────────────────────────────────────────────────────────────────

/** PowerPoint's order: what brings a layer in, what draws the eye to it, what takes it out. */
const KINDS: ReadonlyArray<{ kind: EffectKind; title: string }> = [
  { kind: "entrance", title: "Entrance" },
  { kind: "emphasis", title: "Emphasis" },
  { kind: "exit", title: "Exit" },
];

export interface GalleryGroup {
  kind: EffectKind | "saved";
  title: string;
  effects: EffectSummary[];
}

/** Whether an effect plays on every one of `layers` (a typewriter only on text). */
export const effectSuits = (effect: EffectSummary, layers: readonly Node[]): boolean =>
  effect.saved
    ? layers.every((n) => effect.saved?.suits(n))
    : !effect.targets ||
      layers.every((n) => n.kind === "element" && (effect.targets?.includes(n.type) ?? false));

/**
 * The effects the selected layers can take: the deck's saved presets first (the ones made
 * for this deck), then the installed effects by kind, in the registry's order. Effects that
 * don't suit every layer are left out: a gallery shows what a click can do.
 */
export function effectGallery(
  effects: readonly EffectSummary[],
  layers: readonly Node[],
  saved: readonly EffectSummary[] = [],
): GalleryGroup[] {
  return [
    {
      kind: "saved" as const,
      title: "Saved",
      effects: saved.filter((e) => effectSuits(e, layers)),
    },
    ...KINDS.map(({ kind, title }) => ({
      kind,
      title,
      effects: effects.filter((e) => e.kind === kind && effectSuits(e, layers)),
    })),
  ].filter((group) => group.effects.length > 0);
}

// ── The steps list ────────────────────────────────────────────────────────────────────

export interface StepRow {
  animation: Animation;
  /** Its place in the slide's play order. */
  index: number;
  /** The layer it animates, as the Layers panel names it (or "Missing layer"). */
  layer: string;
  /** The effect's title, "Custom" for keyframes, or the unknown effect's own name. */
  effect: string;
  /** Entrance, exit, emphasis; `custom` for keyframes; `missing` for an effect not installed. */
  kind: EffectKind | "custom" | "missing";
  trigger: Trigger;
}

export interface StepGroup {
  /** 0 plays as the slide appears; each click after that is the next step. */
  step: number;
  title: string;
  rows: StepRow[];
}

/**
 * The slide's animations grouped into steps, as they'll play: what starts as the slide
 * appears, then what each click starts. Step 0 is left out when nothing plays before the
 * first click.
 */
export function stepsList(
  slide: Slide,
  index: SlideIndex,
  describe: (name: string) => EffectSummary | undefined,
): StepGroup[] {
  const order = new Map((slide.animations ?? []).map((a, i) => [a.id, i]));
  return scheduleSlide(slide)
    .map(
      (step, n): StepGroup => ({
        step: n,
        title: n === 0 ? "As the slide appears" : `Click ${n}`,
        rows: step.animations.map(({ animation }) => {
          const node = index.nodes.get(animation.target)?.node;
          const effect = animation.effect && describe(animation.effect.name);
          return {
            animation,
            index: order.get(animation.id) ?? 0,
            layer: node ? nodeLabel(node) : "Missing layer",
            effect: [
              effect?.title ?? animation.effect?.name ?? "Custom",
              animation.stagger && "one by one",
              animation.space === "makeRoom" && "makes room",
              animation.space === "collapse" && "closes the gap",
            ]
              .filter(Boolean)
              .join(" · "),
            kind: effect?.kind ?? (animation.effect ? "missing" : "custom"),
            trigger: animation.trigger ?? "onClick",
          };
        }),
      }),
    )
    .filter((group) => group.step > 0 || group.rows.length > 0);
}

/** The slide's animations of one layer, in play order. */
export const animationsOf = (slide: Slide, layerId: string): Animation[] =>
  (slide.animations ?? []).filter((a) => a.target === layerId);

// ── Commands ──────────────────────────────────────────────────────────────────────────

export interface AddedAnimations {
  command: Command;
  /** The new animations' IDs, in play order (the first is the one to show tuned). */
  ids: string[];
}

/**
 * Animate `layerIds` with `effect`: one animation each, as one undo step. The first starts
 * on a click (PowerPoint's default) and the others with it, so several selected layers move
 * together. They go right after `after` (the animation being tuned), else at the end.
 */
export function addEffect(
  slide: Slide,
  layerIds: readonly string[],
  effect: EffectSummary,
  after?: string,
): AddedAnimations | null {
  if (layerIds.length === 0) return null;
  const at = after ? (slide.animations ?? []).findIndex((a) => a.id === after) : -1;
  const ids = layerIds.map(() => createId("an"));
  const ops: Op[] = layerIds.map((target, i) => ({
    op: "animation.insert",
    slideId: slide.id,
    animation: {
      id: ids[i] as string,
      target,
      ...(i > 0 && { trigger: "withPrevious" as const }),
      effect: { name: effect.name },
    },
    ...(at >= 0 && { index: at + 1 + i }),
  }));
  return { command: { label: `Add ${effect.title.toLowerCase()}`, ops }, ids };
}

/** One animation's fields changed (`null` unsets one), as one undo step. */
export function updateAnimation(id: string, set: Record<string, unknown>, label: string): Command {
  return { label, ops: [{ op: "animation.update", id, set }] };
}

/** Another effect for an animation: its own params go (they belong to the old one). */
export const changeEffect = (animation: Animation, effect: EffectSummary): Command | null =>
  animation.effect?.name === effect.name
    ? null
    : updateAnimation(
        animation.id,
        // Keyframes give way to the effect, and the old effect's params go with it.
        { effect: { name: effect.name, params: null }, tracks: null },
        "Change effect",
      );

/** When it starts. On click is the default, so it's stored as no trigger at all. */
export const setTrigger = (animation: Animation, trigger: Trigger): Command | null =>
  (animation.trigger ?? "onClick") === trigger
    ? null
    : updateAnimation(
        animation.id,
        { trigger: trigger === "onClick" ? null : trigger },
        "Change start",
      );

/** One effect param changed (`null`: back to the effect's default, which follows the level). */
export function setEffectParam(animation: Animation, key: string, value: unknown): Command | null {
  const params = animation.effect?.params ?? {};
  const unset = value === null || value === undefined;
  if (!animation.effect || (unset && !(key in params))) return null;
  // The last param going takes `params` with it (an empty record isn't worth storing).
  const others = Object.keys(params).filter((k) => k !== key);
  const patch = unset && others.length === 0 ? null : { [key]: unset ? null : value };
  return updateAnimation(animation.id, { effect: { params: patch } }, "Change effect settings");
}

// ── Layout (D120) ─────────────────────────────────────────────────────────────────────

/**
 * Whether an animation can make room or close the gap: its layer must be placed by a stack
 * or grid (not free, not the slide), and it can't be staggered. Entrances make room, exits
 * close the gap; emphasis and keyframes don't change whether a layer is there.
 */
export function spaceChoice(
  animation: Animation,
  kind: EffectSummary["kind"] | undefined,
  index: SlideIndex,
): "makeRoom" | "collapse" | null {
  if (animation.stagger) return null;
  const at = index.nodes.get(animation.target);
  const parent = at?.parentId ? index.nodes.get(at.parentId)?.node : undefined;
  if (!at || parent?.kind !== "frame" || isFreeLayer(at.node, parent.layout)) return null;
  if (kind === "entrance") return "makeRoom";
  if (kind === "exit" && animation.repeat !== "forever") return "collapse";
  return null;
}

/** Make room / Close the gap on or off. */
export const setSpace = (animation: Animation, space: AnimationSpace | null): Command | null =>
  (animation.space ?? null) === space
    ? null
    : updateAnimation(
        animation.id,
        { space },
        space === "makeRoom" ? "Make room" : space === "collapse" ? "Close the gap" : "Keep space",
      );

export type StaggerFrom = (typeof STAGGER_FROM)[number];

/** How a frame's animation plays on its children: together (null), or one by one from `from`. */
export function setStagger(animation: Animation, from: StaggerFrom | null): Command | null {
  const now = animation.stagger ? (animation.stagger.from ?? "start") : null;
  if (now === from) return null;
  const set =
    from === null
      ? { stagger: null }
      : // "start" is the default: stored as no `from`, keeping any gap already set.
        { stagger: { from: from === "start" ? null : from }, space: null };
  return updateAnimation(animation.id, set, from === null ? "Play together" : "Play one by one");
}

/** The gap between children's starts, ms (`null`: back to `$motion.stagger`). */
export const setStaggerGap = (animation: Animation, each: number | null): Command | null =>
  animation.stagger ? updateAnimation(animation.id, { stagger: { each } }, "Change gap") : null;

/**
 * Move an animation one place earlier or later in the play order (PowerPoint's Move Earlier
 * / Move Later). Null at either end.
 */
export function moveAnimation(slide: Slide, id: string, by: -1 | 1): Command | null {
  const all = slide.animations ?? [];
  const from = all.findIndex((a) => a.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= all.length) return null;
  return {
    label: by < 0 ? "Move animation earlier" : "Move animation later",
    ops: [{ op: "animation.move", id, index: to }],
  };
}

export function removeAnimations(ids: readonly string[]): Command | null {
  if (ids.length === 0) return null;
  return {
    label: ids.length === 1 ? "Remove animation" : `Remove ${ids.length} animations`,
    ops: ids.map((id) => ({ op: "animation.remove", id })),
  };
}

/** Every animation of the given layers, as one undo step. */
export function removeLayerAnimations(slide: Slide, layerIds: readonly string[]): Command | null {
  const ids = (slide.animations ?? []).filter((a) => layerIds.includes(a.target)).map((a) => a.id);
  return removeAnimations(ids);
}

// ── Saved presets (D119) ──────────────────────────────────────────────────────────────

/**
 * A preset name from what someone typed ("Big bounce!" → "big-bounce"), not taken by
 * another preset or an installed effect: "-2", "-3"… when it is. Names are what agents type,
 * so they're plain lowercase words; the typed text stays as the title.
 */
export function presetName(title: string, taken: (name: string) => boolean): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  const base = /^[a-z]/.test(slug) ? slug : `preset${slug ? `-${slug}` : ""}`.slice(0, 50);
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

export interface SavedPreset {
  command: Command;
  name: string;
}

/**
 * Save as preset: the tuned animation's motion and timing kept in the deck under a new name
 * (`isInstalled` says which names the installed effects have), and the animation then plays
 * it, its own copies of those settings dropped. One undo step.
 */
export function savePreset(
  deck: Deck,
  animation: Animation,
  about: { title: string; description?: string },
  isInstalled: (name: string) => boolean,
): SavedPreset {
  const title = about.title.trim();
  const name = presetName(title, (n) => isInstalled(n) || getPreset(deck, n) !== undefined);
  const preset = presetFromAnimation(animation, deck.presets, {
    title,
    ...(about.description !== undefined && { description: about.description }),
  });
  const set: Record<string, unknown> = {
    effect: { name, params: null },
    ...(animation.tracks && { tracks: null }),
  };
  for (const key of PRESET_TIMING) if (animation[key] !== undefined) set[key] = null;
  return {
    name,
    command: {
      label: "Save as preset",
      ops: [
        { op: "preset.save", name, preset },
        { op: "animation.update", id: animation.id, set },
      ],
    },
  };
}

/**
 * Update preset: the changes this animation makes to the preset it plays become the
 * preset's, for every animation that plays it (Figma's "update style"). Null when it plays
 * none, or plays it as saved.
 */
export function updatePreset(deck: Deck, animation: Animation): Command | null {
  const found = presetOf(deck.presets, animation);
  if (!found || presetOverrides(animation).length === 0) return null;
  const { title, description } = found.preset;
  const preset = presetFromAnimation(animation, deck.presets, {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
  });
  return {
    label: "Update preset",
    ops: [
      { op: "preset.save", name: found.name, preset },
      { op: "animation.update", id: animation.id, set: clearOverridesPatch(animation) },
    ],
  };
}

/**
 * Delete a preset: every animation that plays it gets its own copy first, so nothing on the
 * slides changes (D119). One undo step.
 */
export function deletePreset(deck: Deck, name: string): Command | null {
  const preset = getPreset(deck, name);
  if (!preset) return null;
  return {
    label: `Delete preset “${presetTitle(name, preset)}”`,
    ops: [...inlinePresetOps(deck, name), { op: "preset.remove", name }],
  };
}

/** The deck's motion level; `subtle` is the default, so it's stored as none. */
export const setMotionLevel = (level: MotionLevel | null): Command => ({
  label: "Change motion level",
  ops: [{ op: "deck.setMotionLevel", level: level === "subtle" ? null : level }],
});

// ── Speed ─────────────────────────────────────────────────────────────────────────────

/** The speeds the panel offers: the `$motion` durations, so they follow the level. */
export const SPEEDS = [
  { value: "$motion.fast", label: "Fast" },
  { value: "$motion.normal", label: "Medium" },
  { value: "$motion.slow", label: "Slow" },
] as const;

/**
 * A speed's label with its length at the slide's level ("Fast · 200 ms"), so people see
 * what the level does to it.
 */
export const speedLabel = (speed: (typeof SPEEDS)[number], tokens: MotionTokens): string =>
  `${speed.label} · ${resolveTime(speed.value, tokens)} ms`;

/** A duration as the speed list shows it: a token's value, else its own milliseconds. */
export const speedValue = (duration: Time | undefined): string | undefined =>
  duration === undefined ? undefined : String(duration);

// ── Previews ──────────────────────────────────────────────────────────────────────────

/**
 * The deck with only `animations` on the slide, playing as it appears: what a preview plays
 * (an effect hovered in the gallery, or the animation being tuned). The first starts at
 * once, without its trigger or delay; the rest keep their timing after it.
 */
export function soloAnimations(
  deck: Deck,
  slideId: string,
  animations: readonly Animation[],
): Deck {
  const solo = animations.map((a, i) => {
    if (i > 0) return a;
    const { delay: _delay, ...rest } = a;
    return { ...rest, trigger: "withPrevious" as const };
  });
  return {
    ...deck,
    slides: deck.slides.map((s) => (s.id === slideId ? { ...s, animations: solo } : s)),
  };
}

/** What hovering `effect` in the gallery previews: it, on every selected layer, together. */
export const galleryPreview = (layerIds: readonly string[], effect: EffectSummary): Animation[] =>
  layerIds.map((target, i) => ({
    id: `preview-${i}`,
    target,
    trigger: "withPrevious",
    effect: { name: effect.name },
  }));
