import { describe, expect, it } from "vitest";
import {
  ariaShortcut,
  type KeyPress,
  matchesShortcut,
  proseMirrorKey,
  SHORTCUTS,
  shortcutKeys,
} from "./shortcuts.js";

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

  it("maps to ProseMirror keymap names for the text editor", () => {
    expect(proseMirrorKey(SHORTCUTS.textAlignCenter)).toBe("Mod-Shift-e");
    expect(proseMirrorKey("Mod+B")).toBe("Mod-b");
    expect(proseMirrorKey("Alt+ArrowUp")).toBe("Alt-ArrowUp");
  });
});

describe("matching key presses (D81)", () => {
  const press = (key: string, code: string, mods: Partial<KeyPress> = {}): KeyPress => ({
    key,
    code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("needs exactly the spec's modifiers", () => {
    expect(matchesShortcut(press("t", "KeyT"), SHORTCUTS.toolText, "other")).toBe(true);
    expect(
      matchesShortcut(press("T", "KeyT", { shiftKey: true }), SHORTCUTS.toolText, "other"),
    ).toBe(false);
    expect(
      matchesShortcut(press("t", "KeyT", { ctrlKey: true }), SHORTCUTS.toolText, "other"),
    ).toBe(false);
    expect(
      matchesShortcut(press("A", "KeyA", { shiftKey: true }), SHORTCUTS.addMenu, "other"),
    ).toBe(true);
    expect(matchesShortcut(press("a", "KeyA"), SHORTCUTS.addMenu, "other")).toBe(false);
    expect(
      matchesShortcut(press("a", "KeyA", { ctrlKey: true }), SHORTCUTS.selectSiblings, "other"),
    ).toBe(true);
  });

  it("reads Mod as Ctrl, or ⌘ on macOS (and not the other one)", () => {
    const ctrlZ = press("z", "KeyZ", { ctrlKey: true });
    const cmdZ = press("z", "KeyZ", { metaKey: true });
    expect(matchesShortcut(ctrlZ, SHORTCUTS.undo, "other")).toBe(true);
    expect(matchesShortcut(cmdZ, SHORTCUTS.undo, "other")).toBe(false);
    expect(matchesShortcut(cmdZ, SHORTCUTS.undo, "mac")).toBe(true);
    expect(matchesShortcut(ctrlZ, SHORTCUTS.undo, "mac")).toBe(false);
  });

  it("matches letters as typed (any layout), but by physical key with Alt", () => {
    // AZERTY: the key labelled A sits where QWERTY has Q.
    expect(
      matchesShortcut(press("a", "KeyQ", { shiftKey: true, key: "A" }), SHORTCUTS.addMenu, "other"),
    ).toBe(true);
    // macOS Alt+A types "å".
    expect(matchesShortcut(press("å", "KeyA", { altKey: true }), SHORTCUTS.alignLeft, "mac")).toBe(
      true,
    );
    expect(
      matchesShortcut(press("!", "Digit1", { shiftKey: true }), SHORTCUTS.zoomToFit, "other"),
    ).toBe(true);
    expect(matchesShortcut(press("F2", "F2"), SHORTCUTS.rename, "other")).toBe(true);
  });
});
