import { createDeck } from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  CanvasPlayback,
  END_HOLD_MS,
  type PlaybackPlayer,
  type PlaybackTimers,
  STEP_GAP_MS,
} from "./canvas-playback.js";

/** A player whose slide has steps of these durations, and timers run by hand. */
function setup(durations: number[]) {
  const calls: string[] = [];
  const player: PlaybackPlayer = {
    steps: durations.map((duration) => ({ duration })),
    load: () => calls.push("load"),
    play: () => calls.push("play"),
    next: () => {
      calls.push("next");
      return true;
    },
    unload: () => calls.push("unload"),
  };
  const pending: Array<{ callback: () => void; ms: number }> = [];
  const timers: PlaybackTimers = {
    set: (callback, ms) => pending.push({ callback, ms }),
    clear: () => pending.splice(0),
  };
  const modes: Array<string | null> = [];
  const playback = new CanvasPlayback(player, (m) => modes.push(m), timers);
  /** Runs the next timer, returning how long it waited. */
  const tick = () => {
    const next = pending.shift();
    next?.callback();
    return next?.ms;
  };
  return { playback, calls, modes, tick, pending };
}

const deck = createDeck({ title: "t", slides: [] });

describe("playing on the canvas (D118)", () => {
  it("plays the whole slide, clicking for you after each step, then goes back to rest", () => {
    const { playback, calls, modes, tick } = setup([300, 500]);
    playback.start({ deck, slideId: "s", mode: "slide" });
    expect(calls).toEqual(["load", "play"]);
    expect(tick()).toBe(300 + STEP_GAP_MS);
    expect(calls.at(-1)).toBe("next");
    expect(tick()).toBe(500 + END_HOLD_MS);
    expect(calls.at(-1)).toBe("unload");
    expect(modes).toEqual(["slide", null]);
  });

  it("clicks at once when nothing plays as the slide appears", () => {
    const { playback, tick } = setup([0, 400]);
    playback.start({ deck, slideId: "s", mode: "slide" });
    expect(tick()).toBe(0);
  });

  it("loops a preview until it's stopped", () => {
    const { playback, calls, tick, pending, modes } = setup([400]);
    playback.start({ deck, slideId: "s", mode: "loop" });
    tick();
    tick();
    expect(calls).toEqual(["load", "play", "load", "play", "load", "play"]);
    playback.stop();
    expect(calls.at(-1)).toBe("unload");
    expect(pending).toEqual([]);
    expect(modes).toEqual(["loop", null]);
    playback.stop(); // already at rest: nothing more
    expect(calls.filter((c) => c === "unload")).toHaveLength(1);
  });

  it("replaces what's playing when asked for something else", () => {
    const { playback, calls, pending, modes } = setup([400]);
    playback.start({ deck, slideId: "s", mode: "loop" });
    playback.start({ deck, slideId: "s", mode: "once" });
    expect(pending).toHaveLength(1);
    expect(calls).toEqual(["load", "play", "load", "play"]);
    expect(modes).toEqual(["loop", "once"]);
  });

  it("previews a transition on the canvas's overlay, holds it landed, then goes back (D123)", async () => {
    const calls: string[] = [];
    const pending: Array<() => void> = [];
    let arrive = () => {};
    const player: PlaybackPlayer = {
      steps: [],
      load: () => calls.push("load"),
      play: () => calls.push("play"),
      next: () => false,
      unload: () => calls.push("unload"),
    };
    const playback = new CanvasPlayback(
      player,
      () => {},
      { set: (callback) => pending.push(callback), clear: () => pending.splice(0) },
      {
        play: (_deck, id) => {
          calls.push(`transition ${id}`);
          return new Promise<void>((r) => (arrive = r));
        },
        stop: () => calls.push("stop transition"),
      },
    );
    playback.start({ deck, slideId: "s", mode: "transition" });
    expect(calls).toEqual(["stop transition", "transition s"]); // the slide's own player idles
    arrive();
    await Promise.resolve();
    pending.shift()?.(); // the beat it holds, landed
    expect(calls.slice(-2)).toEqual(["stop transition", "unload"]);
    expect(playback.mode).toBeNull();
  });
});
