import { describe, expect, it } from "vitest";
import {
  assetKind,
  deckFontFaces,
  deckFontFamilies,
  deckFontStack,
  fontStackFor,
  formatBytes,
} from "../assets.js";
import { type AssetInfo, AssetInfoSchema } from "../schema/deck.js";

const id = (n: number) => String(n).repeat(64).slice(0, 64);

describe("asset kinds and deck fonts", () => {
  it("classifies importable files", () => {
    expect(assetKind("image/png")).toBe("image");
    expect(assetKind("image/svg+xml")).toBe("image");
    expect(assetKind("font/woff2")).toBe("font");
    expect(assetKind("video/mp4")).toBe("other");
  });

  it("lists the deck's font faces, grouped into families", () => {
    const assets: Record<string, AssetInfo> = {
      [id(3)]: { mime: "font/woff2", bytes: 10, font: { family: "Acme Sans", weight: 700 } },
      [id(1)]: {
        mime: "font/ttf",
        bytes: 10,
        font: { family: "Acme Sans", weight: 400, style: "italic" },
      },
      [id(2)]: {
        mime: "font/woff2",
        bytes: 10,
        font: { family: "Brand Serif", weight: [100, 900] },
      },
      [id(4)]: { mime: "image/png", bytes: 10 },
      [id(5)]: { mime: "font/otf", bytes: 10 }, // no metadata: can't be named, so not listed
    };
    expect(deckFontFaces({ assets })).toEqual([
      { assetId: id(1), mime: "font/ttf", family: "Acme Sans", weight: "400", style: "italic" },
      {
        assetId: id(2),
        mime: "font/woff2",
        family: "Brand Serif",
        weight: "100 900",
        style: "normal",
      },
      { assetId: id(3), mime: "font/woff2", family: "Acme Sans", weight: "700", style: "normal" },
    ]);
    expect(deckFontFamilies({ assets })).toEqual(["Acme Sans", "Brand Serif"]);
    expect(fontStackFor("Acme Sans")).toBe('"Acme Sans", system-ui, sans-serif');
    expect([3_907_925, 128_400, 999_600, 34].map(formatBytes)).toEqual([
      "3.9 MB",
      "128 KB",
      "1.0 MB",
      "34 bytes",
    ]);
    expect(fontStackFor("Caladea", "serif")).toBe('"Caladea", Georgia, serif');
    expect(fontStackFor("Mono", "monospace")).toBe('"Mono", ui-monospace, monospace');
    const serif = { mime: "font/ttf", bytes: 1, font: { family: "Caladea", category: "serif" } };
    expect(deckFontStack({ assets: { ...assets, [id(6)]: serif as AssetInfo } }, "Caladea")).toBe(
      '"Caladea", Georgia, serif',
    );
    expect(deckFontStack({ assets }, "Acme Sans")).toBe('"Acme Sans", system-ui, sans-serif');
  });

  it("only accepts font family names that are safe in a CSS font stack", () => {
    const info = (family: string) => ({ mime: "font/woff2", bytes: 1, font: { family } });
    expect(AssetInfoSchema.safeParse(info("Acme Sans")).success).toBe(true);
    expect(AssetInfoSchema.safeParse(info('Evil", serif; x')).success).toBe(false);
    expect(AssetInfoSchema.safeParse(info("back\\slash")).success).toBe(false);
    expect(AssetInfoSchema.safeParse(info("new\nline")).success).toBe(false);
    expect(AssetInfoSchema.safeParse(info("")).success).toBe(false);
  });
});
