import { describe, expect, it } from "vitest";
import { moveActive, typeahead } from "./listbox.js";

const opts = (...labels: string[]) =>
  labels.map((label) => ({ label: label.replace("!", ""), disabled: label.endsWith("!") }));

describe("listbox keyboard", () => {
  const list = opts("Start", "Center!", "End", "Stretch", "Space between");

  it("moves with arrows, skipping disabled options and stopping at the ends", () => {
    expect(moveActive(list, 0, "ArrowDown")).toBe(2); // skips the disabled "Center"
    expect(moveActive(list, 2, "ArrowUp")).toBe(0);
    expect(moveActive(list, 4, "ArrowDown")).toBe(4); // no wrap
    expect(moveActive(list, 0, "ArrowUp")).toBe(0);
    expect(moveActive(list, -1, "ArrowDown")).toBe(0);
    expect(moveActive(list, -1, "ArrowUp")).toBe(4);
    expect(moveActive(list, 2, "Home")).toBe(0);
    expect(moveActive(list, 0, "End")).toBe(4);
    expect(moveActive(list, 0, "PageDown")).toBe(4);
    expect(moveActive(list, 4, "PageUp")).toBe(0);
    expect(moveActive(list, 0, "a")).toBeNull();
  });

  it("finds options by typing, cycling on a repeated letter", () => {
    expect(typeahead(list, 0, "e")).toBe(2);
    expect(typeahead(list, 0, "s")).toBe(3); // next "S…" after the current one
    expect(typeahead(list, 3, "s")).toBe(4);
    expect(typeahead(list, 4, "s")).toBe(0); // wraps
    expect(typeahead(list, 3, "ss")).toBe(4); // repeated letter keeps cycling
    expect(typeahead(list, 0, "sp")).toBe(4); // multi-letter prefix
    expect(typeahead(list, 0, "st")).toBe(0); // …which may match the current option
    expect(typeahead(list, 0, "c")).toBe(0); // "Center" is disabled: stay put
    expect(typeahead(list, 2, "zzz")).toBe(2);
  });
});
