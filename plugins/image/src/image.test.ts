// @vitest-environment happy-dom
import { checkElementConformance } from "@veloce/plugin-api";
import { describe, expect, it } from "vitest";
import { ImagePropsSchema, imageElement } from "./index.js";

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
});
