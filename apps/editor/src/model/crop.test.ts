import { describe, expect, it } from "vitest";
import {
  cropFor,
  cropOf,
  MAX_ZOOM,
  MIN_WINDOW,
  moveWindow,
  panPicture,
  pictureRect,
  scalePicture,
  startingCrop,
  trimWindow,
} from "./crop.js";
import type { Rect } from "./geometry.js";

/** A 400×300 window showing the middle of a picture laid out at 800×600. */
const window = { x: 0, y: 0, w: 400, h: 300 };
const picture = { x: -200, y: -150, w: 800, h: 600 };

/** Rectangles equal to well under a pixel (scaling multiplies float dust). */
function near(actual: Rect, expected: Rect) {
  for (const k of ["x", "y", "w", "h"] as const) expect(actual[k], k).toBeCloseTo(expected[k], 6);
}

describe("crop maths (D84)", () => {
  it("lays the picture out behind the window and reads the crop back", () => {
    const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    expect(pictureRect(crop, { w: 400, h: 300 })).toEqual(picture);
    expect(cropFor(picture, window)).toEqual(crop);
    // Rounded to 0.01%, and always on the picture.
    expect(cropFor({ x: -100.0003, y: 0, w: 1000, h: 300 }, window)).toEqual({
      x: 0.1,
      y: 0,
      w: 0.4,
      h: 1,
    });
    expect(cropFor({ x: 10, y: 0, w: 400, h: 300 }, window).x).toBe(0);
  });

  it("starts from the stored crop, else from what cover and the focus show", () => {
    const stored = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(startingCrop(stored, { w: 1600, h: 900 }, { w: 400, h: 400 }, { x: 0.5, y: 0.5 })).toBe(
      stored,
    );
    // A 16:9 picture in a square, aimed at the left edge.
    const fresh = startingCrop(
      undefined,
      { w: 1600, h: 900 },
      { w: 400, h: 400 },
      { x: 0, y: 0.5 },
    );
    expect(fresh).toEqual({ x: 0, y: 0, w: 9 / 16, h: 1 });
    expect(cropOf({ x: 0, y: 0, w: 0, h: 1 })).toBeNull();
    expect(cropOf("crop")).toBeNull();
  });

  it("moves the window over the picture, never off it", () => {
    expect(moveWindow(picture, window, { x: 50, y: -20 })).toEqual({
      x: 50,
      y: -20,
      w: 400,
      h: 300,
    });
    // As far as the picture's right and top edges.
    expect(moveWindow(picture, window, { x: 900, y: -900 })).toEqual({
      x: 600 - 400,
      y: -150,
      w: 400,
      h: 300,
    });
  });

  it("pans the picture behind the window, never past its edges", () => {
    expect(panPicture(picture, window, { x: 50, y: -20 })).toMatchObject({ x: -150, y: -170 });
    // Dragged far right: the picture's left edge stops at the window's.
    expect(panPicture(picture, window, { x: 900, y: 0 })).toMatchObject({ x: 0 });
    // Far up: its bottom edge stops at the window's bottom.
    expect(panPicture(picture, window, { x: 0, y: -900 })).toMatchObject({ y: 300 - 600 });
  });

  it("trims the window's dragged edges, stopping at the picture and the minimum size", () => {
    expect(trimWindow(picture, window, "w", { x: 30, y: 99 })).toEqual({
      x: 30,
      y: 0,
      w: 370,
      h: 300,
    });
    // Outwards, as far as the picture goes (that's un-cropping).
    expect(trimWindow(picture, window, "se", { x: 900, y: 900 })).toEqual({
      x: 0,
      y: 0,
      w: 600,
      h: 450,
    });
    expect(trimWindow(picture, window, "n", { x: 0, y: 900 })).toMatchObject({
      y: 300 - MIN_WINDOW,
      h: MIN_WINDOW,
    });
  });

  it("scales the picture about the opposite corner, always covering the window", () => {
    // Dragging the bottom-right corner out by 10% of the picture on both axes.
    near(scalePicture(picture, window, "se", { x: 80, y: 60 }), {
      x: -200,
      y: -150,
      w: 880,
      h: 660,
    });
    // Shrunk hard: it stops where the window's right/bottom edges meet the picture's.
    near(scalePicture(picture, window, "se", { x: -2000, y: -2000 }), {
      x: -200,
      y: -150,
      w: 800 * (600 / 800),
      h: 600 * (600 / 800),
    });
    // About the centre (Alt), shrunk hard: it ends exactly around the window.
    const centred = scalePicture(picture, window, "nw", { x: 2000, y: 2000 }, true);
    near(centred, { x: 0, y: 0, w: 400, h: 300 });
    // Never wider than MAX_ZOOM windows.
    expect(scalePicture(picture, window, "se", { x: 1e7, y: 1e7 }).w).toBe(MAX_ZOOM * 400);
  });
});
