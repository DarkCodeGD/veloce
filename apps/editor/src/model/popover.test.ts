import { describe, expect, it } from "vitest";
import { placePopover } from "./popover.js";

const viewport = { width: 1400, height: 900 };
const size = { width: 240, height: 300 };
const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("placePopover", () => {
  it("goes left of the panel, level with the trigger", () => {
    const inspector = box(1080, 0, 320, 900);
    expect(placePopover(box(1180, 400, 16, 16), inspector, size, viewport)).toEqual({
      x: 1080 - 8 - 240,
      y: 400,
    });
  });

  it("stays inside the window vertically", () => {
    const inspector = box(1080, 0, 320, 900);
    const low = placePopover(box(1180, 850, 16, 16), inspector, size, viewport);
    expect(low.y).toBe(900 - 8 - 300);
    const high = placePopover(box(1180, -40, 16, 16), inspector, size, viewport);
    expect(high.y).toBe(8);
  });

  it("goes right of a panel on the left edge", () => {
    expect(placePopover(box(100, 200, 16, 16), box(0, 0, 300, 900), size, viewport)).toEqual({
      x: 308,
      y: 200,
    });
  });

  it("with no room beside the panel: below the trigger, else above, never off-screen", () => {
    const narrow = { width: 400, height: 900 };
    const panel = box(80, 0, 320, 900);
    expect(placePopover(box(300, 100, 16, 16), panel, size, narrow)).toEqual({ x: 152, y: 124 });
    expect(placePopover(box(300, 700, 16, 16), panel, size, narrow)).toEqual({ x: 152, y: 392 });
    // No panel (the text toolbar): same rules.
    expect(placePopover(box(10, 100, 16, 16), null, size, viewport)).toEqual({ x: 10, y: 124 });
  });

  it("a window smaller than the popover pins it to the top-left margin", () => {
    expect(placePopover(box(50, 50, 16, 16), null, size, { width: 200, height: 200 })).toEqual({
      x: 8,
      y: 8,
    });
  });
});
