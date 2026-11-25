/**
 * Motion from layout (D120): a frame's children staggered in reading order, and layers that
 * take their space in a stack only while they're there, the others gliding as transforms.
 */
import { describe, expect, it } from "vitest";
import { createDeck, createSlide, element, frame } from "../builders.js";
import { compileSlide } from "../evaluate.js";
import { type LayoutMeasurer, readingOrder } from "../layout-motion.js";
import { planMotion } from "../motion-plan.js";
import { motionTokens, resolveTime } from "../motion-tokens.js";
import { type Animation, AnimationSchema } from "../schema/animation.js";
import type { Deck, Slide } from "../schema/deck.js";
import type { FrameNode } from "../schema/node.js";
import { animationProblem, scheduleSlide } from "../timeline.js";

const tokens = motionTokens(undefined);
const NORMAL = resolveTime("$motion.normal", tokens);
const STAGGER = resolveTime("$motion.stagger", tokens);

const item = (id: string) => element("shape", { shape: "rect" }, { id, height: 100 });
const list = () =>
  frame({
    id: "list",
    layout: { mode: "stack", direction: "column" },
    children: [item("a"), item("b"), item("c")],
  });

function slideWith(animations: Animation[], root = list()): { deck: Deck; slide: Slide } {
  const slide = createSlide({ id: "s", children: [root], animations });
  return { deck: createDeck({ title: "t", slides: [slide] }), slide };
}

/** A column stack of 100 px items: each present item sits below the ones before it. */
const measure: LayoutMeasurer = (absent) => {
  const boxes = new Map<string, { x: number; y: number }>([["list", { x: 0, y: 0 }]]);
  let y = 0;
  for (const id of ["a", "b", "c"]) {
    if (absent.has(id)) continue;
    boxes.set(id, { x: 0, y });
    y += 100;
  }
  return boxes;
};

const fadeOut: Animation = {
  id: "out",
  target: "b",
  duration: 300,
  easing: "linear",
  tracks: { opacity: [{ at: 1, value: 0 }] },
};

describe("layers that take space only while they're there (D120)", () => {
  it("collapses: once its exit ends, the layers below glide up into the gap", () => {
    const { deck, slide } = slideWith([{ ...fadeOut, space: "collapse" }]);
    const compiled = compileSlide(deck, slide, { layout: measure });
    const c = (time: number) => compiled.at({ time, clicks: [1000] }).get("c")?.motion;
    expect(c(1200)).toEqual({}); // b is still fading out: nothing has moved
    expect(c(1300)).toEqual({}); // the gap opens: c starts gliding (0 so far)
    expect(c(1300 + NORMAL / 2)?.y).toBeCloseTo(-50, 0); // $motion.move is symmetric
    expect(c(1300 + NORMAL)).toEqual({ y: -100 });
    expect(c(9999)).toEqual({ y: -100 });
    // b is out of the layout now: hidden, whatever its own animation says.
    expect(compiled.at({ time: 1400, clicks: [1000] }).get("b")?.motion.opacity).toBe(0);
    // The step lasts until the glide ends, so seeking the next step finds it done.
    expect(compiled.steps[1]?.duration).toBe(300 + NORMAL);
  });

  it("makes room: it's out until its click, the others glide aside, then it enters", () => {
    const fadeIn: Animation = {
      id: "in",
      target: "b",
      space: "makeRoom",
      duration: 300,
      easing: "linear",
      tracks: { opacity: [{ at: 0, value: 0 }] },
    };
    const { deck, slide } = slideWith([fadeIn]);
    const compiled = compileSlide(deck, slide, { layout: measure });
    const at = (time: number, clicks: number[] = []) => compiled.at({ time, clicks });
    // Before the click the list is drawn without b: c sits where b would be.
    expect(at(500).get("c")?.motion).toEqual({ y: -100 });
    expect(at(500).get("b")?.motion.opacity).toBe(0);
    // On the click c glides back down, while b waits hidden in its place (no overlap)…
    expect(at(1000 + NORMAL / 2, [1000]).get("c")?.motion.y).toBeCloseTo(-50, 0);
    expect(at(1000 + NORMAL / 2, [1000]).get("b")?.motion.opacity).toBe(0);
    expect(at(1000 + NORMAL, [1000]).get("c")?.motion).toEqual({});
    // …then fades in, once the room is open.
    expect(at(1000 + NORMAL + 150, [1000]).get("b")?.motion.opacity).toBeCloseTo(0.5);
    expect(compiled.steps[1]?.duration).toBe(NORMAL + 300);
  });

  it("adds layout's offset to a layer's own motion, and tells the compositor how long", () => {
    const shake: Animation = {
      id: "shake",
      target: "c",
      trigger: "withPrevious",
      duration: 2000,
      easing: "linear",
      tracks: { x: [{ at: 0, value: 50 }] },
    };
    const { deck, slide } = slideWith([{ ...fadeOut, space: "collapse" }, shake]);
    const compiled = compileSlide(deck, slide, { layout: measure });
    const c = compiled.at({ time: 1300 + NORMAL, clicks: [1000] }).get("c")?.motion;
    expect(c?.y).toBe(-100);
    expect(c?.x).toBeCloseTo(50 * (1 - (300 + NORMAL) / 2000));
    expect(compiled.activity([1000]).get("c")?.motion?.until).toBe(3000);
    const plan = planMotion(compiled, { time: 1000, clicks: [1000] }).get("a");
    expect(plan).toBeUndefined(); // a never moves: nothing to plan
  });

  it("keeps play order when a click comes before an earlier step's change", () => {
    const slow: Animation = { ...fadeOut, duration: 5000, space: "collapse" };
    const next: Animation = { ...fadeOut, id: "out-c", target: "c", space: "collapse" };
    const { deck, slide } = slideWith([slow, next]);
    const compiled = compileSlide(deck, slide, { layout: measure });
    // Click 2 at 2000, while b still fades: c's exit ends at 2300, but b leaves first (6000).
    const clicks = [1000, 2000];
    expect(compiled.at({ time: 3000, clicks }).get("c")?.motion.opacity).toBe(0);
    expect(compiled.at({ time: 3000, clicks }).get("b")?.motion.opacity).toBeGreaterThan(0);
  });

  it("without a measurer, layers still go out and come back, but nothing glides", () => {
    const { deck, slide } = slideWith([{ ...fadeOut, space: "collapse" }]);
    const compiled = compileSlide(deck, slide);
    expect(compiled.at({ time: 2000, clicks: [1000] }).get("b")?.motion.opacity).toBe(0);
    expect(compiled.at({ time: 2000, clicks: [1000] }).get("c")).toBeUndefined();
  });

  it("is checked: only layers the layout places take space, and collapses must end", () => {
    const free = createSlide({
      id: "f",
      layout: { mode: "absolute" },
      children: [item("x")],
    });
    const problem = animationProblem(free, { ...fadeOut, target: "x", space: "collapse" });
    expect([problem?.path, problem?.hint]).toEqual([
      "space",
      'Only layers in a stack or grid (not free ones) take space. Remove "space", or put the layer in a stack.',
    ]);
    const { slide } = slideWith([]);
    expect(animationProblem(slide, { ...fadeOut, space: "collapse" })).toBeNull();
    const forever = AnimationSchema.safeParse({ ...fadeOut, space: "collapse", repeat: "forever" });
    expect(forever.error?.issues[0]?.message).toContain('"collapse" would never happen');
    const both = AnimationSchema.safeParse({ ...fadeOut, space: "makeRoom", stagger: {} });
    expect(both.success).toBe(false);
  });
});

describe("staggering a frame's children in reading order (D120)", () => {
  const cascade: Animation = {
    id: "cascade",
    target: "list",
    trigger: "withPrevious",
    duration: 200,
    easing: "linear",
    stagger: {},
    tracks: { opacity: [{ at: 0, value: 0 }] },
  };

  it("plays on each child in turn, $motion.stagger apart; the frame itself stays still", () => {
    const { deck, slide } = slideWith([cascade]);
    const compiled = compileSlide(deck, slide);
    expect(compiled.layers).toEqual(["a", "b", "c"]);
    const opacity = (id: string, time: number) =>
      compiled.at({ time, clicks: [] }).get(id)?.motion.opacity;
    expect(
      [0, STAGGER, 2 * STAGGER].map((t, i) => opacity(["a", "b", "c"][i] as string, t + 100)),
    ).toEqual([0.5, 0.5, 0.5]);
    expect(opacity("c", STAGGER)).toBe(0); // not started yet: holds its first keyframe
    // The animation lasts until the last child's play ends: what comes after it waits.
    expect(scheduleSlide(slide, tokens)[0]?.duration).toBe(2 * STAGGER + 200);
  });

  it("starts from the end, the middle or a seeded shuffle, the same every time", () => {
    const starts = (from: NonNullable<Animation["stagger"]>["from"]) => {
      const { deck, slide } = slideWith([{ ...cascade, stagger: { from, each: 100 } }]);
      const compiled = compileSlide(deck, slide);
      return ["a", "b", "c"].map((id) =>
        [0, 100, 200].find(
          (t) => (compiled.at({ time: t + 1, clicks: [] }).get(id)?.motion.opacity ?? 0) > 0,
        ),
      );
    };
    expect(starts("end")).toEqual([200, 100, 0]);
    expect(starts("center")).toEqual([100, 0, 100]);
    expect(starts("random")).toEqual(starts("random"));
    expect([...starts("random")].sort()).toEqual([0, 100, 200]);
  });

  it("reads a free frame top to bottom, then left to right", () => {
    const at = (id: string, x: number, y: number) =>
      element("shape", {}, { id, position: { x, y } });
    const free = frame({
      id: "free",
      layout: { mode: "absolute" },
      children: [at("low", 0, 500), at("right", 900, 0), at("left", 0, 0)],
    }) as FrameNode;
    expect(readingOrder(free).map((n) => n.id)).toEqual(["left", "right", "low"]);
  });

  it("needs a frame with children", () => {
    const { slide } = slideWith([]);
    const problem = animationProblem(slide, { ...cascade, target: "a" });
    expect([problem?.path, problem?.message]).toEqual([
      "stagger",
      'Animation "cascade": "a" has no children to play on one by one',
    ]);
  });
});
