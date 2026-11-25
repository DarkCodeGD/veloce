/**
 * Motion that comes from layout (D120): staggering a frame's children in reading order, and
 * layers that take their space in a stack or grid only while they're there.
 *
 * **Layout never changes while a slide plays.** The renderer keeps every layer where the
 * slide's layout puts it with all of them present (the rest position, D83 §5). A layer that
 * is "out" of the layout is hidden, and the layers around it are drawn where the smaller
 * layout would put them, as motion offsets added to their own (FLIP: measure both layouts,
 * animate the difference). So a glide is transforms only: it plays on the compositor like any
 * motion, seeking stays pure, and nothing reflows per frame.
 *
 * Each layout state (which layers are out) is measured once when the slide is compiled,
 * through a `LayoutMeasurer` the renderer provides, as effects come in through a resolver.
 */
import { type EasingFunction, easingFunction } from "./easing.js";
import type { PlayPosition } from "./evaluate.js";
import { type MotionTokens, resolveEasing, resolveTime } from "./motion-tokens.js";
import { hashSeed, staggerDelays } from "./random.js";
import type { Animation } from "./schema/animation.js";
import type { Easing, Time } from "./schema/motion.js";
import type { FrameNode, Node } from "./schema/node.js";
import type { Step } from "./timeline.js";

/** How the others glide when a layer joins or leaves the layout: the theme's own move. */
export const LAYOUT_GLIDE: { duration: Time; easing: Easing } = {
  duration: "$motion.normal",
  easing: "$motion.move",
};

// ── Stagger ──────────────────────────────────────────────────────────────────────────

/**
 * A frame's children in reading order: a stack's and a grid's as they're laid out (a grid
 * fills row by row); a free frame's by position, top to bottom, then left to right.
 */
export function readingOrder(frame: FrameNode): Node[] {
  if (frame.layout.mode !== "absolute") return [...frame.children];
  return frame.children
    .map((node, index) => ({ node, index }))
    .sort(
      (a, b) =>
        (a.node.position?.y ?? 0) - (b.node.position?.y ?? 0) ||
        (a.node.position?.x ?? 0) - (b.node.position?.x ?? 0) ||
        a.index - b.index,
    )
    .map(({ node }) => node);
}

/**
 * The children a staggered animation plays on, each with its delay after the animation's
 * start: `each` apart (default `$motion.stagger`, so it follows the level), from where
 * `from` says. A random order is seeded by the animation's ID, so it's the same every time.
 */
export function staggerTargets(
  frame: FrameNode,
  animation: Pick<Animation, "id" | "stagger">,
  tokens: MotionTokens,
): { node: Node; delay: number }[] {
  const children = readingOrder(frame);
  const each = resolveTime(animation.stagger?.each ?? "$motion.stagger", tokens);
  const delays = staggerDelays(children.length, each, {
    from: animation.stagger?.from ?? "start",
    seed: hashSeed(animation.id),
  });
  return children.map((node, i) => ({ node, delay: delays[i] ?? 0 }));
}

/** How long after its start a staggered animation's last child starts. */
export const staggerSpread = (targets: readonly { delay: number }[]): number =>
  Math.max(0, ...targets.map((t) => t.delay));

// ── Layers that take space only while they're there ──────────────────────────────────

/**
 * Where each layer's box sits in its parent frame, in stage pixels, with the layers in
 * `absent` taken out of the layout. Layers not in the map are out (or not drawn). The frames
 * around the absent layers keep their rest size, as they're drawn while playing, so only
 * those layers' siblings move: never the frame, or what's around it.
 */
export type LayoutMeasurer = (
  absent: ReadonlySet<string>,
) => ReadonlyMap<string, { x: number; y: number }>;

/**
 * A layer joining (as its `makeRoom` animation's room opens, a glide before it plays) or
 * leaving (once its `collapse` animation ends) the layout.
 */
export interface LayoutEvent {
  step: number;
  /** Milliseconds from its step's start. */
  time: number;
  layer: string;
  joins: boolean;
}

interface Offset {
  x: number;
  y: number;
}

export interface CompiledLayout {
  /** In play order (step, then time). */
  events: LayoutEvent[];
  /** Per layer it moves or hides: its offset in each state (0 before any event), null while out. */
  offsets: Map<string, (Offset | null)[]>;
  glide: number;
  ease: EasingFunction;
}

/**
 * The layout changes in a slide's schedule, in play order. A layer that makes room joins a
 * glide before its animation plays (`scheduleSlide` starts it that late).
 */
export function layoutEvents(steps: readonly Step[], glide: number): LayoutEvent[] {
  const events: (LayoutEvent & { order: number })[] = [];
  let order = 0;
  steps.forEach((step, index) => {
    for (const { animation, start, end } of step.animations) {
      if (!animation.space) continue;
      const joins = animation.space === "makeRoom";
      events.push({
        step: index,
        time: joins ? start - glide : end,
        layer: animation.target,
        joins,
        order,
      });
      order++;
    }
  });
  events.sort((a, b) => a.step - b.step || a.time - b.time || a.order - b.order);
  return events.map(({ order: _order, ...event }) => event);
}

/**
 * The layout states of a slide and every layer's offset in each, measured once. Null when
 * no animation changes the layout. Without a measurer (no browser), layers still go out
 * and come back, but nothing glides.
 */
export function compileLayout(
  steps: readonly Step[],
  measure: LayoutMeasurer | undefined,
  tokens: MotionTokens,
): CompiledLayout | null {
  const glide = resolveTime(LAYOUT_GLIDE.duration, tokens);
  const events = layoutEvents(steps, glide);
  if (events.length === 0) return null;

  // Which layers are out in each state: one before any event, then one after each.
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const event of events) {
    if (!seen.has(event.layer) && event.joins) out.add(event.layer); // out until it joins
    seen.add(event.layer);
  }
  const states: Set<string>[] = [new Set(out)];
  for (const event of events) {
    if (event.joins) out.delete(event.layer);
    else out.add(event.layer);
    states.push(new Set(out));
  }

  // Measure each distinct state once; offsets are from the rest layout (nobody out).
  const cache = new Map<string, ReadonlyMap<string, Offset>>();
  const measured = (absent: ReadonlySet<string>) => {
    const key = [...absent].sort().join("\n");
    let boxes = cache.get(key);
    if (!boxes) {
      boxes = measure?.(absent) ?? new Map();
      cache.set(key, boxes);
    }
    return boxes;
  };
  const rest = measured(new Set());
  const offsets = new Map<string, (Offset | null)[]>();
  states.forEach((absent, i) => {
    const boxes = measured(absent);
    for (const [id, box] of boxes) {
      const home = rest.get(id);
      if (!home) continue;
      const dx = box.x - home.x;
      const dy = box.y - home.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
      const list = offsets.get(id) ?? states.map(() => ({ x: 0, y: 0 }) as Offset | null);
      list[i] = { x: dx, y: dy };
      offsets.set(id, list);
    }
    for (const id of absent) {
      const list = offsets.get(id) ?? states.map(() => ({ x: 0, y: 0 }) as Offset | null);
      list[i] = null;
      offsets.set(id, list);
    }
  });
  return {
    events,
    offsets,
    glide,
    ease: easingFunction(resolveEasing(LAYOUT_GLIDE.easing, tokens)),
  };
}

/** When a step started: step 0 as the slide appears, the others at their click. */
const stepStartOf = (step: number, clicks: readonly number[]) =>
  step === 0 ? 0 : clicks[step - 1];

/**
 * When each event happens, given the clicks so far (undefined: not yet clicked). Events keep
 * their play order even when a click comes early, so every state the slide passes through
 * is one that was measured.
 */
function eventTimes(layout: CompiledLayout, clicks: readonly number[]): number[] {
  const times: number[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const event of layout.events) {
    const stepStart = stepStartOf(event.step, clicks);
    if (stepStart === undefined) break;
    previous = Math.max(stepStart + event.time, previous);
    times.push(previous);
  }
  return times;
}

/**
 * Where layout puts a layer at a moment, as an offset from its rest position, and whether
 * it's hidden: out of the layout, or just joined and waiting for the room to open (its own
 * entrance plays once it has). Undefined: layout never moves it.
 */
export function layoutAt(
  layout: CompiledLayout,
  id: string,
  position: PlayPosition,
): { x: number; y: number; out: boolean } | undefined {
  const offsets = layout.offsets.get(id);
  if (!offsets) return undefined;
  const zero = { x: 0, y: 0 };
  let from: Offset = offsets[0] ?? zero;
  let to: Offset = from;
  let start = Number.NEGATIVE_INFINITY;
  let state = 0;
  let waitsUntil = Number.NEGATIVE_INFINITY;
  const at = (time: number): Offset => {
    const progress = layout.glide > 0 ? Math.min(1, Math.max(0, (time - start) / layout.glide)) : 1;
    const eased = start === Number.NEGATIVE_INFINITY ? 1 : layout.ease(progress);
    return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
  };
  for (const time of eventTimes(layout, position.clicks)) {
    if (time > position.time) break;
    const now = at(time);
    state++;
    const next = offsets[state] ?? null;
    if (next === null) {
      from = now; // out now: it stays where it was, hidden
      to = now;
    } else if ((offsets[state - 1] ?? null) === null) {
      from = next; // it just joined: in place, hidden while the others glide aside
      to = next;
      waitsUntil = time + layout.glide;
    } else {
      from = now; // glides from wherever it is (even mid-glide) to its new place
      to = next;
    }
    start = time;
  }
  const out = (offsets[state] ?? null) === null || position.time < waitsUntil;
  return { ...at(position.time), out };
}

/** When layout stops moving each layer it moves, given the clicks so far. */
export function layoutUntil(layout: CompiledLayout, clicks: readonly number[]): number {
  const times = eventTimes(layout, clicks);
  return times.length === 0 ? Number.NEGATIVE_INFINITY : (times.at(-1) as number) + layout.glide;
}

/** The parent frame of `id` under `root`, or null (the root itself, or not found). */
export function parentOf(root: FrameNode, id: string): FrameNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    if (child.kind === "frame") {
      const found = parentOf(child, id);
      if (found) return found;
    }
  }
  return null;
}
