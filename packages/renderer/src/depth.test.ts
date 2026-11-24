import { element, frame } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { drawnCss, frameSpaceCss } from "./layout.js";

const box = (extra = {}) => element("shape", { shape: "rect" }, { id: "a", ...extra });

describe("2.5D CSS (D112)", () => {
  it("draws rest depth exactly, adds motion's z, and leaves flat layers untouched", () => {
    expect(drawnCss(box(), null)).toEqual({});
    expect(drawnCss(box({ depth: 200 }), null).transform).toBe("translate3d(0px, 0px, 200px)");
    expect(
      drawnCss(box({ depth: 200, rotation: 10 }), null, { x: 5, z: -50.123456 }).transform,
    ).toBe("translate3d(5px, 0px, 149.8765px) rotate(10deg)");
  });

  it("gives a frame with perspective its 3D space, and nothing otherwise", () => {
    expect(frameSpaceCss(frame({ id: "f", perspective: 1200 }))).toEqual({ perspective: "1200px" });
    expect(frameSpaceCss(frame({ id: "f" }))).toEqual({});
  });
});
