/**
 * Slide transitions (D123): how a slide arrives, as pure, seekable motion. The renderer
 * draws two slides at once (the one leaving under the one arriving) and plays what this
 * module computes for any moment; sampled, it runs on the compositor like slide motion
 * (D107), and seeking a moment gives the same frame every time (golden rule 3).
 *
 * - **fade**: the arriving slide fades in over the leaving one.
 * - **push**: both travel together, the new one sliding in from the side (`direction`).
 * - **zoom**: the leaving slide grows away as the new one settles in from slightly small.
 * - **morph**: layers that are "the same" on both slides (D109's pairs) glide from where
 *   they were to where they are; the rest of the new slide fades in over the old one.
 *
 * Which transition: the slide's own, else its theme's signature (`theme.motion.transition`),
 * else a fade. At `calm`, a theme's signature push or zoom softens to a fade (a slide's own
 * choice always wins). Durations and easings are `$motion` tokens at the arriving slide's
 * level, so a transition follows the theme and the level like every other motion.
 */
import { type EasingFunction, easingFunction } from "./easing.js";
import { morphPairs } from "./morph.js";
import {
  DEFAULT_THEME_MOTION,
  resolveEasing,
  resolveTime,
  slideMotionLevel,
  slideMotionTokens,
} from "./motion-tokens.js";
import type { Deck, Slide } from "./schema/deck.js";
import type { EasingValue, Transition, TransitionDirection } from "./schema/motion.js";
import type { Node } from "./schema/node.js";

/** A transition with its tokens resolved, ready to play. */
export interface ResolvedTransition {
  type: "fade" | "push" | "zoom" | "morph";
  duration: number;
  easing: EasingValue;
  direction: TransitionDirection;
  /** Where it came from: the slide's own, or the theme's signature. */
  source: "slide" | "theme";
}

/** How slides arrive when neither the slide nor its theme says. */
export const DEFAULT_TRANSITION: Transition = { type: "fade", duration: "$motion.normal" };

/** The transition a slide arrives with, resolved; null: it cuts (`"none"`, or no time). */
export function transitionInto(
  deck: Pick<Deck, "theme" | "motionLevel">,
  slide: Pick<Slide, "transition" | "motionLevel">,
): ResolvedTransition | null {
  const source = slide.transition ? "slide" : "theme";
  const spec =
    slide.transition ??
    deck.theme.motion?.transition ??
    DEFAULT_THEME_MOTION.transition ??
    DEFAULT_TRANSITION;
  if (spec.type === "none") return null;
  const tokens = slideMotionTokens(deck, slide);
  const duration = resolveTime(spec.duration ?? "$motion.slow", tokens);
  if (duration <= 0) return null;
  // Calm means soft: a theme's travelling signature becomes a fade. A slide's own choice stays.
  const calm = source === "theme" && slideMotionLevel(deck, slide) === "calm";
  return {
    type: calm && (spec.type === "push" || spec.type === "zoom") ? "fade" : spec.type,
    duration,
    easing: resolveEasing(spec.easing ?? "$motion.move", tokens),
    direction: spec.direction ?? "left",
    source,
  };
}

// ── Whole slides: fade, push, zoom ────────────────────────────────────────────────────

/**
 * How a whole slide is drawn during a transition: moved (stage pixels), scaled about its
 * centre, faded. Identity is `{ x: 0, y: 0, scale: 1, opacity: 1 }`.
 */
export interface SlideTween {
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

export const REST_TWEEN: SlideTween = { x: 0, y: 0, scale: 1, opacity: 1 };

/** How far a zoom grows the leaving slide and shrinks the arriving one, at the ends. */
const ZOOM = 0.12;

/**
 * Both slides at eased progress `p` (0–1, may overshoot with a spring): the leaving one
 * (`from`, drawn underneath) and the arriving one (`to`, on top).
 */
export function slidesAt(
  transition: Pick<ResolvedTransition, "type" | "direction">,
  p: number,
  stage: { width: number; height: number },
): { from: SlideTween; to: SlideTween } {
  switch (transition.type) {
    case "push": {
      const [axis, size, sign] =
        transition.direction === "left"
          ? (["x", stage.width, -1] as const)
          : transition.direction === "right"
            ? (["x", stage.width, 1] as const)
            : transition.direction === "up"
              ? (["y", stage.height, -1] as const)
              : (["y", stage.height, 1] as const);
      // Travelling left: the old slide leaves to the left, the new one comes from the right.
      return {
        from: { ...REST_TWEEN, [axis]: sign * size * p },
        to: { ...REST_TWEEN, [axis]: -sign * size * (1 - p) },
      };
    }
    case "zoom":
      return {
        from: { ...REST_TWEEN, scale: 1 + ZOOM * p, opacity: clamp01(1 - p) },
        to: { ...REST_TWEEN, scale: 1 - ZOOM * (1 - p), opacity: clamp01(p) },
      };
    default: // fade, and morph's backdrop
      return { from: REST_TWEEN, to: { ...REST_TWEEN, opacity: clamp01(p) } };
  }
}

// ── Morph ─────────────────────────────────────────────────────────────────────────────

/** A layer's box on the stage, in stage pixels, as drawn at rest. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How one layer is drawn during a morph, on top of whatever else draws it: moved (stage
 * pixels, in its frame's axes), scaled about its centre, turned (degrees), faded.
 */
export interface LayerTween {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  opacity: number;
}

const REST_LAYER: LayerTween = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 };

/** One layer that moves in a morph: where it rests, where it travels from or to. */
interface MorphLayer {
  id: string;
  /** Its own box at rest, on its slide. */
  rest: Box;
  /** The other end: the box it starts at (arriving) or ends at (leaving). */
  other: Box;
  /** Its rotation's difference to the other end, in degrees. */
  turn: number;
  /** Text and images keep their proportions (one scale); shapes and frames stretch. */
  uniform: boolean;
  /** Its nearest ancestor that also moves in the morph, on its own slide. */
  parent: string | null;
}

export interface MorphPlan {
  /** Arriving layers that travel from their pair's box. */
  to: MorphLayer[];
  /** Leaving layers that travel to their pair's box (drawn under the arriving slide). */
  from: MorphLayer[];
  /**
   * Leaving layers hidden from the start: their pair looks the same, so it alone is drawn
   * (no ghost of two copies half-faded).
   */
  hidden: string[];
  /** Arriving layers that fade in as they travel (their pair looks different). */
  crossfade: string[];
  /** Arriving layers that fade in where they are: nothing on the leaving slide matched them. */
  fadeIn: string[];
}

export interface MorphInput {
  from: Slide;
  to: Slide;
  /** Every layer's box at rest, on each slide (from the renderer). */
  boxes: { from: ReadonlyMap<string, Box>; to: ReadonlyMap<string, Box> };
  /**
   * Layers already moved or hidden by their own animation at the morph's ends (an entrance
   * still to play, a loop): they're left to it, not paired.
   */
  moving?: { from?: ReadonlySet<string>; to?: ReadonlySet<string> };
}

/** Plan a morph: which layers travel, which fade, from what measured boxes. */
export function planMorph({ from, to, boxes, moving = {} }: MorphInput): MorphPlan {
  const pairs = morphPairs(from, to).filter(
    (p) =>
      !moving.from?.has(p.from.id) &&
      !moving.to?.has(p.to.id) &&
      boxes.from.has(p.from.id) &&
      boxes.to.has(p.to.id),
  );
  const toParents = parents(to.root);
  const fromParents = parents(from.root);
  const pairedTo = new Map(pairs.map((p) => [p.to.id, p]));
  const pairedFrom = new Map(pairs.map((p) => [p.from.id, p]));

  // Arriving layers nothing matched fade in, as whole subtrees with no pair inside (a frame
  // holding a travelling layer would fade it too). Layers with their own entrance are left
  // alone: their own animation decides when they show.
  const fadeIn: string[] = [];
  const fading = new Set<string>();
  const visit = (node: Node, faded: boolean) => {
    if (moving.to?.has(node.id)) return;
    const pair = pairedTo.has(node.id);
    const fades = !faded && !pair && !hasPair(node, pairedTo);
    if (fades) fadeIn.push(node.id);
    if (faded || fades) fading.add(node.id);
    if (node.kind === "frame") for (const child of node.children) visit(child, faded || fades);
  };
  for (const child of to.root.children) visit(child, false);

  const nearest = (id: string, up: Map<string, string | null>, paired: Map<string, unknown>) => {
    for (let p = up.get(id) ?? null; p !== null; p = up.get(p) ?? null) {
      if (paired.has(p)) return p;
    }
    return null;
  };

  const plan: MorphPlan = { to: [], from: [], hidden: [], crossfade: [], fadeIn };
  for (const pair of pairs) {
    const a = boxes.from.get(pair.from.id) as Box;
    const b = boxes.to.get(pair.to.id) as Box;
    const uniform = keepsProportions(pair.to);
    const turn = (pair.from.rotation ?? 0) - (pair.to.rotation ?? 0);
    plan.to.push({
      id: pair.to.id,
      rest: b,
      other: a,
      turn,
      uniform,
      parent: nearest(pair.to.id, toParents, pairedTo),
    });
    plan.from.push({
      id: pair.from.id,
      rest: a,
      other: b,
      turn: -turn,
      uniform,
      parent: nearest(pair.from.id, fromParents, pairedFrom),
    });
    // The same look on both: draw the arriving one only. Different: cross-fade them.
    const same = looksSame(pair.from, pair.to) && !fading.has(pair.to.id);
    if (same) plan.hidden.push(pair.from.id);
    else plan.crossfade.push(pair.to.id);
  }
  return plan;
}

/** Every layer's tween at eased progress `p`, both slides, and the arriving backdrop's opacity. */
export function morphAt(
  plan: MorphPlan,
  p: number,
): { from: Map<string, LayerTween>; to: Map<string, LayerTween>; backdrop: number } {
  const fade = clamp01(p);
  const to = side(
    plan.to,
    (layer) => lerpBox(layer.other, layer.rest, p),
    (l) => l.turn * (1 - p),
  );
  const from = side(
    plan.from,
    (layer) => lerpBox(layer.rest, layer.other, p),
    (l) => l.turn * p,
  );
  for (const id of plan.crossfade) {
    const t = to.get(id);
    if (t) t.opacity = fade;
  }
  for (const id of plan.fadeIn) to.set(id, { ...REST_LAYER, opacity: fade });
  for (const id of plan.hidden) {
    const f = from.get(id);
    if (f) f.opacity = 0;
  }
  return { from, to, backdrop: fade };
}

/**
 * One slide's travelling layers at a moment: each drawn so its box lands on `target`, after
 * what its travelling ancestors already do to it (they're laid out first, parents before
 * children). Moves and scales compose as maps of the stage: p ↦ centre + s·(p − centre) + t.
 */
function side(
  layers: readonly MorphLayer[],
  target: (layer: MorphLayer) => Box,
  turn: (layer: MorphLayer) => number,
): Map<string, LayerTween> {
  const maps = new Map<string, StageMap>();
  const out = new Map<string, LayerTween>();
  for (const layer of byDepth(layers)) {
    const inherited = layer.parent ? (maps.get(layer.parent) ?? IDENTITY) : IDENTITY;
    const goal = target(layer);
    // Where the ancestors alone would draw its box: then what it adds to land on the goal.
    const carried = applyBox(inherited, layer.rest);
    let sx = goal.width / Math.max(carried.width, 1e-6);
    let sy = goal.height / Math.max(carried.height, 1e-6);
    if (layer.uniform) sx = sy = Math.sqrt(Math.abs(sx * sy));
    // The move is in its frame's units, before the ancestors' scale: undo it.
    const centre = centreOf(goal);
    const local = invertPoint(inherited, centre);
    const restCentre = centreOf(layer.rest);
    const x = local.x - restCentre.x;
    const y = local.y - restCentre.y;
    out.set(layer.id, { x, y, scaleX: sx, scaleY: sy, rotate: turn(layer), opacity: 1 });
    maps.set(
      layer.id,
      compose(inherited, { cx: restCentre.x, cy: restCentre.y, sx, sy, tx: x, ty: y }),
    );
  }
  return out;
}

// ── Stage maps: move + scale about a centre, composed ─────────────────────────────────

/** p ↦ (c + s·(p − c) + t) for each step, applied first to last (innermost first). */
interface MapStep {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}
type StageMap = readonly MapStep[];
const IDENTITY: StageMap = [];

/** A layer's own step first, then its ancestors' (their transforms wrap it). */
const compose = (outer: StageMap, own: MapStep): StageMap => [own, ...outer];

function applyPoint(map: StageMap, p: { x: number; y: number }) {
  let { x, y } = p;
  for (const s of map) {
    x = s.cx + s.sx * (x - s.cx) + s.tx;
    y = s.cy + s.sy * (y - s.cy) + s.ty;
  }
  return { x, y };
}

function invertPoint(map: StageMap, p: { x: number; y: number }) {
  let { x, y } = p;
  for (let i = map.length - 1; i >= 0; i--) {
    const s = map[i] as MapStep;
    x = s.cx + (x - s.tx - s.cx) / (s.sx || 1e-6);
    y = s.cy + (y - s.ty - s.cy) / (s.sy || 1e-6);
  }
  return { x, y };
}

function applyBox(map: StageMap, box: Box): Box {
  const a = applyPoint(map, { x: box.x, y: box.y });
  const b = applyPoint(map, { x: box.x + box.width, y: box.y + box.height });
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

const centreOf = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

const lerpBox = (a: Box, b: Box, p: number): Box => ({
  x: a.x + (b.x - a.x) * p,
  y: a.y + (b.y - a.y) * p,
  width: Math.max(0, a.width + (b.width - a.width) * p),
  height: Math.max(0, a.height + (b.height - a.height) * p),
});

// ── Helpers ───────────────────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Each layer's parent frame (null under the root). */
function parents(root: Slide["root"]): Map<string, string | null> {
  const up = new Map<string, string | null>();
  const visit = (node: Node, parent: string | null) => {
    up.set(node.id, parent);
    if (node.kind === "frame") for (const child of node.children) visit(child, node.id);
  };
  for (const child of root.children) visit(child, null);
  return up;
}

const hasPair = (node: Node, paired: ReadonlyMap<string, unknown>): boolean =>
  node.kind === "frame" && node.children.some((c) => paired.has(c.id) || hasPair(c, paired));

/** Parents before children, so a layer's travelling ancestors are planned first. */
function byDepth(layers: readonly MorphLayer[]): MorphLayer[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const depth = (l: MorphLayer): number =>
    l.parent ? 1 + depth(byId.get(l.parent) as MorphLayer) : 0;
  return [...layers].sort((a, b) => depth(a) - depth(b));
}

/** Text and images keep their proportions while they travel; boxes and shapes stretch. */
const keepsProportions = (node: Node): boolean => node.kind === "element" && node.type !== "shape";

/** Whether two layers draw the same (their own look, not where they sit or how big). */
function looksSame(a: Node, b: Node): boolean {
  if (a.kind !== b.kind || (a.opacity ?? 1) !== (b.opacity ?? 1)) return false;
  if (a.kind === "element" && b.kind === "element") {
    return a.type === b.type && sameJson(a.props, b.props);
  }
  if (a.kind === "frame" && b.kind === "frame") return sameJson(a.style ?? {}, b.style ?? {});
  return false;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── Playing it ────────────────────────────────────────────────────────────────────────

/** A transition compiled for two slides: what to draw at any moment of it. */
export interface CompiledTransition {
  transition: ResolvedTransition;
  /** The eased progress at `time` ms into it (0 before, 1 after). */
  progress(time: number): number;
  /** Both slides, and (morph) their travelling layers and the arriving backdrop, at `time`. */
  at(time: number): TransitionFrame;
}

export interface TransitionFrame {
  from: SlideTween;
  to: SlideTween;
  /** Morph only. */
  layers?: { from: Map<string, LayerTween>; to: Map<string, LayerTween> };
  /** Morph only: the arriving slide's background, faded in under its layers. */
  backdrop?: number;
}

/**
 * Compile a transition. A morph needs its plan (from `planMorph`); one with no pairs plays
 * as a fade, since nothing would travel.
 */
export function compileTransition(
  transition: ResolvedTransition,
  stage: { width: number; height: number },
  morph?: MorphPlan,
): CompiledTransition {
  const travels = morph !== undefined && morph.to.length > 0;
  const resolved: ResolvedTransition =
    transition.type === "morph" && !travels ? { ...transition, type: "fade" } : transition;
  const ease: EasingFunction = easingFunction(resolved.easing);
  const progress = (time: number) =>
    time <= 0 ? 0 : time >= resolved.duration ? 1 : ease(time / resolved.duration);
  return {
    transition: resolved,
    progress,
    at(time) {
      const p = progress(time);
      if (resolved.type !== "morph" || !morph) return slidesAt(resolved, p, stage);
      const layers = morphAt(morph, p);
      // The arriving slide stays fully drawn; its background and new layers fade in.
      return { from: REST_TWEEN, to: REST_TWEEN, layers, backdrop: layers.backdrop };
    },
  };
}

/**
 * Sample a value of the transition into keyframes for the compositor: evenly every frame
 * (a transition is short, and a spring's overshoot needs the samples), first and last
 * included. Returns times in ms from the transition's start.
 */
export function transitionTimes(duration: number, frameMs = 1000 / 60): number[] {
  const count = Math.max(1, Math.ceil(duration / frameMs));
  return Array.from({ length: count + 1 }, (_, i) => (duration * i) / count);
}
