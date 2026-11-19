import { describe, expect, it } from "vitest";
import { blockPageZoom } from "./page-zoom.js";

/** A cancelable event carrying the modifier/key fields the guard reads. */
const event = (type: string, fields: Record<string, unknown>) =>
  Object.assign(new Event(type, { cancelable: true }), {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    key: "",
    code: "",
    ...fields,
  });

describe("blockPageZoom", () => {
  it("cancels the browser's zoom gestures and nothing else", () => {
    const target = new EventTarget();
    const remove = blockPageZoom(target as unknown as Window);
    const cancelled = (e: Event) => !target.dispatchEvent(e);

    expect(cancelled(event("wheel", { ctrlKey: true }))).toBe(true); // Ctrl + scroll, pinch
    expect(cancelled(event("wheel", { metaKey: true }))).toBe(true); // ⌘ + scroll
    expect(cancelled(event("wheel", {}))).toBe(false); // plain scrolling: panels still scroll
    expect(cancelled(event("keydown", { ctrlKey: true, key: "=", code: "Equal" }))).toBe(true);
    expect(cancelled(event("keydown", { ctrlKey: true, key: "-", code: "Minus" }))).toBe(true);
    expect(cancelled(event("keydown", { key: "=", code: "Equal" }))).toBe(false); // typing "="
    expect(cancelled(event("keydown", { ctrlKey: true, key: "c", code: "KeyC" }))).toBe(false);

    remove();
    expect(cancelled(event("wheel", { ctrlKey: true }))).toBe(false);
  });
});
