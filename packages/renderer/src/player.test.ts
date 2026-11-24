// @vitest-environment happy-dom
import {
  type Animation,
  createDeck,
  createSlide,
  type Deck,
  element,
  frame,
  type MotionClip,
  type MotionState,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import { motionKeyframes } from "./layout.js";
import { type PlayerTarget, SlidePlayer } from "./slide-player.js";

describe("compositor keyframes (D115)", () => {
  const node = element("shape", { shape: "rect" }, { id: "a", rotation: 10 });

  it("lists the same transform functions on every keyframe, so the browser interpolates numbers", () => {
    const frames = motionKeyframes(node, { mode: "absolute" }, [
      { x: -100 },
      { x: -50, rotate: 180, scale: 1.2 },
      { rotate: 360 },
    ]);
    const names = frames.map((f) => (f.transform ?? "").replace(/\([^)]*\)/g, "()"));
    expect(new Set(names).size).toBe(1);
    expect(frames[0]?.transform).toBe("translate(-100px, 0px) rotate(10deg) scale(1, 1)");
    expect(frames[2]?.transform).toBe("translate(0px, 0px) rotate(370deg) scale(1, 1)");
  });

  it("leaves out what doesn't change, and keeps a centred anchor's shift", () => {
    const centred = element(
      "shape",
      { shape: "rect" },
      { id: "c", anchor: { x: "center" }, opacity: 0.5 },
    );
    const frames = motionKeyframes(centred, { mode: "absolute" }, [{ opacity: 0 }, { opacity: 1 }]);
    expect(frames).toEqual([{ opacity: "0" }, { opacity: "0.5" }]);
    const moved = motionKeyframes(centred, { mode: "absolute" }, [{ y: 10 }, {}]);
    expect(moved[0]).toEqual({ transform: "translate(-50%, 0) translate(0px, 10px)" });
  });

  it("goes 3D whenever depth is involved", () => {
    const deep = element("shape", { shape: "rect" }, { id: "d", depth: -200 });
    const frames = motionKeyframes(deep, null, [{ z: 0 }, { z: 100 }]);
    expect(frames.map((f) => f.transform)).toEqual([
      "translate3d(0px, 0px, -200px)",
      "translate3d(0px, 0px, -100px)",
    ]);
  });
});

/** Records what the player asks the renderer to do. */
function fakeTarget() {
  const calls: string[] = [];
  let motion: ReadonlyMap<string, MotionState> = new Map();
  let deck: Deck | null = null;
  let clips: ReadonlyMap<string, readonly MotionClip[]> = new Map();
  const target: PlayerTarget = {
    render: (d, id) => {
      deck = d;
      calls.push(`render:${id}`);
    },
    setMotion: (m) => {
      motion = m;
    },
    seek: (t) => calls.push(`seek:${t}`),
    playMotion: (c, origin) => {
      clips = c;
      calls.push(`play:${origin}`);
    },
    pauseMotion: (t) => calls.push(`pause:${t}`),
    stopMotion: () => calls.push("stop"),
  };
  return {
    target,
    calls,
    motion: () => motion,
    deck: () => deck,
    clips: () => clips,
  };
}

function deckWith(animations: Partial<Animation>[]): Deck {
  const slide = createSlide({
    id: "s",
    children: [
      element("shape", { shape: "rect", fill: "#000000" }, { id: "a" }),
      frame({ id: "b" }),
    ],
    animations: animations.map((a, i) => ({
      id: `an${i}`,
      target: "a",
      duration: 1000,
      easing: "linear",
      ...a,
    })) as Animation[],
  });
  return createDeck({ title: "t", slides: [slide] });
}

const anims: Partial<Animation>[] = [
  { trigger: "withPrevious", tracks: { opacity: [{ at: 0, value: 0 }] } },
  { tracks: { x: [{ at: 0, value: -100 }], "props.fill": [{ at: 0, value: "#ffffff" }] } },
];

describe("the slide player (D115)", () => {
  it("seeks: motion, animated properties and plugins' seek, all for that moment", () => {
    const fake = fakeTarget();
    const player = new SlidePlayer(fake.target);
    player.load(deckWith(anims), "s");
    expect(fake.motion().get("a")).toEqual({ opacity: 0, x: -100 }); // as the slide appears
    player.seek(1, 500);
    expect(fake.motion().get("a")).toEqual({ opacity: 1, x: -50 });
    const a = fake.deck()?.slides[0]?.root.children[0];
    expect(a?.kind === "element" && a.props.fill).toMatch(/^#[0-9a-f]{6}$/);
    expect(fake.calls.at(-1)).toBe("seek:1.5"); // seconds into the slide, as plugins get it
    expect(player.position).toEqual({ time: 1500, clicks: [1000] });
  });

  it("plays on the compositor from a moment, and a click plans again from there", () => {
    const fake = fakeTarget();
    let now = 10_000;
    const frames: (() => void)[] = [];
    const player = new SlidePlayer(fake.target, {
      now: () => now,
      requestFrame: (cb) => frames.push(cb),
      cancelFrame: () => {},
    });
    player.load(deckWith(anims), "s");
    player.play();
    expect(player.playing).toBe(true);
    expect(fake.calls).toContain("play:10000"); // the slide's time 0 is now
    expect([...fake.clips().keys()]).toEqual(["a"]);
    now += 2500;
    expect(player.position).toEqual({ time: 2500, clicks: [] });
    expect(player.next()).toBe(true);
    expect(player.position.clicks).toEqual([2500]);
    expect(fake.calls).toContain("play:10000"); // same origin: the click is at slide time 2500
    expect(fake.clips().get("a")?.[0]?.start).toBe(2500);
    expect(player.next()).toBe(false); // no step after the last
    // The frame loop redraws the animated fill on the main thread while it changes.
    const renders = fake.calls.filter((c) => c.startsWith("render")).length;
    now += 400;
    frames.at(-1)?.();
    expect(fake.calls.filter((c) => c.startsWith("render")).length).toBe(renders + 1);
  });

  it("pauses at a moment: the compositor holds it, the main thread draws the rest", () => {
    const fake = fakeTarget();
    const player = new SlidePlayer(fake.target, {
      now: () => 0,
      requestFrame: () => 0,
      cancelFrame: () => {},
    });
    player.load(deckWith(anims), "s");
    player.play({ time: 1000, clicks: [1000] });
    const at = player.pause(1250);
    expect(at).toEqual({ time: 1250, clicks: [1000] });
    expect(fake.calls).toContain("pause:1250");
    expect(fake.calls.at(-1)).toBe("seek:1.25");
    expect(player.playing).toBe(false);
  });

  it("unloads back to the slide at rest", () => {
    const fake = fakeTarget();
    const player = new SlidePlayer(fake.target);
    const deck = deckWith(anims);
    player.load(deck, "s");
    player.seek(1, 500);
    player.unload();
    expect(fake.motion().size).toBe(0);
    expect(fake.deck()).toBe(deck); // the document's own slide again, no animated values
  });
});
