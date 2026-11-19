import { describe, expect, it } from "vitest";
import { deepEqual, diffPatch, mergePatch } from "../json.js";
import { deepFreeze } from "./fixtures.js";

describe("mergePatch (RFC 7386)", () => {
  it("merges nested objects, replaces arrays and primitives, deletes on null", () => {
    const target = deepFreeze({ a: 1, b: { c: 2, d: 3 }, list: [1, 2], gone: true });
    const result = mergePatch(target, { a: 9, b: { d: null, e: 4 }, list: [3], gone: null });
    expect(result).toEqual({ a: 9, b: { c: 2, e: 4 }, list: [3] });
  });

  it("replaces a non-object patch wholesale", () => {
    expect(mergePatch({ a: 1 }, "x")).toBe("x");
    expect(mergePatch("x", { a: 1, b: null })).toEqual({ a: 1 });
  });

  it("replaces a tagged object when its variant changes (discriminator rule)", () => {
    const stack = { mode: "stack", direction: "row", gap: 24 };
    expect(mergePatch(stack, { mode: "grid", columns: 3 })).toEqual({ mode: "grid", columns: 3 });
    // Same variant → normal merge.
    expect(mergePatch(stack, { mode: "stack", gap: 8 })).toEqual({ ...stack, gap: 8 });
    const linear = { type: "linear-gradient", angle: 90, stops: [] };
    expect(mergePatch(linear, { type: "radial-gradient", stops: [] })).toEqual({
      type: "radial-gradient",
      stops: [],
    });
    // Conic (angular) gradients are a variant too: the linear one's angle doesn't leak in.
    expect(mergePatch(linear, { type: "conic-gradient", stops: [] })).toEqual({
      type: "conic-gradient",
      stops: [],
    });
  });

  it("replaces padding when a patch switches its form (shape rule)", () => {
    const axes = { padding: { x: 10, y: 20 } };
    const sides = { top: 1, right: 2, bottom: 3, left: 4 };
    expect(mergePatch(axes, { padding: sides })).toEqual({ padding: sides });
    expect(mergePatch({ padding: sides }, { padding: { y: 8 } })).toEqual({ padding: { y: 8 } });
    // Same form: an ordinary merge. Nulls don't count toward the form.
    expect(mergePatch(axes, { padding: { y: 5 } })).toEqual({ padding: { x: 10, y: 5 } });
    expect(mergePatch(axes, { padding: { x: null, top: 4 } })).toEqual({ padding: { top: 4 } });
    // From or to a single value: plain replacement, as before.
    expect(mergePatch({ padding: 24 }, { padding: { top: 4 } })).toEqual({ padding: { top: 4 } });
    // Only the `padding` field: other objects with these keys still merge (plugin props).
    expect(mergePatch({ box: { x: 1 } }, { box: { top: 2 } })).toEqual({ box: { x: 1, top: 2 } });
  });

  it("ignores prototype-polluting keys from untrusted JSON", () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "ok": 1}');
    const result = mergePatch({}, patch) as Record<string, unknown>;
    expect(result).toEqual({ ok: 1 });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not apply the discriminator rule to unrelated `type` values (plugin props)", () => {
    const chart = { type: "bar", data: [1, 2, 3] };
    expect(mergePatch(chart, { type: "line" })).toEqual({ type: "line", data: [1, 2, 3] });
  });
});

describe("diffPatch", () => {
  const cases: Array<[string, unknown, unknown]> = [
    ["equal", { a: 1 }, { a: 1 }],
    ["changed value", { a: 1, b: 2 }, { a: 1, b: 3 }],
    ["added + removed keys", { a: 1, b: 2 }, { a: 1, c: 3 }],
    ["nested", { s: { x: 1, y: 2 } }, { s: { x: 1, y: 5, z: 1 } }],
    ["to empty object", { s: { x: 1 } }, { s: {} }],
    ["arrays", { l: [1, 2] }, { l: [2] }],
    ["object → string", { fill: { type: "image", asset: "x" } }, { fill: "#fff" }],
    ["variant change", { l: { mode: "stack", gap: 1 } }, { l: { mode: "grid", columns: 2 } }],
    [
      "padding form change",
      { layout: { mode: "stack", padding: { x: 1, y: 2 } } },
      { layout: { mode: "stack", padding: { top: 3, left: 4 } } },
    ],
    ["padding value → form", { padding: 8 }, { padding: { x: 1 } }],
  ];

  it.each(cases)("round-trips: %s", (_name, from, to) => {
    const patch = diffPatch(from, to);
    expect(deepEqual(mergePatch(from, patch ?? {}), to)).toBe(true);
  });

  it("returns undefined for equal values and minimal patches otherwise", () => {
    expect(diffPatch({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBeUndefined();
    expect(diffPatch({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: 3 });
  });
});

describe("deepEqual", () => {
  it("treats undefined-valued keys as absent", () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, { x: 1 }], [1, { x: 2 }])).toBe(false);
  });
});
