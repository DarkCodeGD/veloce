// @vitest-environment happy-dom
import { checkElementConformance } from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import { ImagePropsSchema, imageElement, viewBox } from "./index.js";

const ID = "ab".repeat(32);

describe("image element", () => {
  it("passes the plugin conformance kit", async () => {
    const report = await checkElementConformance(imageElement, {
      updates: [
        {
          asset: `asset:${ID}`,
          alt: "Logo",
          fit: "contain",
          focus: { x: 0.5, y: 0 },
          crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
          radius: "$radius.lg",
        },
      ],
    });
    expect(report.failures).toEqual([]);
  });

  it("loads the asset through the renderer's URL resolver, with alt text", () => {
    const container = document.createElement("div");
    const instance = imageElement.mount(
      container,
      { asset: `asset:${ID}`, alt: "Team photo", focus: { x: 0.25, y: 0 } },
      { assetUrl: (id) => `blob:test/${id.slice(0, 4)}` },
    );
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:test/abab");
    expect(img.alt).toBe("Team photo");
    expect(img.style.objectFit).toBe("cover");
    expect(img.style.objectPosition).toBe("25% 0%");
    instance.dispose();
  });

  it("requires alt text and refuses remote URLs", () => {
    expect(ImagePropsSchema.safeParse({ asset: `asset:${ID}` }).success).toBe(false);
    expect(
      ImagePropsSchema.safeParse({ asset: "https://example.com/x.png", alt: "" }).success,
    ).toBe(false);
  });

  it("points a tiled image at frame image fills", () => {
    const result = ImagePropsSchema.safeParse({ asset: `asset:${ID}`, alt: "", fit: "tile" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/give a frame an image fill.*"fit": "tile"/);
  });

  it("crops through object-view-box, in fractions of the picture (D84)", () => {
    expect(viewBox({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })).toBe("inset(20% 40% 20% 10%)");
    expect(viewBox({ x: 0, y: 0, w: 1, h: 1 })).toBe("inset(0% 0% 0% 0%)");
    // Float dust never turns into a negative inset.
    expect(viewBox({ x: 0.7, y: 0, w: 0.30000001, h: 1 })).toBe("inset(0% 0% 0% 70%)");
  });

  it("keeps a crop on the picture, and says how", () => {
    const parse = (crop: unknown) =>
      ImagePropsSchema.safeParse({ asset: `asset:${ID}`, alt: "", crop });
    expect(parse({ x: 0.25, y: 0, w: 0.5, h: 1 }).success).toBe(true);
    const off = parse({ x: 0.6, y: 0, w: 0.5, h: 1 });
    expect(off.error?.issues[0]?.message).toMatch(/x \+ w and y \+ h can't exceed 1/);
    expect(parse({ x: 0, y: 0, w: 0, h: 1 }).success).toBe(false);
    expect(parse({ x: 0, y: 0, w: 1 }).success).toBe(false);
  });
});
