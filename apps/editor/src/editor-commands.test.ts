import { createBuiltinRegistry } from "@veloce/builtins";
import { describe, expect, it, vi } from "vitest";
import { commands, MENU_BAR, registerBuiltinCommands } from "./editor-commands.js";

// The real plugin registry (the Insert menu lists its elements), without a server connection.
vi.mock("./editor-context.js", () => ({
  registry: createBuiltinRegistry(),
  client: {},
  assetUrl: () => "",
  resolvedSizing: () => ({ width: "auto", height: "auto" }),
}));

registerBuiltinCommands();

/**
 * Keys shared on purpose (D89): the context picks one, and the command listed first must be
 * registered first (it wins when both apply).
 */
const SHARED_KEYS: Record<string, string[]> = {
  Escape: ["tool.cancel", "edit.selectParent"],
  Enter: ["edit.editText", "edit.selectChildren"],
  Delete: ["edit.delete", "slide.delete"],
  Backspace: ["edit.delete", "slide.delete"],
  "Alt+ArrowUp": ["slide.moveUp", "arrange.moveUp"],
  "Alt+ArrowDown": ["slide.moveDown", "arrange.moveDown"],
};

describe("built-in commands (D89)", () => {
  it("gives every menu of the menu bar something to show", () => {
    for (const { id } of MENU_BAR) expect(commands.menu(id).flat().length).toBeGreaterThan(0);
    // Every menu a command names is on the bar.
    const menus = new Set<string>(MENU_BAR.map((m) => m.id));
    for (const command of commands.list()) {
      if (command.menu) expect(menus, command.id).toContain(command.menu);
    }
  });

  it("has no accidental shortcut clashes", () => {
    const byKey = new Map<string, string[]>();
    for (const command of commands.list()) {
      const keys = command.shortcut ? [command.shortcut, ...(command.moreKeys ?? [])] : [];
      for (const key of keys) byKey.set(key, [...(byKey.get(key) ?? []), command.id]);
    }
    const shared = Object.fromEntries([...byKey].filter(([, ids]) => ids.length > 1));
    expect(shared).toEqual(SHARED_KEYS);
  });

  it("moved every old hard-coded shortcut into the registry", () => {
    const ids = new Set(commands.list().map((c) => c.id));
    for (const id of [
      "edit.undo",
      "edit.redo",
      "edit.duplicate",
      "edit.delete",
      "edit.selectAll",
      "arrange.group",
      "arrange.ungroup",
      "arrange.align.left",
      "arrange.distribute.vertical",
      "arrange.moveUp",
      "slide.next",
      "slide.last",
      "view.zoomIn",
      "view.zoomToSelection",
    ]) {
      expect(ids).toContain(id);
    }
  });
});
