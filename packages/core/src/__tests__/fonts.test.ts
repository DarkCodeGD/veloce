import { describe, expect, it } from "vitest";
import { BUNDLED_FONTS, bundledFont, primaryFamily } from "../fonts.js";
import { BUILTIN_THEMES } from "../themes.js";

describe("bundled fonts", () => {
  it("reads the primary family of a CSS stack", () => {
    expect(primaryFamily("'Space Grotesk', system-ui, sans-serif")).toBe("Space Grotesk");
    expect(primaryFamily('"Lora", serif')).toBe("Lora");
    expect(primaryFamily("Inter")).toBe("Inter");
    expect(bundledFont("inter, sans-serif")?.family).toBe("Inter");
    expect(bundledFont("Comic Sans MS, cursive")).toBeUndefined();
  });

  it("covers every font the built-in themes use (they must look the same everywhere)", () => {
    for (const [id, theme] of Object.entries(BUILTIN_THEMES)) {
      for (const stack of Object.values(theme.fonts)) {
        expect(bundledFont(stack), `${id}: ${stack}`).toBeDefined();
      }
    }
    // Each catalog stack starts with its own family.
    for (const font of BUNDLED_FONTS) expect(primaryFamily(font.stack)).toBe(font.family);
  });
});
