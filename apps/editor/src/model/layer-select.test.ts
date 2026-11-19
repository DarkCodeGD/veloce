import { describe, expect, it } from "vitest";
import { clickLayer, type LayerAnchor } from "./layer-select.js";

const rows = ["a", "b", "c", "d", "e", "f"];
const plain = (id: string) => ({ id, range: false, toggle: false });
const shift = (id: string) => ({ id, range: true, toggle: false });
const mod = (id: string) => ({ id, range: false, toggle: true });

/** Click a sequence of rows, starting from nothing selected. */
function clicks(...steps: Array<ReturnType<typeof plain>>) {
  let selection: string[] = [];
  let anchor: LayerAnchor | null = null;
  for (const step of steps) ({ selection, anchor } = clickLayer(rows, selection, anchor, step));
  return selection;
}

describe("clicking layer rows", () => {
  it("selects one layer with a plain click", () => {
    expect(clicks(plain("b"), plain("d"))).toEqual(["d"]);
  });

  it("selects a range with Shift, in either direction", () => {
    expect(clicks(plain("b"), shift("e"))).toEqual(["b", "c", "d", "e"]);
    expect(clicks(plain("e"), shift("b"))).toEqual(["b", "c", "d", "e"]);
  });

  it("re-ranges from the same anchor, so a range can shrink", () => {
    expect(clicks(plain("b"), shift("f"), shift("c"))).toEqual(["b", "c"]);
  });

  it("toggles single layers with Ctrl/Cmd", () => {
    expect(clicks(plain("a"), mod("c"), mod("e"))).toEqual(["a", "c", "e"]);
    expect(clicks(plain("a"), mod("c"), mod("a"))).toEqual(["c"]);
  });

  it("adds a range to what was toggled before it", () => {
    // a, then Ctrl+d (anchor d), then Shift+f: a stays, d..f is added.
    expect(clicks(plain("a"), mod("d"), shift("f"))).toEqual(["a", "d", "e", "f"]);
  });

  it("ranges from the last selected visible row when the anchor is stale", () => {
    // Selected elsewhere (the canvas): c and e. No anchor yet.
    const { selection } = clickLayer(rows, ["c", "e"], null, shift("b"));
    expect(selection).toEqual(["c", "e", "b", "d"]);
    // An anchor that is no longer selected is ignored the same way.
    const stale = { id: "a", base: [] };
    expect(clickLayer(rows, ["f"], stale, shift("d")).selection).toEqual(["f", "d", "e"]);
  });

  it("adds just the row when nothing visible can anchor a range", () => {
    expect(clickLayer(rows, [], null, shift("c")).selection).toEqual(["c"]);
    // Everything selected is inside a collapsed frame: Shift still adds, never drops.
    expect(clickLayer(rows, ["hidden"], null, shift("c")).selection).toEqual(["hidden", "c"]);
  });
});
