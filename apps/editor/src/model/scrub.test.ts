import { describe, expect, it } from "vitest";
import { nudge, parseNumber, quantize, rate, Scrub } from "./scrub.js";

const none = { shiftKey: false, altKey: false };
const shift = { shiftKey: true, altKey: false };
const alt = { shiftKey: false, altKey: true };

describe("scrubbing", () => {
  it("moves one step per pixel, 10x with Shift, 1/10 with Alt", () => {
    expect(rate(none)).toBe(1);
    expect(rate(shift)).toBe(10);
    expect(rate(alt)).toBe(0.1);
    expect(rate(none, 5)).toBe(5);

    const s = new Scrub(50, {});
    expect(s.move(3, none)).toBe(53);
    expect(s.move(-1, none)).toBe(52);
    expect(s.move(2, shift)).toBe(72);
    expect(s.move(5, alt)).toBe(72.5);
  });

  it("clamps and responds immediately when dragging back from a limit", () => {
    const s = new Scrub(95, { min: 0, max: 100 });
    expect(s.move(40, none)).toBe(100);
    expect(s.move(-1, none)).toBe(99); // no dead zone from the 35px past the max
    expect(s.move(-500, shift)).toBe(0);
    expect(s.move(2, none)).toBe(2);
  });

  it("keeps integer fields whole but lets Alt creep through them slowly", () => {
    const s = new Scrub(3, { integer: true, min: 1 });
    expect(s.move(4, alt)).toBe(3); // 3.4 → still 3
    expect(s.move(2, alt)).toBe(4); // 3.6 → 4
    expect(s.move(-100, none)).toBe(1);
  });

  it("emits clean decimals without float noise", () => {
    const s = new Scrub(0.1, { step: 0.1 });
    expect(s.move(2, none)).toBe(0.3); // not 0.30000000000000004
    expect(quantize(1.23456, { step: 0.01 })).toBe(1.23);
    expect(quantize(7, { step: 0.5 })).toBe(7);
    expect(quantize(7.3, { step: 0.5 })).toBe(7.5);
  });

  it("nudges with the same modifiers and limits", () => {
    expect(nudge(10, 1, none, {})).toBe(11);
    expect(nudge(10, -1, shift, {})).toBe(0);
    expect(nudge(10, 1, alt, {})).toBe(10.1);
    expect(nudge(99, 1, shift, { max: 100 })).toBe(100);
    expect(nudge(2, -1, none, { min: 1, integer: true })).toBe(1);
  });

  it("keeps precision you already set (rounds the change, not the value)", () => {
    expect(nudge(60.5, 1, none, {})).toBe(61.5);
    expect(nudge(60.5, -1, shift, {})).toBe(50.5);
    expect(new Scrub(60.5, {}).move(2, none)).toBe(62.5);
    expect(new Scrub(60.25, {}).move(1, alt)).toBe(60.35);
    expect(quantize(12.34, {}, true, 12.34)).toBe(12.34); // typed values stay as typed
    expect(quantize(3.6, { integer: true }, false, 3.6)).toBe(4); // …unless whole numbers only
    expect(new Scrub(0.30000000000000004, {}).move(1, none)).toBe(1.3); // float noise capped
  });

  it("parses typed numbers with optional units", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" 12.5px ")).toBe(12.5);
    expect(parseNumber("50%")).toBe(50);
    expect(parseNumber("-90°")).toBe(-90);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("12 px 3")).toBeNull();
    expect(parseNumber("1e999")).toBeNull();
  });
});
