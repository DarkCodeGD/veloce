import { describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "./command-registry.js";
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
});
