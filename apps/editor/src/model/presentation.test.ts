import {
  type Animation,
  createDeck,
  createSlide,
  type Deck,
  element,
  type PlayPosition,
  type Step,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  Presentation,
  type PresentationPlayer,
  presentedSlides,
  startIndex,
} from "./presentation.js";

/** A slide with `steps` steps: one animation on load, then one per click. */
function slide(id: string, steps: number, hidden = false) {
  const animations = Array.from({ length: steps }, (_, i) => ({
    id: `${id}-an${i}`,
    target: `${id}-box`,
    trigger: i === 0 ? "withPrevious" : "onClick",
    duration: 500,
    tracks: { x: [{ at: 0, value: -100 }] },
  })) as Animation[];
  return createSlide({
    id,
    ...(hidden && { hidden }),
    children: [element("shape", { shape: "rect" }, { id: `${id}-box` })],
    animations,
  });
}

/** Plays like `SlidePlayer`: steps of 500 ms, clicks append. Logs what it was asked. */
function fakePlayer(deck: Deck) {
  const log: string[] = [];
  let slideId = "";
  let position: PlayPosition = { time: 0, clicks: [] };
  const player: PresentationPlayer = {
    load: (_deck, id) => {
      slideId = id;
      position = { time: 0, clicks: [] };
      log.push(`load ${id}`);
    },
    play: (from = position) => {
      position = from;
      log.push(`play ${slideId} @${from.time} clicks ${from.clicks.length}`);
    },
    next: () => {
      if (position.clicks.length >= player.steps.length - 1) return false;
      position = { time: position.time, clicks: [...position.clicks, position.time] };
      log.push(`click ${slideId}`);
      return true;
    },
    get steps(): Step[] {
      const s = deck.slides.find((x) => x.id === slideId);
      const n = Math.max(1, s?.animations?.length ?? 0);
      return Array.from({ length: n }, () => ({ duration: 500 }) as Step);
    },
    get position() {
      return position;
    },
  };
  return { player, log };
}

const deck = createDeck({
  title: "t",
  slides: [slide("a", 2), slide("hidden", 1, true), slide("b", 1), slide("c", 3)],
});

describe("presenting (D116)", () => {
  it("skips hidden slides, and starts at the next shown one", () => {
    expect(presentedSlides(deck).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(startIndex(deck, null)).toBe(0);
    expect(startIndex(deck, "b")).toBe(1);
    expect(startIndex(deck, "hidden")).toBe(1); // b comes next
    expect(startIndex(deck, "gone")).toBe(0);
  });

  it("clicks through each slide's steps, then on to the next slide, then the end", async () => {
    const { player, log } = fakePlayer(deck);
    const show = new Presentation(deck, player);
    await show.start();
    expect(await show.next()).toBe(true); // a's step 1
    expect(await show.next()).toBe(true); // b
    expect(show.state).toEqual({ index: 1, ended: false });
    await show.next(); // c
    await show.next(); // c's step 1
    await show.next(); // c's step 2
    expect(await show.next()).toBe(true); // the end screen
    expect(show.state.ended).toBe(true);
    expect(await show.next()).toBe(false); // out
    expect(log).toEqual([
      "load a",
      "play a @0 clicks 0",
      "click a",
      "load b",
      "play b @0 clicks 0",
      "load c",
      "play c @0 clicks 0",
      "click c",
      "click c",
    ]);
  });

  it("goes back a step played out, and to the previous slide fully built", async () => {
    const { player, log } = fakePlayer(deck);
    const show = new Presentation(deck, player);
    await show.start(2); // c
    await show.next();
    await show.next(); // c at step 2
    log.length = 0;
    await show.previous(); // step 1, played out: its clicks, at its end
    expect(log).toEqual(["play c @1000 clicks 1"]);
    await show.previous();
    await show.previous(); // from step 0: b, fully built
    expect(log.slice(-2)).toEqual(["load b", "play b @500 clicks 0"]);
    expect(show.state.index).toBe(1);
    await show.first();
    await show.previous(); // nothing before the first slide
    expect(show.state.index).toBe(0);
    await show.last();
    expect(log.slice(-2)).toEqual(["load c", "play c @1500 clicks 2"]);
  });

  it("waits for a slide to load before playing it, and queues clicks meanwhile", async () => {
    const { player, log } = fakePlayer(deck);
    let release = () => {};
    const show = new Presentation(deck, player, {
      ready: () => new Promise<void>((r) => (release = r)),
    });
    const started = show.start();
    const click = show.next(); // before a has loaded
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["load a"]); // nothing plays on a half-loaded slide
    release();
    await started;
    await click;
    expect(log).toEqual(["load a", "play a @0 clicks 0", "click a"]); // the click wasn't lost
  });

  it("plays the transition moving on, cuts going back, and a click lands it at once (D123)", async () => {
    const { player, log } = fakePlayer(deck);
    let arrive = () => {};
    player.transition = (_deck, id) => {
      log.push(`transition ${id}`);
      player.load(deck, id);
      log.pop(); // the transition loads it: logged as the transition alone
      return new Promise<void>((r) => (arrive = r));
    };
    player.finishTransition = () => {
      log.push("finish");
      arrive();
    };
    const show = new Presentation(deck, player);
    await show.start(1); // b: one step
    log.length = 0;
    const moving = show.next(); // on to c, with its transition
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["finish", "transition c"]); // not played until it has arrived
    expect(show.state.index).toBe(2);
    const click = show.next(); // impatient: lands the transition, then c's next step
    await moving;
    await click;
    expect(log).toEqual(["finish", "transition c", "finish", "play c @0 clicks 0", "click c"]);
    log.length = 0;
    await show.previous();
    await show.previous(); // back to b: a cut
    expect(log.slice(-2)).toEqual(["load b", "play b @500 clicks 0"]);
  });
});
