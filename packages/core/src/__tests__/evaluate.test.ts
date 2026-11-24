import { describe, expect, it } from "vitest";
import { createDeck, createSlide, element, frame } from "../builders.js";
import { springEasing } from "../easing.js";
import { compileSlide, type EffectResolver, type PlayPosition, seekPosition } from "../evaluate.js";
import type { Animation } from "../schema/animation.js";
import type { Deck, Slide } from "../schema/deck.js";
import { resolveColor } from "../tokens.js";

const box = (id: string, props: Record<string, unknown> = {}) =>
  element("shape", { shape: "rect", fill: "#000000", ...props }, { id, width: 100, height: 100 });
const card = (id: string) => frame({ id, style: { fill: "#ffffff", radius: "$radius.md" } });

/** A one-slide deck; animations default to linear and 1000 ms so the numbers stay plain. */
function setup(animations: Partial<Animation>[], deckFields: Partial<Deck> = {}) {
  const slide: Slide = createSlide({
    id: "s",
    children: [box("a"), box("b"), card("c")],
    animations: animations.map((a, i) => ({
      id: `an${i}`,
      target: "a",
      duration: 1000,
      easing: "linear",
      ...a,
    })) as Animation[],
  });
  const deck = { ...createDeck({ title: "t", slides: [slide] }), ...deckFields };
  return { deck, slide };
}

const at = (animations: Partial<Animation>[], position: PlayPosition) => {
  const { deck, slide } = setup(animations);
  return compileSlide(deck, slide).at(position);
};
const opacityOf = (animations: Partial<Animation>[], time: number, clicks: number[] = []) =>
  at(animations, { time, clicks }).get("a")?.motion.opacity;

const fadeIn = { tracks: { opacity: [{ at: 0, value: 0 }] } };

describe("the timeline evaluator (D114)", () => {
  it("plays a track from its keyframe to the layer's own value, then holds", () => {
    const anims: Partial<Animation>[] = [{ ...fadeIn, trigger: "withPrevious" as const }];
    expect(opacityOf(anims, 0)).toBe(0);
    expect(opacityOf(anims, 250)).toBe(0.25);
    expect(opacityOf(anims, 1000)).toBe(1);
    expect(opacityOf(anims, 60_000)).toBe(1);
  });

  it("holds an animation's start until its click: an entrance stays hidden", () => {
    const anims: Partial<Animation>[] = [fadeIn]; // onClick: step 1
    expect(opacityOf(anims, 5000)).toBe(0); // no click yet
    expect(opacityOf(anims, 1500, [1000])).toBe(0.5);
    // A presenter who waited 9 s before clicking sees the same animation, just later.
    expect(opacityOf(anims, 9500, [9000])).toBe(0.5);
  });

  it("shows the animation that started last on each channel, others keep theirs", () => {
    const anims: Partial<Animation>[] = [
      { ...fadeIn, trigger: "withPrevious" as const },
      { tracks: { x: [{ at: 0, value: -100 }] }, trigger: "withPrevious" as const },
      { tracks: { opacity: [{ at: 1, value: 0 }] } }, // exit, on the first click
    ];
    const frame = (time: number, clicks: number[] = []) => at(anims, { time, clicks }).get("a");
    expect(frame(0)?.motion).toEqual({ opacity: 0, x: -100 });
    expect(frame(1000)?.motion).toEqual({ opacity: 1, x: 0 });
    expect(frame(2500, [2000])?.motion).toEqual({ opacity: 0.5, x: 0 });
    expect(frame(4000, [2000])?.motion).toEqual({ opacity: 0, x: 0 });
    // A click before the entrance ended: the exit takes over from its own start.
    expect(frame(600, [500])?.motion.opacity).toBe(0.9);
  });

  it("lists only animated layers, each with only what its animations set", () => {
    const result = at([{ ...fadeIn, trigger: "withPrevious" }], { time: 0, clicks: [] });
    expect([...result.keys()]).toEqual(["a"]);
    expect(result.get("a")).toEqual({ motion: { opacity: 0 }, properties: {} });
  });

  it("follows triggers, delays and the schedule's step starts", () => {
    const anims: Partial<Animation>[] = [
      { ...fadeIn, trigger: "withPrevious" as const },
      { ...fadeIn, target: "b", trigger: "afterPrevious" as const, delay: 200 },
    ];
    const b = (time: number) => at(anims, { time, clicks: [] }).get("b")?.motion.opacity;
    expect(b(1100)).toBe(0); // starts at 1000 + 200
    expect(b(1700)).toBe(0.5);
  });

  it("repeats, alternates and loops forever", () => {
    const pulse = { tracks: { scale: [{ at: 1, value: 2 }] }, trigger: "withPrevious" as const };
    const scale = (extra: Partial<Animation>, time: number) =>
      at([{ ...pulse, ...extra }], { time, clicks: [] }).get("a")?.motion.scale;
    expect(scale({ repeat: 3 }, 2250)).toBe(1.25); // a quarter into the third play
    expect(scale({ repeat: 3 }, 9999)).toBe(2);
    expect(scale({ repeat: 2, alternate: true }, 1250)).toBe(1.75); // on its way back
    expect(scale({ repeat: 2, alternate: true }, 9999)).toBe(1); // back where it began
    expect(scale({ repeat: "forever" }, 10_250)).toBe(1.25);
    expect(scale({ repeat: "forever", alternate: true }, 11_250)).toBe(1.75);
  });

  it("eases each stretch between keyframes, a keyframe's own easing winning", () => {
    const anims: Partial<Animation>[] = [
      {
        trigger: "withPrevious" as const,
        easing: { spring: { bounce: 0.5 } },
        tracks: {
          x: [
            { at: 0, value: 0 },
            { at: 0.5, value: 100, easing: "linear" as const },
            { at: 1, value: 300 },
          ],
        },
      },
    ];
    const x = (time: number) => at(anims, { time, clicks: [] }).get("a")?.motion.x;
    expect(x(250)).toBeCloseTo(100 * springEasing(0.5)(0.5), 9); // the spring
    expect(x(750)).toBe(200); // linear, from the keyframe at 0.5
    expect(x(500)).toBe(100);
  });

  it("lets motion overshoot but keeps a property inside the values it was given", () => {
    const spring = { spring: { bounce: 1 } } as const;
    const peak = (anims: Partial<Animation>[], read: (f: ReturnType<typeof at>) => unknown) =>
      Math.max(
        ...Array.from({ length: 101 }, (_, i) =>
          Number(read(at(anims, { time: i * 10, clicks: [] }))),
        ),
      );
    const go = (tracks: Animation["tracks"]) => [
      { trigger: "withPrevious" as const, easing: spring, tracks },
    ];
    expect(peak(go({ x: [{ at: 0, value: -100 }] }), (f) => f.get("a")?.motion.x)).toBeGreaterThan(
      10,
    );
    expect(
      peak(
        go({
          "props.cornerRadius": [
            { at: 0, value: 0 },
            { at: 1, value: 40 },
          ],
        }),
        (f) => f.get("a")?.properties["props.cornerRadius"],
      ),
    ).toBe(40);
  });

  it("blends colors from tokens and the layer's own, and writes hex", () => {
    const { deck } = setup([]);
    const accent = resolveColor(deck.theme, "$color.accent");
    const anims: Partial<Animation>[] = [
      {
        trigger: "withPrevious" as const,
        tracks: { "props.fill": [{ at: 0, value: "$color.accent" }] },
      },
      {
        target: "c",
        trigger: "withPrevious" as const,
        tracks: {
          "style.fill": [{ at: 1, value: "transparent" }],
          "style.radius": [{ at: 1, value: 0 }],
        },
      },
    ];
    const frame = (time: number) => at(anims, { time, clicks: [] });
    expect(frame(0).get("a")?.properties["props.fill"]).toBe(accent);
    expect(frame(1000).get("a")?.properties["props.fill"]).toBe("#000000"); // its own fill
    expect(frame(500).get("a")?.properties["props.fill"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(frame(500).get("c")?.properties["style.fill"]).toBe("#ffffff80");
    // "$radius.md" resolves through the theme, so the radius animates as a number.
    const md = deck.theme.radius.md ?? 0;
    expect(frame(500).get("c")?.properties["style.radius"]).toBe(md / 2);
  });

  it("switches values that can't blend halfway, as CSS does", () => {
    const anims: Partial<Animation>[] = [
      {
        trigger: "withPrevious" as const,
        tracks: { "props.shape": [{ at: 1, value: "ellipse" }] },
      },
    ];
    const shape = (time: number) =>
      at(anims, { time, clicks: [] }).get("a")?.properties["props.shape"];
    expect(shape(499)).toBe("rect");
    expect(shape(500)).toBe("ellipse");
  });

  it("times `$motion` tokens by the slide's level, and gives an unset property its keyframe", () => {
    const anims: Partial<Animation>[] = [
      {
        trigger: "withPrevious" as const,
        duration: "$motion.normal" as const,
        tracks: { opacity: [{ at: 0, value: 0 }], "props.missing": [{ at: 0, value: 5 }] },
      },
    ];
    const ends = (level: Deck["motionLevel"]) => {
      const { deck, slide } = setup(anims, { motionLevel: level });
      return compileSlide(deck, slide).steps[0]?.duration;
    };
    expect([ends("calm"), ends("subtle"), ends("absurd")]).toEqual([500, 400, 280]);
    expect(at(anims, { time: 200, clicks: [] }).get("a")?.properties["props.missing"]).toBe(5);
  });

  it("plays an effect through its resolver, with the effect's own duration", () => {
    const anims: Partial<Animation>[] = [
      { trigger: "withPrevious" as const, effect: { name: "fade-in" }, duration: undefined },
    ];
    const { deck, slide } = setup(anims);
    const effects: EffectResolver = (effect) =>
      effect.name === "fade-in"
        ? { tracks: { opacity: [{ at: 0, value: 0 }] }, duration: 300, easing: "linear" }
        : null;
    const played = compileSlide(deck, slide, { effects });
    expect(played.steps[0]?.duration).toBe(300);
    expect(played.at({ time: 150, clicks: [] }).get("a")?.motion.opacity).toBe(0.5);
    // Without presets (or for an unknown name) it moves nothing, but keeps its place in time.
    const bare = compileSlide(deck, slide);
    expect(bare.at({ time: 150, clicks: [] }).size).toBe(0);
    expect(bare.steps[0]?.duration).toBe(400);
  });

  it("seeks a step as if every step before it played to its end", () => {
    const anims: Partial<Animation>[] = [
      { ...fadeIn, trigger: "withPrevious" as const },
      { tracks: { x: [{ at: 0, value: -100 }] } },
      { tracks: { y: [{ at: 0, value: -100 }] }, delay: 500 },
    ];
    const { deck, slide } = setup(anims);
    const played = compileSlide(deck, slide);
    expect(seekPosition(played.steps, 2, 250)).toEqual({ time: 2250, clicks: [1000, 2000] });
    expect(played.seek(2, 1000)).toEqual(played.at({ time: 3000, clicks: [1000, 2000] }));
    expect(played.seek(2, 1000).get("a")?.motion).toEqual({ opacity: 1, x: 0, y: -50 });
    expect(seekPosition(played.steps, 99, 0).clicks).toHaveLength(2); // clamped to the last step
  });

  it("is deterministic: the same moment gives the same frame, whatever came before", () => {
    const anims: Partial<Animation>[] = [
      { ...fadeIn, trigger: "withPrevious" as const, easing: { spring: { bounce: 0.4 } } },
      { tracks: { rotate: [{ at: 0.5, value: 30 }] }, repeat: "forever" as const },
    ];
    const { deck, slide } = setup(anims);
    const one = compileSlide(deck, slide);
    const two = compileSlide(structuredClone(deck), structuredClone(slide));
    const moment = { time: 4321, clicks: [1234] };
    const first = one.at(moment);
    for (let t = 0; t < 5000; t += 97) one.at({ time: t, clicks: [1234] }); // scrub around
    expect(one.at(moment)).toEqual(first);
    expect(two.at(moment)).toEqual(first);
  });
});
