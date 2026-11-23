/**
 * The app's command registry (D79 §4, D81, D89) and the built-in commands in it. The menu
 * bar, the tool bar, the Add menu and the keyboard read this one list; the command palette
 * will too, and plugins will register here the same way.
 *
 * Commands get the editor's state as a context that App keeps current (`setCommandContext`),
 * so a command never reaches into a component.
 */
import type { LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { arrangeCommands } from "./commands/arrange.js";
import type { CommandContext } from "./commands/context.js";
import { editCommands } from "./commands/edit.js";
import { fileCommands, helpCommands } from "./commands/file.js";
import { slideCommands } from "./commands/slide.js";
import { addCommands, toolCommands } from "./commands/tools.js";
import { viewCommands } from "./commands/view.js";
import { deckKeysPassThrough, typing } from "./keyboard.js";
import { CommandRegistry, type KeyTarget, type RunOptions } from "./model/command-registry.js";
import { PLATFORM } from "./platform.js";

export type { CommandContext } from "./commands/context.js";

export const commands = new CommandRegistry<CommandContext, LucideIcon>();

let context: CommandContext = {
  selection: [],
  select() {},
  editText() {},
  goToSlide() {},
  panel: "slides",
  showPanel() {},
  follow: true,
  setFollow() {},
};
export const setCommandContext = (next: CommandContext) => {
  context = next;
};

export const runCommand = (id: string, options?: RunOptions) => commands.run(id, context, options);
export const isCommandEnabled = (id: string) => commands.isEnabled(id, context);
export const isCommandChecked = (id: string) => commands.get(id)?.checked?.(context) ?? false;

/** One list's commands ("add"), re-rendering when commands come or go. */
export function useCommands(group: string) {
  useSyncExternalStore(commands.subscribe, commands.version);
  return commands.list(group);
}

/** The menu bar's menus, left to right (D89). Commands name theirs in `menu`. */
export const MENU_BAR = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "insert", label: "Insert" },
  { id: "slide", label: "Slide" },
  { id: "arrange", label: "Arrange" },
  { id: "help", label: "Help" },
] as const;

let registered = false;

/**
 * Registers the built-ins once (main.tsx, before the first render). Order matters where
 * commands share a key: the first that applies wins (Esc leaves a tool before it selects
 * the parent; Delete removes layers before it removes the slide).
 */
export function registerBuiltinCommands(): void {
  if (registered) return;
  registered = true;
  for (const list of [
    toolCommands(),
    fileCommands(),
    editCommands(),
    viewCommands(),
    addCommands(),
    slideCommands(),
    arrangeCommands(),
    helpCommands(),
  ]) {
    for (const command of list) commands.register(command);
  }
}

/** Where focus is, for the keys: the editor, a dropdown (no text of its own), or a field. */
function keyTarget(target: EventTarget | null): KeyTarget {
  if (!typing(target)) return "editor";
  return deckKeysPassThrough(target) ? "dropdown" : "field";
}

/**
 * The editor's keyboard (D89): every shortcut is a registry command, found by its key.
 *
 * - Capture phase, for the few that work in any field (zoom): fields that keep their keys
 *   from the editor (`stopPropagation`) can't swallow them.
 * - Bubble phase, for the rest: a menu, the layer rename field or the text editor handle
 *   their own keys first and stop them.
 *
 * A modal dialog owns the keyboard (Delete on its button must not delete layers). Installed
 * once (main.tsx); returns a remover for tests.
 */
export function installCommandKeys(target: Window = window): () => void {
  const runFor = (e: KeyboardEvent, where: KeyTarget, phase: "capture" | "bubble") => {
    const command = commands.forKey(e, PLATFORM, context, where);
    if (!command || (command.inFields === "always") !== (phase === "capture")) return;
    e.preventDefault();
    commands.run(command.id, context);
  };
  const onCapture = (e: KeyboardEvent) => runFor(e, "field", "capture");
  const onBubble = (e: KeyboardEvent) => {
    if (e.target instanceof Element && e.target.closest("dialog[open]")) return;
    runFor(e, keyTarget(e.target), "bubble");
  };
  target.addEventListener("keydown", onCapture, true);
  target.addEventListener("keydown", onBubble);
  return () => {
    target.removeEventListener("keydown", onCapture, true);
    target.removeEventListener("keydown", onBubble);
  };
}
