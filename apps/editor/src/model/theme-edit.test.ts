import {
  applyTransaction,
  createDeck,
  MIDNIGHT_THEME,
  STUDIO_THEME,
  type Theme,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  builtinIdOf,
  contrastIssues,
  nearestColorToken,
  setThemeCommand,
  toHex6,
  withColor,
  withFont,
} from "./theme-edit.js";

describe("theme editing", () => {
  it("recognizes untouched built-in themes, and names edited ones custom", () => {
    expect(builtinIdOf(MIDNIGHT_THEME)).toBe("midnight");
    const edited = withColor(MIDNIGHT_THEME, "primary", "#ff0000");
    expect(builtinIdOf(edited)).toBeNull();
    expect(edited.name).toBe("Midnight (custom)");
    expect(withFont(edited, "heading", "Lora, Georgia, serif").name).toBe("Midnight (custom)");
    expect(MIDNIGHT_THEME.colors.primary).not.toBe("#ff0000"); // never mutates
  });

  it("makes one valid, undoable setTheme transaction", () => {
    const deck = createDeck({ title: "t" });
    const theme = withFont(STUDIO_THEME, "body", "Lora, Georgia, serif");
    const command = setThemeCommand(theme, 'Set theme "Studio"');
    const result = applyTransaction(deck, {
      origin: "user",
      label: command.label,
      ops: command.ops,
    });
    expect(result.ok && result.deck.theme.fonts.body).toBe("Lora, Georgia, serif");
  });

  it("converts colors for the native picker", () => {
    expect(toHex6("#ABC")).toBe("#aabbcc");
    expect(toHex6("#11223344")).toBe("#112233");
    expect(toHex6("nope")).toBeNull();
  });

  it("snaps a custom color to the closest theme color", () => {
    expect(nearestColorToken(MIDNIGHT_THEME, "#8a6efe")).toBe("$color.primary");
    expect(nearestColorToken(MIDNIGHT_THEME, "#0b1125")).toBe("$color.background");
    expect(nearestColorToken(MIDNIGHT_THEME, "garbage")).toBeNull();
  });

  it("flags palette pairs that are hard to read", () => {
    expect(contrastIssues(MIDNIGHT_THEME)).toEqual([]);
    const bad: Theme = withColor(MIDNIGHT_THEME, "muted", "#2a3360");
    const issues = contrastIssues(bad);
    expect(issues.map((i) => i.pair)).toEqual(["muted on background", "muted on surface"]);
    expect(issues[0]?.needs).toBe(4.5);
    expect(issues[0]?.ratio).toBeLessThan(4.5);
  });
});
