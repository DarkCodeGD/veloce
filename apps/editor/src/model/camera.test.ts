import { describe, expect, it } from "vitest";
import {
  cameraFor,
  keepVisible,
  panBy,
  wheelPan,
  wheelZoomFactor,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAt,
  zoomKeyDirection,
  zoomLabel,
  zoomStep,
} from "./camera.js";

const stage = { w: 1920, h: 1080 };
const viewport = { w: 1000, h: 600 };

describe("canvas camera", () => {
  it("zooms around the pointer: the slide point under it stays put", () => {
    const camera = { scale: 0.5, x: 20, y: 30 };
    const at = { x: 420, y: 230 }; // slide point (800, 400)
    const zoomed = zoomAt(camera, 2, at);
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x + 800 * 2).toBeCloseTo(at.x);
    expect(zoomed.y + 400 * 2).toBeCloseTo(at.y);
    // Clamped to the zoom range, still around the pointer.
    expect(zoomAt(camera, 100, at).scale).toBe(ZOOM_MAX);
    expect(zoomAt(camera, 0.001, at).scale).toBe(ZOOM_MIN);
  });

  it("steps through the presets in and out, from anywhere", () => {
    expect(zoomStep(1, 1)).toBe(1.5);
    expect(zoomStep(1, -1)).toBe(0.75);
    expect(zoomStep(0.42, 1)).toBe(0.5); // a fitted 42% goes to the next preset
    expect(zoomStep(0.42, -1)).toBe(0.25);
    expect(zoomStep(16, 1)).toBe(ZOOM_MAX);
    expect(zoomStep(0.1, -1)).toBe(ZOOM_MIN);
  });

  it("turns pinches into smooth zoom and wheel notches into capped steps", () => {
    expect(wheelZoomFactor(-4)).toBeCloseTo(Math.exp(0.04)); // pinch out a little: zoom in
    expect(wheelZoomFactor(4)).toBeLessThan(1);
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.25)); // one mouse notch, capped
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(Math.exp(-0.25)); // 3 lines = 48px, capped
  });

  it("pans opposite to the scroll, and sideways with Shift", () => {
    expect(wheelPan({ deltaX: 0, deltaY: 50 })).toEqual({ x: -0, y: -50 });
    expect(wheelPan({ deltaX: 10, deltaY: 20 })).toEqual({ x: -10, y: -20 }); // trackpad
    expect(wheelPan({ deltaX: 0, deltaY: 50, shiftKey: true })).toEqual({ x: -50, y: -0 });
    expect(wheelPan({ deltaX: 0, deltaY: 2, deltaMode: 1 })).toEqual({ x: -0, y: -32 });
    expect(panBy({ scale: 1, x: 5, y: 5 }, { x: 10, y: -5 })).toEqual({ scale: 1, x: 15, y: 0 });
  });

  it("never lets the slide leave the screen entirely", () => {
    // 100%: the slide is 1920 wide; flung far right, 64px of it stay at the right edge.
    const right = keepVisible({ scale: 1, x: 5000, y: 0 }, viewport, stage);
    expect(right.x).toBe(viewport.w - 64);
    const left = keepVisible({ scale: 1, x: -5000, y: -5000 }, viewport, stage);
    expect(left.x + 1920).toBe(64);
    expect(left.y + 1080).toBe(64);
    // Anything in between is left alone.
    expect(keepVisible({ scale: 1, x: -300, y: -200 }, viewport, stage)).toEqual({
      scale: 1,
      x: -300,
      y: -200,
    });
  });

  it("fits a rect (the slide, or the selection) centered with padding", () => {
    const slide = cameraFor({ x: 0, y: 0, w: 1920, h: 1080 }, viewport);
    expect(slide.scale).toBeCloseTo((1000 - 96) / 1920);
    expect(slide.x + (1920 * slide.scale) / 2).toBeCloseTo(500);
    expect(slide.y + (1080 * slide.scale) / 2).toBeCloseTo(300);
    // A small selection zooms in, capped at the maximum; a point doesn't divide by zero.
    const badge = cameraFor({ x: 900, y: 500, w: 40, h: 20 }, viewport);
    expect(badge.scale).toBe(ZOOM_MAX);
    expect(badge.x + 920 * ZOOM_MAX).toBeCloseTo(500);
    expect(cameraFor({ x: 10, y: 10, w: 0, h: 0 }, viewport).scale).toBe(ZOOM_MAX);
  });

  it("zooms with Mod + '+' / '-' on any keyboard layout", () => {
    const press = (key: string, code: string, mods: { meta?: boolean; alt?: boolean } = {}) =>
      zoomKeyDirection({
        key,
        code,
        ctrlKey: !mods.meta,
        metaKey: !!mods.meta,
        altKey: !!mods.alt,
      });
    expect(press("=", "Equal")).toBe(1); // US
    expect(press("+", "Equal")).toBe(1); // US with Shift
    expect(press("+", "BracketRight")).toBe(1); // German "+" key
    expect(press("=", "Equal", { meta: true })).toBe(1); // macOS ⌘
    expect(press("+", "NumpadAdd")).toBe(1);
    expect(press("-", "Minus")).toBe(-1);
    expect(press("-", "Slash")).toBe(-1); // German "-" key
    expect(press("-", "NumpadSubtract")).toBe(-1);
    // Not a zoom: Alt held, no modifier, or a key that only *sits* where "=" is on US.
    expect(press("=", "Equal", { alt: true })).toBe(0);
    expect(
      zoomKeyDirection({ key: "=", code: "Equal", ctrlKey: false, metaKey: false, altKey: false }),
    ).toBe(0);
    expect(press("´", "Equal")).toBe(0); // German dead key on the US "=" position
  });

  it("labels the zoom as a percentage", () => {
    expect(zoomLabel(0.4708)).toBe("47%");
    expect(zoomLabel(1)).toBe("100%");
  });
});
