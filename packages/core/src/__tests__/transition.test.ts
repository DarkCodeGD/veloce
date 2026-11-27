/**
 * Slide transitions (D123): which one a slide arrives with, both slides at any moment of a
 * fade, push or zoom, and morph's travelling layers (nested ones included).
 */
import { describe, expect, it } from "vitest";
import { createDeck, createSlide, element, frame } from "../builders.js";
import { lintDeck } from "../lint.js";
import { motionTokens, resolveTime } from "../motion-tokens.js";
import { DeckSchema } from "../schema/deck.js";
import { TransitionSchema } from "../schema/motion.js";
import type { Node } from "../schema/node.js";
import { MIDNIGHT_THEME } from "../themes.js";
import {
  type Box,
  compileTransition,
  type MorphPlan,
  morphAt,
  planMorph,
  slidesAt,
  transitionInto,
  transitionTimes,
} from "../transition.js";

const STAGE = { width: 1920, height: 1080 };

describe("which transition a slide arrives with (D123)", () => {
  const deck = createDeck({ title: "t" });

  it("is the slide's own, else the theme's signature, with tokens at the slide's level", () => {
    const own = transitionInto(deck, { transition: { type: "push", direction: "up" } });
    expect(own).toMatchObject({ type: "push", direction: "up", source: "slide" });
    expect(own?.duration).toBe(resolveTime("$motion.slow", motionTokens(deck.theme)));
    const signature = transitionInto({ ...deck, theme: MIDNIGHT_THEME }, {});
    expect(signature).toMatchObject({ type: "zoom", source: "theme" });
    expect(signature?.duration).toBe(resolveTime("$motion.slow", motionTokens(MIDNIGHT_THEME)));
    expect(transitionInto(deck, { transition: { type: "none" } })).toBeNull();
    expect(transitionInto(deck, { transition: { type: "fade", duration: 0 } })).toBeNull();
  });

  it("softens a theme's push or zoom to a fade at calm, never a slide's own choice", () => {
    const calm = { ...deck, theme: MIDNIGHT_THEME, motionLevel: "calm" as const };
    expect(transitionInto(calm, {})?.type).toBe("fade");
    expect(transitionInto(calm, { transition: { type: "zoom" } })?.type).toBe("zoom");
  });

  it("is checked: only push has a direction", () => {
    const bad = TransitionSchema.safeParse({ type: "fade", direction: "left" });
    expect(bad.error?.issues[0]?.message).toContain('Only "push" has a direction');
    const slide = { ...createSlide({ id: "s" }), transition: { type: "morph" as const } };
    expect(DeckSchema.safeParse({ ...deck, slides: [slide] }).success).toBe(true);
  });
});

describe("whole slides: fade, push, zoom (D123)", () => {
  it("fades the arriving slide in over the leaving one", () => {
    const { from, to } = slidesAt({ type: "fade", direction: "left" }, 0.25, STAGE);
    expect([from.opacity, to.opacity]).toEqual([1, 0.25]);
  });

  it("pushes both slides together, the new one in from the far side", () => {
    const left = slidesAt({ type: "push", direction: "left" }, 0.5, STAGE);
    expect([left.from.x, left.to.x]).toEqual([-960, 960]);
    const down = slidesAt({ type: "push", direction: "down" }, 0, STAGE);
    expect([down.from.y, down.to.y]).toEqual([0, -1080]);
  });

  it("zooms the old slide away as the new one settles in", () => {
    const { from, to } = slidesAt({ type: "zoom", direction: "left" }, 1, STAGE);
    expect(from).toMatchObject({ scale: 1.12, opacity: 0 });
    expect(to).toMatchObject({ scale: 1, opacity: 1 });
  });

  it("is seekable: the same moment gives the same frame, eased, held after the end", () => {
    const t = transitionInto(createDeck({ title: "t" }), {
      transition: { type: "push", duration: 1000, easing: "linear" },
    });
    if (!t) throw new Error("no transition");
    const compiled = compileTransition(t, STAGE);
    expect(compiled.at(500)).toEqual(compiled.at(500));
    expect(compiled.at(500).to.x).toBe(960);
    expect(compiled.at(5000).to.x).toBe(0);
    expect(transitionTimes(100, 50)).toEqual([0, 50, 100]);
  });
});

describe("morph (D123)", () => {
  const box = (x: number, y: number, width = 100, height = 100): Box => ({ x, y, width, height });
  const shape = (id: string, matchKey?: string, fill = "#f00"): Node =>
    element("shape", { shape: "rect", fill }, { id, ...(matchKey && { matchKey }) });

  function plan(
    fromChildren: Node[],
    toChildren: Node[],
    boxes: Record<string, Box>,
    moving?: Set<string>,
  ) {
    const from = createSlide({ id: "a", layout: { mode: "absolute" }, children: fromChildren });
    const to = createSlide({ id: "b", layout: { mode: "absolute" }, children: toChildren });
    const all = new Map(Object.entries(boxes));
    return planMorph({ from, to, boxes: { from: all, to: all }, moving: { to: moving } });
  }

  it("glides a pair from its old box to its new one; the same look is drawn once", () => {
    const p = plan([shape("a1", "logo")], [shape("b1", "logo"), shape("b2")], {
      a1: box(0, 0),
      b1: box(400, 200, 200, 200),
      b2: box(900, 900),
    });
    expect([p.hidden, p.crossfade, p.fadeIn]).toEqual([["a1"], [], ["b2"]]);
    const start = morphAt(p, 0);
    // At the start the arriving logo sits on the old one: moved back and shrunk to it.
    expect(start.to.get("b1")).toMatchObject({ x: -450, y: -250, scaleX: 0.5, scaleY: 0.5 });
    expect(start.to.get("b2")?.opacity).toBe(0);
    expect(start.from.get("a1")?.opacity).toBe(0); // hidden: no ghost
    const end = morphAt(p, 1);
    expect(end.to.get("b1")).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 });
    expect(end.backdrop).toBe(1);
  });

  it("keeps a fitted vector's proportions while it travels; lines and stretched paths stretch (D127)", () => {
    const path = (id: string, fit?: "stretch") =>
      element("vector", { d: "M0 0 L10 10", ...(fit && { fit }) }, { id, matchKey: id });
    const line = (id: string) => element("line", {}, { id, matchKey: id });
    const p = plan(
      [path("logo"), path("blob", "stretch"), line("rule")],
      [path("logo"), path("blob", "stretch"), line("rule")],
      { logo: box(0, 0), blob: box(0, 0), rule: box(0, 0) },
    );
    const uniform = Object.fromEntries(p.to.map((l) => [l.id, l.uniform]));
    expect(uniform).toEqual({ logo: true, blob: false, rule: false });
  });

  it("cross-fades a pair that looks different, and leaves animated layers to their own motion", () => {
    const p = plan([shape("a1", "k", "#f00")], [shape("b1", "k", "#00f")], {
      a1: box(0, 0),
      b1: box(0, 0),
    });
    expect(p.crossfade).toEqual(["b1"]);
    expect(morphAt(p, 0.5).to.get("b1")?.opacity).toBe(0.5);
    const left = plan(
      [shape("a1", "k")],
      [shape("b1", "k")],
      { a1: box(0, 0), b1: box(0, 0) },
      new Set(["b1"]),
    );
    expect([left.to, left.fadeIn]).toEqual([[], []]);
  });

  it("composes nested pairs: a travelling card carries its travelling title", () => {
    const card = (id: string, key: string, child: Node) =>
      frame({ id, matchKey: key, layout: { mode: "absolute" }, children: [child] });
    const p: MorphPlan = plan(
      [card("ca", "card", shape("ta", "title"))],
      [card("cb", "card", shape("tb", "title"))],
      {
        ca: box(0, 0, 200, 200),
        ta: box(0, 0, 100, 100),
        cb: box(1000, 0, 400, 400),
        tb: box(1000, 0, 200, 200),
      },
    );
    // Halfway the card is drawn at (500, 0) 300×300; the title should be at its own midpoint
    // box (500, 0) 150×150, whatever the card's own move and scale do to it.
    const mid = morphAt(p, 0.5).to;
    const c = mid.get("cb");
    const t = mid.get("tb");
    if (!c || !t) throw new Error("missing");
    // Draw the title: its own map, then the card's (both about their rest centres).
    const own = { x: 1100 + t.x, y: 100 + t.y }; // title centre after its own move
    const drawn = {
      x: 1200 + c.scaleX * (own.x - 1200) + c.x,
      y: 200 + c.scaleY * (own.y - 200) + c.y,
    };
    expect(drawn.x).toBeCloseTo(575); // centre of (500, 0) 150×150
    expect(drawn.y).toBeCloseTo(75);
    expect(200 * t.scaleX * c.scaleX).toBeCloseTo(150);
  });
});

describe("morph lint and errors (D123)", () => {
  const keyed = (id: string, key?: string) =>
    element("shape", { shape: "rect" }, { id, ...(key && { matchKey: key }) });
  const morph = { type: "morph" as const };

  it("warns when a morph has nothing to glide: first slide shown, or no match", () => {
    const deck = createDeck({
      title: "t",
      slides: [
        { ...createSlide({ id: "a", children: [keyed("a1", "logo")] }), transition: morph },
        { ...createSlide({ id: "h", children: [] }), hidden: true },
        { ...createSlide({ id: "b", children: [keyed("b1", "logo")] }), transition: morph },
        { ...createSlide({ id: "c", children: [keyed("c1", "other")] }), transition: morph },
      ],
    });
    const issues = lintDeck(deck).filter((i) => i.rule === "morph-unpaired");
    expect(issues.map((i) => i.slideId)).toEqual(["a", "c"]); // b pairs with a, past hidden h
    expect(issues[0]?.message).toContain("first slide shown");
    expect(issues[1]?.fix).toContain('same "matchKey"');
  });

  it("says a new transition needs its type, and how long a duration may be", () => {
    const untyped = TransitionSchema.safeParse({ duration: 500 });
    expect(untyped.error?.issues[0]?.message).toContain('needs a "type"');
    const negative = TransitionSchema.safeParse({ type: "fade", duration: -5 });
    expect(negative.error?.issues[0]?.message).toContain('or a theme token: "$motion.fast"');
  });
});
