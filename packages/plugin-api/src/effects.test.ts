import { element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkEffectConformance } from "./effect-conformance.js";
import { PluginRegistry } from "./registry.js";
import { defineEffect, type EffectDefinition, type VelocePlugin } from "./types.js";

const base = defineEffect({
  name: "acme.rise",
  title: "Rise",
  description: "Rises into place.",
  kind: "entrance",
  paramsSchema: z.strictObject({ distance: z.number().optional() }),
  defaultParams: {},
  aiDocs: "Rises.",
  resolve: (p, { tokens }) => ({
    tracks: { y: [{ at: 0, value: (p.distance ?? 40) * tokens.distance }] },
  }),
});

const plugin = (id: string, ...effects: EffectDefinition<never>[]): VelocePlugin => ({
  manifest: { id, name: id, version: "1.0.0" },
  elements: [],
  effects,
});

describe("effects in the registry (D117)", () => {
  it("namespaces third-party effects, and refuses duplicates and bad defaults", () => {
    const registry = new PluginRegistry().register(plugin("acme.motion", base as never));
    expect(registry.effectNames()).toEqual(["acme.rise"]);
    expect(() =>
      new PluginRegistry().register(plugin("acme.motion", { ...base, name: "rise" } as never)),
    ).toThrow(/must be namespaced/);
    expect(() => registry.register(plugin("other.motion", base as never))).toThrow(
      /already provided/,
    );
    expect(() =>
      new PluginRegistry().register(
        plugin("acme.x", { ...base, defaultParams: { distance: "far" } } as never),
      ),
    ).toThrow(/defaultParams don't match/);
  });

  it("checks the target an effect asks for", () => {
    const typing = { ...base, name: "acme.type", targets: ["text"] };
    const registry = new PluginRegistry().register(
      plugin("acme.motion", base as never, typing as never),
    );
    const text = element("text", { content: "Hi" }, { id: "t" });
    expect(registry.validateEffect({ name: "acme.type" }, text).ok).toBe(true);
    const onFrame = registry.validateEffect({ name: "acme.type" }, frame({ id: "f" }));
    expect(onFrame).toMatchObject({ ok: false, reason: "wrong-target" });
    expect(onFrame.ok === false && onFrame.message).toContain("is a frame");
    expect(onFrame.ok === false && onFrame.hint).toContain("acme.rise"); // what fits instead
    // Without a target (a saved preset, D119), only the effect and its params are checked.
    expect(registry.validateEffect({ name: "acme.type" }).ok).toBe(true);
    expect(registry.validateEffect({ name: "acme.rise", params: { distance: "x" } }).ok).toBe(
      false,
    );
    expect([registry.hasEffect("acme.rise"), registry.hasEffect("rise")]).toEqual([true, false]);
    expect(registry.applyContext().hasEffect).toBe(registry.hasEffect);
  });

  it("records the effects' plugins in a deck's lock", () => {
    const registry = new PluginRegistry().register(plugin("acme.motion", base as never));
    const deck = {
      slides: [
        {
          root: frame({ id: "root", children: [] }),
          animations: [{ id: "a", target: "x", effect: { name: "acme.rise" } }],
        },
      ],
    };
    expect(registry.lockFor(deck as never)).toEqual({ "acme.motion": "1.0.0" });
  });

  it("locks a saved preset's effect, not an installed effect its name shadows (D119)", () => {
    const registry = new PluginRegistry()
      .register(plugin("acme.motion", base as never))
      .register(plugin("other.motion", { ...base, name: "other.rise" } as never));
    const deck = {
      presets: { "other.rise": { effect: { name: "acme.rise" } } },
      slides: [
        {
          root: frame({ id: "root", children: [] }),
          animations: [{ id: "a", target: "x", effect: { name: "other.rise" } }],
        },
      ],
    };
    expect(registry.lockFor(deck as never)).toEqual({ "acme.motion": "1.0.0" });
  });
});

describe("the effect conformance kit (D117)", () => {
  it("passes a good effect", () => {
    expect(checkEffectConformance(base).failures).toEqual([]);
  });

  it("catches an entrance that doesn't land where the layer rests", () => {
    const off = { ...base, resolve: () => ({ tracks: { y: [{ at: 1, value: 10 }] } }) };
    expect(checkEffectConformance(off).failures[0]).toMatch(/must land where the layer rests/);
  });

  it("catches emphasis that doesn't return to rest, and output that changes", () => {
    const stuck = {
      ...base,
      kind: "emphasis" as const,
      resolve: () => ({ tracks: { x: [{ at: 0, value: 5 }] } }),
    };
    expect(checkEffectConformance(stuck).failures[0]).toMatch(/start and end at rest/);
    let n = 0;
    const random = { ...base, resolve: () => ({ tracks: { y: [{ at: 0, value: n++ }] } }) };
    expect(checkEffectConformance(random).failures[0]).toMatch(/isn't deterministic/);
  });

  it("catches invalid tracks, durations and easings", () => {
    const bad = { ...base, resolve: () => ({ tracks: { width: [{ at: 0, value: 1 }] } }) };
    expect(checkEffectConformance(bad).failures[0]).toMatch(/invalid tracks/);
    const slow = {
      ...base,
      resolve: () => ({ duration: -5, tracks: { y: [{ at: 0, value: 1 }] } }),
    };
    expect(checkEffectConformance(slow as never).failures[0]).toMatch(/invalid duration/);
  });
});
