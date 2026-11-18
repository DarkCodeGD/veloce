import { describe, expect, it } from "vitest";
import { ariaShortcut, SHORTCUTS, shortcutKeys } from "./shortcuts.js";

describe("shortcut labels", () => {
  it("shows platform keys", () => {
    expect(shortcutKeys(SHORTCUTS.redo, "other")).toEqual(["Ctrl", "Shift", "Z"]);
    expect(shortcutKeys(SHORTCUTS.redo, "mac")).toEqual(["⌘", "⇧", "Z"]);
    expect(shortcutKeys(SHORTCUTS.delete, "other")).toEqual(["Del"]);
    expect(shortcutKeys(SHORTCUTS.moveUp, "mac")).toEqual(["⌥", "↑"]);
  });

  it("maps to aria-keyshortcuts", () => {
    expect(ariaShortcut(SHORTCUTS.undo, "other")).toBe("Control+Z");
    expect(ariaShortcut(SHORTCUTS.undo, "mac")).toBe("Meta+Z");
    expect(ariaShortcut(SHORTCUTS.moveDown, "other")).toBe("Alt+ArrowDown");
  });
});
