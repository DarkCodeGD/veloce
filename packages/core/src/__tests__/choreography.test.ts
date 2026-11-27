/**
 * Choreography from intent (D121): roles and units read from a real-looking slide, how much
 * moves at each level, and when it plays for each pacing.
 */
import { describe, expect, it } from "vitest";
import { createDeck, createSlide, element, frame } from "../builders.js";
import {
  choreograph,
  choreographDeck,
  choreographyUnits,
  replaceAnimationsOps,
} from "../choreography.js";
import type { Animation } from "../schema/animation.js";
import type { MotionLevel } from "../schema/motion.js";
import type { Node } from "../schema/node.js";
import { scheduleSlide } from "../timeline.js";
import { applyTransaction } from "../transaction.js";

const text = (id: string, content: string, style = "body") =>
  element("text", { content, style: `$text.${style}` }, { id });
const card = (id: string, figure: string, label: string) =>
  frame({
    id,
    style: { fill: "$color.surface" },
    layout: { mode: "stack", direction: "column" },
    children: [text(`${id}-n`, figure, "display"), text(`${id}-l`, label, "caption")],
  });

function slide(children?: Node[]) {
  return createSlide({
    id: "s",
    children: children ?? [
      element(
        "shape",
        { shape: "rect" },
        { id: "bg", positioning: "free", position: { x: 0, y: 0 }, width: 1920, height: 1080 },
      ),
      text("title", "Quarterly results", "h1"),
      text("sub", "Q3 2026, all regions", "lead"),
      frame({
        id: "stats",
        layout: { mode: "stack", direction: "row" },
        children: [
          card("c1", "42%", "Growth"),
          card("c2", "$4.2M", "Revenue"),
          card("c3", "12k", "Users"),
        ],
      }),
      frame({
        id: "points",
        layout: { mode: "stack", direction: "column" },
        children: [
          text("p1", "Strong Q3", "lead"),
          text("p2", "New markets", "lead"),
          text("p3", "Costs down", "lead"),
        ],
      }),
      element("image", {}, { id: "hero", width: 600, height: 400 }),
      element("shape", { shape: "rect" }, { id: "rule", width: 200, height: 4 }),
    ],
  });
}

function run(level: MotionLevel, intent: Parameters<typeof choreograph>[2] = {}, s = slide()) {
  let n = 0;
  const deck = createDeck({ title: "t", slides: [s] });
  return choreograph({ ...deck, motionLevel: level }, s, intent, { newId: () => `a${++n}` });
}

const targets = (animations: Animation[]) => [...new Set(animations.map((a) => a.target))];
const stepsOf = (animations: Animation[], s = slide()) =>
  scheduleSlide({ ...s, animations }).map((step) => step.animations.map((a) => a.animation.target));

describe("reading a slide (D121)", () => {
  it("finds units in reading order, each with its role", () => {
    const deck = createDeck({ title: "t" });
    const units = choreographyUnits(slide(), deck.stage);
    expect(units.map((u) => [u.node.id, u.role, u.items?.length])).toEqual([
      ["bg", "backdrop", undefined],
      ["title", "title", undefined],
      ["sub", "title", undefined], // a subtitle right under the title: part of the heading
      ["stats", "number", 3], // a row of cards: a list, its strongest role a figure
      ["points", "body", 3],
      ["hero", "visual", undefined],
      ["rule", "accent", undefined],
    ]);
  });
});

describe("how much moves, by level (D111 §7)", () => {
  it("calm: only the heading and the main point, with soft fades", () => {
    const { animations, notes } = run("calm");
    expect(targets(animations)).toEqual(["title", "sub", "stats"]);
    expect(animations.every((a) => a.effect?.name === "fade-in")).toBe(true);
    expect(animations.some((a) => a.stagger)).toBe(false); // a list comes in whole
    expect(notes[0]).toContain('4 layers stay still at "calm"');
  });

  it("subtle: the content in reading order, one effect each, nothing decorative", () => {
    const { animations } = run("subtle");
    expect(targets(animations)).toEqual(["title", "sub", "stats", "points", "hero"]);
    expect(animations.find((a) => a.target === "points")?.stagger).toEqual({}); // one by one
    expect(animations.some((a) => a.repeat)).toBe(false);
    // Everything as the slide appears, cascading $motion.fast apart.
    expect(stepsOf(animations)).toHaveLength(1);
    expect(animations.slice(1).every((a) => a.delay === "$motion.fast")).toBe(true);
  });

  it("lively: accents too, cards pop, and the slide's visual keeps drifting", () => {
    const { animations } = run("lively");
    expect(targets(animations)).toContain("rule");
    expect(targets(animations)).not.toContain("bg");
    expect(animations.find((a) => a.target === "stats")?.effect?.name).toBe("pop-in");
    const loops = animations.filter((a) => a.repeat === "forever");
    // The visual drifts, not the figures: reading text never loops below absurd (D126).
    expect(loops.map((a) => [a.target, a.effect?.name])).toEqual([["hero", "float"]]);
  });

  it("intense and absurd: everything, and more keeps moving", () => {
    const intense = run("intense").animations;
    expect(targets(intense)).toContain("bg");
    expect(intense.filter((a) => a.repeat === "forever").map((a) => a.target)).toEqual([
      "stats",
      "hero",
    ]);
    expect(intense.find((a) => a.target === "stats")?.stagger).toEqual({ from: "center" });
    const absurd = run("absurd").animations;
    expect(absurd.filter((a) => a.repeat === "forever")).toHaveLength(7);
  });

  it("counts figures up when they're text, one by one", () => {
    const stats = frame({
      id: "nums",
      layout: { mode: "stack", direction: "row" },
      children: [text("n1", "42%", "h2"), text("n2", "3×", "h2")],
    });
    const { animations } = run("lively", {}, slide([text("t", "Results", "h1"), stats]));
    expect(animations.filter((a) => a.effect?.name === "count-up").map((a) => a.target)).toEqual([
      "n1",
      "n2",
    ]);
  });

  it("plays a plain fade when an effect isn't installed", () => {
    let n = 0;
    const s = slide([text("t", "Results", "h1"), text("n", "42%", "display")]);
    const { animations } = choreograph(
      { ...createDeck({ title: "t" }), motionLevel: "lively" },
      s,
      {},
      { hasEffect: (name) => name !== "count-up", newId: () => `a${++n}` },
    );
    expect(animations.find((a) => a.target === "n")?.tracks).toEqual({
      opacity: [{ at: 0, value: 0 }],
    });
  });
});

describe("pacing and focus (D121)", () => {
  it("build: the title with the slide, then one point per click, lists one item a click", () => {
    const { animations } = run("subtle", { pacing: "build" });
    expect(stepsOf(animations)).toEqual([
      ["title", "sub"],
      ["c1"],
      ["c2"],
      ["c3"],
      ["p1"],
      ["p2"],
      ["p3"],
      ["hero"],
    ]);
  });

  it("focus: everything in, then a click punches the main point", () => {
    const lively = run("lively", { pacing: "focus" }).animations;
    const steps = stepsOf(lively);
    expect(steps).toHaveLength(2);
    expect(steps[1]).toEqual(["stats"]);
    expect(lively.at(-1)?.effect?.name).toBe("pulse");
    // One effect per layer (subtle): the main point enters on that click instead.
    const subtle = stepsOf(run("subtle", { pacing: "focus" }).animations);
    expect(subtle[0]).not.toContain("stats");
    expect(subtle[1]).toEqual(["stats"]);
  });

  it("emphasizes the layers asked for, by the unit that plays them", () => {
    const { animations, notes } = run("lively", { emphasize: ["p2", "nope"] });
    expect(animations.filter((a) => a.effect?.name === "pulse").map((a) => a.target)).toEqual([
      "points",
    ]);
    expect(notes).toContain(
      "\"nope\" isn't a layer on this slide that animates, so it's not emphasized.",
    );
    // At calm the layer is moved even though calm's reach leaves it, but gets no extra punch.
    const calm = run("calm", { emphasize: ["hero"] });
    expect(targets(calm.animations)).toContain("hero");
    expect(calm.notes.some((n) => n.includes('pacing "focus"'))).toBe(true);
  });

  it("replaces the slide's animations in one transaction, undone in one step", () => {
    const old: Animation = { id: "old", target: "title", effect: { name: "fade-in" } };
    const s = { ...slide(), animations: [old] };
    const deck = createDeck({ title: "t", slides: [s] });
    const { animations } = run("subtle", {}, s);
    const result = applyTransaction(deck, {
      origin: "user",
      label: "Animate slide",
      ops: replaceAnimationsOps(s, animations),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.deck.slides[0]?.animations?.map((a) => a.id)).toEqual(
      animations.map((a) => a.id),
    );
    const undone = applyTransaction(result.deck, {
      origin: "user",
      label: "Undo",
      ops: result.inverse,
    });
    expect(undone.ok && undone.deck.slides[0]?.animations).toEqual([old]);
  });
});

describe("animating the whole deck (D121)", () => {
  const two = () => {
    const tuned: Animation = { id: "mine", target: "t2", effect: { name: "pulse" } };
    return createDeck({
      title: "t",
      slides: [
        {
          ...createSlide({ id: "s1", children: [text("t1", "One", "h1"), text("b1", "Body")] }),
          motionLevel: "calm" as const,
        },
        createSlide({ id: "s2", children: [text("t2", "Two", "h1")], animations: [tuned] }),
        createSlide({ id: "s3", children: [text("t3", "Three", "h1"), text("b3", "Body")] }),
      ],
    });
  };

  it("animates every slide at its own level, in one transaction, undone in one step", () => {
    const deck = two();
    const { ops, slides } = choreographDeck(deck, { pacing: "auto" });
    expect(slides.map((s) => [s.slideId, s.kept, s.moving])).toEqual([
      ["s1", false, 2], // calm: the title and the main point
      ["s2", false, 1],
      ["s3", false, 2],
    ]);
    const result = applyTransaction(deck, { origin: "user", label: "Animate deck", ops });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.deck.slides.every((s) => (s.animations?.length ?? 0) > 0)).toBe(true);
    expect(result.deck.slides[1]?.animations?.some((a) => a.id === "mine")).toBe(false);
    const undone = applyTransaction(result.deck, {
      origin: "user",
      label: "Undo",
      ops: result.inverse,
    });
    expect(undone.ok && undone.deck).toEqual(deck);
  });

  it("keeps the slides someone already animated, when asked", () => {
    const { ops, slides } = choreographDeck(two(), { keepAnimated: true });
    expect(slides.find((s) => s.slideId === "s2")?.kept).toBe(true);
    expect(ops.some((op) => op.op === "animation.remove")).toBe(false);
  });
});

describe("agents' retest findings (D126)", () => {
  const effectOf = (animations: Animation[], target: string) =>
    animations.find((a) => a.target === target)?.effect?.name;

  it("counts up a figure with a longer unit word, but not a year heading", () => {
    const s = slide([
      text("kpi", "70 cherries", "display"),
      text("year", "2026 roadmap", "h1"),
      text("heat", "1,200 °C", "display"),
    ]);
    const roles = choreographyUnits(s, { width: 1920, height: 1080 });
    expect(roles.find((u) => u.node.id === "kpi")?.role).toBe("number");
    expect(roles.find((u) => u.node.id === "heat")?.role).toBe("number");
    expect(roles.find((u) => u.node.id === "year")?.role).toBe("title");
    expect(effectOf(run("lively", {}, s).animations, "kpi")).toBe("count-up");
  });

  it("zooms instead of flipping where there's no perspective, and says how to flip", () => {
    const flat = run("absurd");
    expect(effectOf(flat.animations, "title")).toBe("zoom-in");
    expect(flat.animations.some((a) => a.effect?.name === "flip-in")).toBe(false);
    expect(flat.notes.join(" ")).toMatch(/"title".*zoom in instead of flipping[\s\S]*perspective/);

    const base = slide();
    const deep = { ...base, root: { ...base.root, perspective: 1200 } };
    const turned = run("absurd", {}, deep);
    expect(effectOf(turned.animations, "title")).toBe("flip-in");
    // Only the slide's own children are in its perspective: the cards in the stats row
    // still have none, and the note names that frame.
    expect(turned.notes.join(" ")).not.toMatch(/"title"/);
    expect(turned.notes.join(" ")).toMatch(/"stats" zoom in instead of flipping/);
  });
});

describe("agents' second animation test (D126)", () => {
  const stage = { width: 1920, height: 1080 };
  const effectOf = (animations: Animation[], target: string) =>
    animations.find((a) => a.target === target)?.effect?.name;
  const loops = (animations: Animation[]) =>
    animations.filter((a) => a.repeat === "forever").map((a) => a.target);
  const star = (id: string, size = 300) =>
    element("shape", { shape: "ellipse" }, { id, width: size, height: size, matchKey: "star" });
  const drawing = frame({
    id: "art",
    layout: { mode: "absolute" },
    children: [
      element(
        "shape",
        { shape: "ellipse" },
        { id: "shell", positioning: "free", position: { x: 0, y: 0 }, width: 600, height: 600 },
      ),
      element(
        "shape",
        { shape: "ellipse" },
        { id: "core", positioning: "free", position: { x: 260, y: 260 }, width: 80, height: 80 },
      ),
      element(
        "text",
        { content: "Earth's orbit", style: "$text.small" },
        { id: "label", positioning: "free", position: { x: 0, y: 0 } },
      ),
    ],
  });

  it("reads big shapes and drawings as the visual, kickers and subtitles as the heading", () => {
    const s = slide([
      frame({
        id: "left",
        layout: { mode: "stack", direction: "column" },
        children: [
          text("kicker", "Stage 1 · Nebula", "caption"),
          text("title", "Born in a cloud", "h1"),
          text("sub", "Gravity does the rest", "h3"),
          text("body", "Gas clumps and spins.", "body"),
        ],
      }),
      drawing,
      star("star"),
      element("shape", { shape: "ellipse" }, { id: "dot", width: 12, height: 12 }),
    ]);
    const units = choreographyUnits(s, stage);
    const role = (id: string) => units.find((u) => u.node.id === id);
    expect(role("kicker")).toMatchObject({ role: "title", companion: true });
    expect(role("sub")).toMatchObject({ role: "title", companion: true });
    expect(role("body")?.role).toBe("body");
    expect(role("art")).toMatchObject({ role: "visual", drawing: true });
    expect(role("star")?.role).toBe("visual");
    expect(role("dot")?.role).toBe("accent");

    // Build: the heading together, then the points; the drawing comes whole on its click.
    const steps = stepsOf(run("lively", { pacing: "build" }, s).animations);
    expect(steps[0]).toEqual(expect.arrayContaining(["kicker", "title", "sub"]));
    expect(steps[0]).not.toContain("body");
    expect(steps.slice(1).map((step) => step[0])).toEqual(["body", "art", "star"]);
  });

  it("loops the visual, never reading text, below absurd", () => {
    const s = slide([
      text("title", "Black holes", "h1"),
      text("sub", "Where light ends", "lead"),
      drawing,
    ]);
    expect(loops(run("lively", {}, s).animations)).toEqual(["art"]);
    expect(
      loops(
        run("lively", {}, slide([text("title", "Hi", "h1"), text("b", "Text only")])).animations,
      ),
    ).toEqual([]);
  });

  it("opens a big-number slide with the number and its caption", () => {
    const s = slide([
      text("kicker", "Stage 2", "caption"),
      text("kpi", "15,000,000 °C", "display"),
      text("cap", "at the Sun's core", "h3"),
    ]);
    const { animations } = run("lively", { pacing: "build" }, s);
    expect(stepsOf(animations)).toEqual([["kicker", "kpi", "cap"]]);
    expect(effectOf(animations, "kpi")).toBe("count-up");
  });

  it("leaves morph partners to the morph: no entrance arriving, no loop leaving", () => {
    const one = createSlide({ id: "one", children: [text("t1", "A star", "h1"), star("s1-star")] });
    const two = createSlide({
      id: "two",
      transition: { type: "morph" },
      children: [text("t2", "Nebula", "h1"), text("b2", "Gas", "body"), star("s2-star")],
    });
    const deck = {
      ...createDeck({ title: "Motion", slides: [one, two] }),
      motionLevel: "lively" as const,
    };
    const first = choreograph(deck, one, {}, { hasEffect: () => true });
    expect(loops(first.animations)).not.toContain("s1-star"); // it glides on into "two"
    const second = choreograph(deck, two, {}, { hasEffect: () => true });
    expect(second.animations.map((a) => a.target)).not.toContain("s2-star");
    expect(second.notes.join(" ")).toMatch(/"s2-star" comes in by the morph/);
    // Without the deck's slides (an editor preview of one slide), nothing is skipped.
    expect(
      choreograph({ ...deck, slides: undefined }, two).animations.map((a) => a.target),
    ).toContain("s2-star");
  });
});
