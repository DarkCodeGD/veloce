import {
  type Animation,
  compileSlide,
  createDeck,
  createSlide,
  element,
  type MotionLevel,
  motionTokens,
  resolveMotion,
} from "@veloce/core";
import { checkEffectConformance, PluginRegistry } from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import { BUILTIN_EFFECTS, effectsPlugin } from "./index.js";

const registry = new PluginRegistry().register(effectsPlugin);
const box = element("shape", { shape: "rect" }, { id: "box" });

/** What `name` (with `params`) turns into on a shape at `level`. */
function resolve(
  name: string,
  params: Record<string, unknown> = {},
  level: MotionLevel = "subtle",
) {
  const animation = { id: "a", target: "box", effect: { name, params } } as Animation;
  const resolved = registry.resolveEffect(
    { name, params },
    { animation, target: box, tokens: motionTokens(undefined, level) },
  );
  if (!resolved) throw new Error(`${name} didn't resolve`);
  return resolved;
}

describe("built-in effects (D117)", () => {
  it.each(BUILTIN_EFFECTS.map((e) => [e.name, e] as const))(
    "%s passes the conformance kit at every level",
    (_, definition) => {
      expect(checkEffectConformance(definition).failures).toEqual([]);
    },
  );

  it("has the names frozen files use, and entrances, exits and emphasis", () => {
    expect(registry.effectNames()).toContain("fade-in"); // D113 §5's promise
    const kinds = new Set(BUILTIN_EFFECTS.map((e) => e.kind));
    expect(kinds).toEqual(new Set(["entrance", "exit", "emphasis"]));
  });

  it("slides the way it's told: up rises from below, left comes from the right", () => {
    expect(resolve("slide-in").tracks).toEqual({
      y: [{ at: 0, value: 80 }],
      opacity: [{ at: 0, value: 0 }],
    });
    expect(resolve("slide-in", { direction: "left", fade: false }).tracks).toEqual({
      x: [{ at: 0, value: 80 }],
    });
    expect(resolve("slide-out").tracks.y).toEqual([{ at: 1, value: 80 }]); // leaves downwards
  });

  it("travels further and bounces more as the level rises; calm never bounces", () => {
    const travel = (level: MotionLevel) => resolve("slide-in", {}, level).tracks.y?.[0]?.value;
    expect([travel("calm"), travel("subtle"), travel("absurd")]).toEqual([40, 80, 320]);
    expect(resolve("pop-in", {}, "calm").easing).toEqual({ spring: { bounce: 0 } });
    expect(resolve("pop-in", {}, "subtle").easing).toEqual({ spring: { bounce: 0.4 } });
    expect(resolve("pop-in", {}, "absurd").easing).toEqual({ spring: { bounce: 0.8 } });
  });

  it("uses a number it's given as given, at any level (D111 §4)", () => {
    for (const level of ["calm", "absurd"] as const) {
      expect(resolve("slide-in", { distance: 200 }, level).tracks.y).toEqual([
        { at: 0, value: 200 },
      ]);
    }
  });

  it("plays through the evaluator: a slide-in starts off and fades, then rests", () => {
    const slide = createSlide({
      id: "s",
      children: [box],
      animations: [
        { id: "a", target: "box", trigger: "withPrevious", effect: { name: "slide-in" } },
      ],
    });
    const deck = createDeck({ title: "t", slides: [slide] });
    const compiled = compileSlide(deck, slide, { effects: registry.resolveEffect });
    expect(compiled.steps[0]?.duration).toBe(400); // $motion.normal, from the effect
    const start = resolveMotion(compiled.at({ time: 0, clicks: [] }).get("box")?.motion);
    expect([start.y, start.opacity]).toEqual([80, 0]);
    const end = resolveMotion(compiled.at({ time: 400, clicks: [] }).get("box")?.motion);
    expect([end.y, end.opacity]).toEqual([0, 1]);
  });
});

describe("checking effects (D117)", () => {
  const check = (name: string, params?: Record<string, unknown>) =>
    registry.validateEffect({ name, ...(params && { params }) }, box);

  it("knows its effects, and suggests one for a typo", () => {
    expect(check("fade-in").ok).toBe(true);
    const typo = check("fade-inn");
    expect(typo).toMatchObject({ ok: false, reason: "unknown-effect" });
    expect(typo.ok === false && typo.hint).toContain('"fade-in"');
  });

  it("checks params, and lists the ones there are", () => {
    const bad = check("slide-in", { direction: "sideways" });
    expect(bad).toMatchObject({ ok: false, reason: "invalid-params" });
    expect(bad.ok === false && bad.hint).toContain("direction");
    expect(check("slide-in", { speed: 2 })).toMatchObject({ ok: false, reason: "invalid-params" });
  });

  it("gives up on a broken effect instead of breaking the slide", () => {
    const broken = new PluginRegistry().register({
      manifest: { id: "acme.broken", name: "Broken", version: "1.0.0" },
      elements: [],
      effects: [
        {
          ...BUILTIN_EFFECTS[0],
          name: "acme.throws",
          resolve: () => {
            throw new Error("boom");
          },
        },
        { ...BUILTIN_EFFECTS[0], name: "acme.nonsense", resolve: () => ({ tracks: {} }) },
      ],
    } as never);
    const context = { animation: {} as Animation, target: box, tokens: motionTokens(undefined) };
    expect(broken.resolveEffect({ name: "acme.throws" }, context)).toBeNull();
    expect(broken.resolveEffect({ name: "acme.nonsense" }, context)).toBeNull();
  });
});
