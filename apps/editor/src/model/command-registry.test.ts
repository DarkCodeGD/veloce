import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, splitSections } from "./command-registry.js";
import type { KeyPress } from "./shortcuts.js";

interface Ctx {
  hasDeck: boolean;
}
const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  code: `Key${key.toUpperCase()}`,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("command registry (D79 §4, D81)", () => {
  it("lists commands by menu, in registration order, and unregisters", () => {
    const registry = new CommandRegistry<Ctx>();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register({ id: "tool.select", label: "Select", group: "tools", run() {} });
    const remove = registry.register({ id: "add.text", label: "Text", group: "add", run() {} });
    registry.register({ id: "tool.text", label: "Text", group: "tools", run() {} });
    expect(registry.list("tools").map((c) => c.id)).toEqual(["tool.select", "tool.text"]);
    expect(registry.list()).toHaveLength(3);
    const before = registry.version();
    remove();
    remove(); // twice is harmless
    expect(registry.get("add.text")).toBeUndefined();
    expect(registry.version()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(4);
    expect(() =>
      registry.register({ id: "tool.text", label: "Again", group: "tools", run() {} }),
    ).toThrow(/already registered/);
  });

  it("runs only enabled commands, with the context and where it was invoked", () => {
    const registry = new CommandRegistry<Ctx>();
    const run = vi.fn();
    registry.register({
      id: "add.rect",
      label: "Rectangle",
      group: "add",
      enabled: (c) => c.hasDeck,
      run,
    });
    expect(registry.run("add.rect", { hasDeck: false })).toBe(false);
    expect(registry.run("nope", { hasDeck: true })).toBe(false);
    expect(registry.run("add.rect", { hasDeck: true }, { at: { x: 5, y: 6 } })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ hasDeck: true }, { at: { x: 5, y: 6 } });
  });

  it("finds the command for a key press, if it's enabled", () => {
    const registry = new CommandRegistry<Ctx>();
    registry.register({
      id: "tool.text",
      label: "Text",
      group: "tools",
      shortcut: "T",
      enabled: (c) => c.hasDeck,
      run() {},
    });
    registry.register({
      id: "add.menu",
      label: "Add…",
      group: "add",
      shortcut: "Shift+A",
      run() {},
    });
    expect(registry.forKey(press("t"), "other", { hasDeck: true })?.id).toBe("tool.text");
    expect(registry.forKey(press("t"), "other", { hasDeck: false })).toBeUndefined();
    expect(registry.forKey(press("A", { shiftKey: true }), "other", { hasDeck: false })?.id).toBe(
      "add.menu",
    );
    expect(registry.forKey(press("a"), "other", { hasDeck: true })).toBeUndefined();
  });

  it("matches more keys, its own matcher, and never the browser's keys (D89)", () => {
    const registry = new CommandRegistry<Ctx>();
    registry.register({
      id: "edit.redo",
      label: "Redo",
      group: "edit",
      shortcut: "Mod+Shift+Z",
      moreKeys: ["Mod+Y"],
      run() {},
    });
    registry.register({
      id: "view.zoomIn",
      label: "Zoom in",
      group: "view",
      shortcut: "Mod+=",
      matchKey: (e) => e.ctrlKey && (e.key === "=" || e.key === "+"),
      run() {},
    });
    registry.register({
      id: "edit.copy",
      label: "Copy",
      group: "edit",
      shortcut: "Mod+C",
      matchKey: () => false,
      run() {},
    });
    const ctx = { hasDeck: true };
    expect(registry.forKey(press("y", { ctrlKey: true }), "other", ctx)?.id).toBe("edit.redo");
    expect(registry.forKey(press("Z", { ctrlKey: true, shiftKey: true }), "other", ctx)?.id).toBe(
      "edit.redo",
    );
    // "+" typed with Shift still zooms: the matcher, not the exact-modifier rule, decides.
    expect(registry.forKey(press("+", { ctrlKey: true, shiftKey: true }), "other", ctx)?.id).toBe(
      "view.zoomIn",
    );
    expect(registry.forKey(press("c", { ctrlKey: true }), "other", ctx)).toBeUndefined();
  });

  it("leaves a field's keys to it, except commands that work in fields", () => {
    const registry = new CommandRegistry<Ctx>();
    registry.register({ id: "tool.text", label: "Text", group: "tools", shortcut: "T", run() {} });
    registry.register({
      id: "edit.undo",
      label: "Undo",
      group: "edit",
      shortcut: "Mod+Z",
      inFields: "dropdown",
      run() {},
    });
    registry.register({
      id: "view.zoomOut",
      label: "Zoom out",
      group: "view",
      shortcut: "Mod+-",
      inFields: "always",
      run() {},
    });
    const ctx = { hasDeck: true };
    const undo = press("z", { ctrlKey: true });
    const zoom = { ...press("-", { ctrlKey: true }), code: "Minus" };
    expect(registry.forKey(press("t"), "other", ctx, "field")).toBeUndefined();
    expect(registry.forKey(press("t"), "other", ctx, "dropdown")).toBeUndefined();
    expect(registry.forKey(undo, "other", ctx, "field")).toBeUndefined();
    expect(registry.forKey(undo, "other", ctx, "dropdown")?.id).toBe("edit.undo");
    expect(registry.forKey(undo, "other", ctx, "editor")?.id).toBe("edit.undo");
    expect(registry.forKey(zoom, "other", ctx, "field")?.id).toBe("view.zoomOut");
  });

  it("ignores a held-down key unless the command repeats", () => {
    const registry = new CommandRegistry<Ctx>();
    registry.register({ id: "tool.text", label: "Text", group: "tools", shortcut: "T", run() {} });
    registry.register({
      id: "slide.next",
      label: "Next slide",
      group: "slide",
      shortcut: "ArrowDown",
      repeat: true,
      run() {},
    });
    const ctx = { hasDeck: true };
    expect(registry.forKey({ ...press("t"), repeat: true }, "other", ctx)).toBeUndefined();
    expect(
      registry.forKey({ ...press("ArrowDown"), code: "ArrowDown", repeat: true }, "other", ctx)?.id,
    ).toBe("slide.next");
  });

  it("gives one key to the first command that applies (Enter: edit text, else go inside)", () => {
    interface Sel {
      text: boolean;
      frame: boolean;
      inList: boolean;
    }
    const registry = new CommandRegistry<Sel>();
    registry.register({
      id: "edit.editText",
      label: "Edit text",
      group: "edit",
      shortcut: "Enter",
      enabled: (c) => c.text,
      run() {},
    });
    registry.register({
      id: "edit.selectChildren",
      label: "Select children",
      group: "edit",
      shortcut: "Enter",
      enabled: (c) => c.frame,
      run() {},
    });
    registry.register({
      id: "slide.delete",
      label: "Delete slide",
      group: "slide",
      shortcut: "Delete",
      keyWhen: (c) => c.inList,
      run() {},
    });
    const enter = { ...press("Enter"), code: "Enter" };
    const del = { ...press("Delete"), code: "Delete" };
    const at = (c: Partial<Sel>) => ({ text: false, frame: false, inList: false, ...c });
    expect(registry.forKey(enter, "other", at({ text: true }))?.id).toBe("edit.editText");
    expect(registry.forKey(enter, "other", at({ frame: true }))?.id).toBe("edit.selectChildren");
    expect(registry.forKey(enter, "other", at({}))).toBeUndefined();
    // keyWhen limits the key, not the command: a menu still runs it.
    expect(registry.forKey(del, "other", at({}))).toBeUndefined();
    expect(registry.forKey(del, "other", at({ inList: true }))?.id).toBe("slide.delete");
    expect(registry.run("slide.delete", at({}))).toBe(true);
  });

  it("lists a menu bar menu in sections", () => {
    const registry = new CommandRegistry<Ctx>();
    const add = (id: string, menu: string, section: string) =>
      registry.register({ id, label: id, group: "x", menu, section, run() {} });
    add("undo", "edit", "history");
    add("redo", "edit", "history");
    add("zoom", "view", "zoom");
    add("copy", "edit", "clipboard");
    expect(registry.menu("edit").map((s) => s.map((c) => c.id))).toEqual([
      ["undo", "redo"],
      ["copy"],
    ]);
    expect(registry.menu("help")).toEqual([]);
    expect(
      splitSections([{ section: "a" }, { section: "b" }, { section: "a" }]).map((g) => g.length),
    ).toEqual([1, 1, 1]);
  });
});
