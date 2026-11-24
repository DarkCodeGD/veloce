import { describe, expect, it } from "vitest";
import { createDeck, createSlide, element, frame } from "../builders.js";
import { compileSlide, MAX_LOOP_PERIOD, motionOf, withProperties } from "../evaluate.js";
import { type MotionState, resolveMotion } from "../motion.js";
import { type MotionClip, planMotion } from "../motion-plan.js";
import type { Animation } from "../schema/animation.js";
import type { Slide } from "../schema/deck.js";

const box = (id: string) =>
  element("shape", { shape: "rect", fill: "#000000" }, { id, width: 100, height: 100 });

function compile(animations: Partial<Animation>[]) {
  const slide: Slide = createSlide({
    id: "s",
    children: [box("a"), box("b"), frame({ id: "c", style: { fill: "#ffffff" } })],
    animations: animations.map((a, i) => ({
      id: `an${i}`,
      target: "a",
      duration: 1000,
      ...a,
    })) as Animation[],
  });
  return { slide, compiled: compileSlide(createDeck({ title: "t", slides: [slide] }), slide) };
}

/** Where the compositor draws a clip at `time`: a straight line between its keyframes. */
function clipAt(clip: MotionClip, time: number): Required<MotionState> {
  const i = Math.max(0, clip.times.findIndex((t) => t > time) - 1);
  const [t0, t1] = [clip.times[i] ?? 0, clip.times[i + 1] ?? 0];
  const [a, b] = [resolveMotion(clip.states[i]), resolveMotion(clip.states[i + 1])];
  const k = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
  const out = { ...a };
  for (const c of Object.keys(a) as (keyof MotionState)[]) out[c] = a[c] + (b[c] - a[c]) * k;
  return out;
}

describe("layer activity (D115)", () => {
  it("says when each layer stops changing, from the clicks so far", () => {
    const { compiled } = compile([
      { trigger: "withPrevious", tracks: { x: [{ at: 0, value: -100 }] } },
      {
        target: "c",
        trigger: "withPrevious",
        tracks: { "style.fill": [{ at: 0, value: "#ff0000" }] },
      },
      { target: "b", tracks: { opacity: [{ at: 0, value: 0 }] }, delay: 200 },
    ]);
    const before = compiled.activity([]);
    expect(before.get("a")).toEqual({ motion: { until: 1000, period: null }, properties: null });
    expect(before.get("b")).toEqual({ motion: null, properties: null }); // waits for a click
    expect(before.get("c")?.properties).toEqual({ until: 1000, period: null });
    expect(compiled.activity([3000]).get("b")?.motion).toEqual({ until: 4200, period: null });
  });

  it("finds the period loops share, and gives up on ones that never line up", () => {
    const loop = (duration: number, alternate = false): Partial<Animation> => ({
      trigger: "withPrevious",
      duration,
      alternate,
      repeat: "forever",
      tracks: { scale: [{ at: 0.5, value: 1.2 }] },
    });
    const period = (anims: Partial<Animation>[]) =>
      compile(anims).compiled.activity([]).get("a")?.motion?.period;
    expect(period([loop(400)])).toBe(400);
    expect(period([loop(400, true)])).toBe(800); // there and back
    expect(period([loop(400), { ...loop(600), tracks: { x: [{ at: 0.5, value: 9 }] } }])).toBe(
      1200,
    );
    expect(period([loop(7001), { ...loop(9001), tracks: { x: [{ at: 0.5, value: 9 }] } }])).toBe(
      Number.POSITIVE_INFINITY, // 63 s apart: more than MAX_LOOP_PERIOD
    );
    expect(MAX_LOOP_PERIOD).toBe(60_000);
    expect(period([loop(400.5), { ...loop(400), tracks: { x: [{ at: 0.5, value: 9 }] } }])).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("a frame's parts (D115)", () => {
  it("evaluates one layer exactly as the whole frame does", () => {
    const { compiled } = compile([
      {
        trigger: "withPrevious",
        tracks: { x: [{ at: 0, value: -100 }], "props.fill": [{ at: 0, value: "#ffffff" }] },
      },
    ]);
    const moment = { time: 300, clicks: [] };
    expect(compiled.layerAt("a", moment)).toEqual(compiled.at(moment).get("a"));
    expect(compiled.layerAt("b", moment)).toBeUndefined();
    expect(compiled.layers).toEqual(["a"]);
    expect(motionOf(compiled.at(moment))).toEqual(
      new Map([["a", compiled.layerAt("a", moment)?.motion]]),
    );
  });

  it("writes animated properties into the slide, sharing everything else", () => {
    const { slide, compiled } = compile([
      { trigger: "withPrevious", tracks: { "props.fill": [{ at: 0, value: "#ffffff" }] } },
      { target: "c", trigger: "withPrevious", tracks: { "style.radius": [{ at: 0, value: 40 }] } },
    ]);
    const patched = withProperties(slide, compiled.at({ time: 0, clicks: [] }));
    const [a, b, c] = patched.root.children;
    expect(a?.kind === "element" && a.props.fill).toBe("#ffffff");
    expect(c?.kind === "frame" && c.style).toEqual({ fill: "#ffffff", radius: 40 });
    expect(b).toBe(slide.root.children[1]); // untouched: the same object
    expect(slide.root.children[0]).toEqual(box("a")); // the document itself never changes
    // A frame with only motion leaves the slide as it is.
    const still = compile([{ trigger: "withPrevious", tracks: { x: [{ at: 0, value: 5 }] } }]);
    expect(withProperties(still.slide, still.compiled.at({ time: 0, clicks: [] }))).toBe(
      still.slide,
    );
  });
});

describe("planning motion for the compositor (D115)", () => {
  const springy: Partial<Animation>[] = [
    {
      trigger: "withPrevious",
      easing: { spring: { bounce: 0.6 } },
      tracks: {
        x: [{ at: 0, value: -400 }],
        rotate: [{ at: 0, value: -90 }],
        opacity: [{ at: 0, value: 0 }],
      },
    },
    {
      trigger: "withPrevious",
      delay: 1200,
      duration: 700,
      repeat: "forever",
      alternate: true,
      easing: "ease-in-out",
      tracks: { scale: [{ at: 1, value: 1.3 }], blur: [{ at: 1, value: 6 }] },
    },
  ];

  it("plays to where motion stops, then loops; the straight lines stay on the curve", () => {
    const { compiled } = compile(springy);
    const plan = planMotion(compiled, { time: 0, clicks: [] });
    const clips = plan.get("a");
    if (!clips || clips === "clock") throw new Error("expected clips");
    const [once, loop] = clips;
    if (!once || !loop) throw new Error("expected two clips");
    expect([once.start, once.times.at(-1), once.loop]).toEqual([0, 1200, false]);
    expect([loop.start, loop.times.at(-1), loop.loop]).toEqual([1200, 2600, true]);
    expect(loop.states.at(-1)).toEqual(loop.states[0]); // no seam where it repeats
    // Anywhere, not just at keyframes, the compositor's line is within what nobody can see.
    for (const clip of [once, loop]) {
      const end = clip.times.at(-1) ?? 0;
      for (let t = clip.start; t <= end; t += 1.7) {
        const truth = resolveMotion(compiled.layerAt("a", { time: t, clicks: [] })?.motion);
        const drawn = clipAt(clip, t);
        expect(Math.abs(drawn.x - truth.x), `x at ${t}`).toBeLessThan(0.5);
        expect(Math.abs(drawn.rotate - truth.rotate), `rotate at ${t}`).toBeLessThan(0.25);
        expect(Math.abs(drawn.opacity - truth.opacity), `opacity at ${t}`).toBeLessThan(2 / 255);
        expect(Math.abs(drawn.scale - truth.scale), `scale at ${t}`).toBeLessThan(0.001);
      }
    }
    // Keyframes go where the curve needs them: far fewer than one per 60 Hz frame on the
    // calm loop, more on the spring.
    expect(loop.times.length).toBeLessThan(1400 / 16.7);
    const density = (c: MotionClip) => c.times.length / ((c.times.at(-1) ?? 0) - c.start);
    expect(density(once)).toBeGreaterThan(density(loop));
  });

  it("plans from any moment, holds what won't move, and waits for clicks", () => {
    const { compiled } = compile([
      { trigger: "withPrevious", tracks: { x: [{ at: 0, value: -100 }] } },
      { target: "b", tracks: { y: [{ at: 0, value: 50 }] } },
    ]);
    const start = planMotion(compiled, { time: 0, clicks: [] });
    expect([...start.keys()]).toEqual(["a"]); // b waits for its click
    const later = planMotion(compiled, { time: 5000, clicks: [] });
    expect(later.size).toBe(0); // a has settled: it holds where it is
    const clicked = planMotion(compiled, { time: 5000, clicks: [5000] });
    const clip = (clicked.get("b") as MotionClip[])[0];
    expect([clip?.start, clip?.times.at(-1)]).toEqual([5000, 6000]);
    expect(clip?.states[0]).toEqual({ y: 50 });
  });

  it("leaves loops that never line up to the clock", () => {
    const { compiled } = compile([
      {
        trigger: "withPrevious",
        repeat: "forever",
        duration: 7001,
        tracks: { x: [{ at: 0.5, value: 9 }] },
      },
      {
        trigger: "withPrevious",
        repeat: "forever",
        duration: 9001,
        tracks: { y: [{ at: 0.5, value: 9 }] },
      },
    ]);
    expect(planMotion(compiled, { time: 0, clicks: [] }).get("a")).toBe("clock");
  });
});
