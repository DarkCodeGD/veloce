/**
 * The app's command registry (D79 §4, D81) and the built-in commands in it: the canvas tools
 * and everything the Add menu offers. The tool bar, the Add menu and the keyboard read this
 * one list; the menu bar and command palette (roadmap round 5) will too, and plugins will
 * register here the same way.
 *
 * Commands get the editor's state as a context that App keeps current (`setCommandContext`),
 * so a command never reaches into a component.
 */
import {
  Circle,
  Frame,
  Hand,
  ImagePlus,
  type LucideIcon,
  MousePointer2,
  Plus,
  Puzzle,
  Square,
  Type,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { canvasCentre, openAddMenu, pointerOverCanvas } from "./add-menu.js";
import { addLayer, elementInfos, type InsertContext } from "./insert-actions.js";
import { CommandRegistry, type RunOptions } from "./model/command-registry.js";
import { insertables } from "./model/insert.js";
import { SHORTCUTS } from "./model/shortcuts.js";
import { PLATFORM } from "./platform.js";
import { setTool, type Tool, toolStore } from "./tools.js";

/** The editor's state as commands see it: no deck or slide when none is open. */
export type CommandContext = Omit<InsertContext, "deck" | "slideIndex"> &
  Partial<Pick<InsertContext, "deck" | "slideIndex">>;

export const commands = new CommandRegistry<CommandContext, LucideIcon>();

let context: CommandContext = { selection: [], select() {}, editText() {} };
export const setCommandContext = (next: CommandContext) => {
  context = next;
};

export const runCommand = (id: string, options?: RunOptions) => commands.run(id, context, options);
export const isCommandEnabled = (id: string) => commands.isEnabled(id, context);
export const isCommandChecked = (id: string) => commands.get(id)?.checked?.(context) ?? false;
/** The command bound to a key press, if any (and enabled). */
export const commandForKey = (e: KeyboardEvent) => commands.forKey(e, PLATFORM, context);

/** One menu's commands, re-rendering when commands come or go. */
export function useCommands(group: string) {
  useSyncExternalStore(commands.subscribe, commands.version);
  return commands.list(group);
}

/** A slide is open: there's somewhere to add to. */
const onSlide = (c: CommandContext): c is InsertContext =>
  c.deck !== undefined && c.slideIndex !== undefined;

const TOOLS: ReadonlyArray<{ tool: Tool; label: string; icon: LucideIcon; shortcut: string }> = [
  { tool: "select", label: "Select", icon: MousePointer2, shortcut: SHORTCUTS.toolSelect },
  { tool: "frame", label: "Frame", icon: Frame, shortcut: SHORTCUTS.toolFrame },
  { tool: "rect", label: "Rectangle", icon: Square, shortcut: SHORTCUTS.toolRect },
  { tool: "ellipse", label: "Ellipse", icon: Circle, shortcut: SHORTCUTS.toolEllipse },
  { tool: "text", label: "Text", icon: Type, shortcut: SHORTCUTS.toolText },
  { tool: "hand", label: "Hand", icon: Hand, shortcut: SHORTCUTS.toolHand },
];

const ADD_ICONS: Record<string, LucideIcon> = {
  text: Type,
  frame: Frame,
  rect: Square,
  ellipse: Circle,
  image: ImagePlus,
};

let registered = false;

/** Registers the built-ins once (main.tsx, before the first render). */
export function registerBuiltinCommands(): void {
  if (registered) return;
  registered = true;
  for (const { tool, label, icon, shortcut } of TOOLS) {
    commands.register({
      id: `tool.${tool}`,
      label,
      icon,
      shortcut,
      group: "tools",
      enabled: (c) => tool === "select" || onSlide(c),
      checked: () => toolStore.get() === tool,
      run: () => setTool(tool),
    });
  }
  for (const item of insertables(elementInfos())) {
    commands.register({
      id: `add.${item.id}`,
      label: item.label,
      icon: ADD_ICONS[item.id] ?? Puzzle,
      group: "add",
      section: item.group,
      keywords: item.keywords,
      enabled: onSlide,
      run: (c, { at }) => {
        if (onSlide(c)) void addLayer(c, item, at ?? null);
      },
    });
  }
  commands.register({
    id: "add.menu",
    label: "Add…",
    icon: Plus,
    shortcut: SHORTCUTS.addMenu,
    group: "app",
    enabled: onSlide,
    // At the pointer when it's over the canvas (the layer goes there); else from the canvas's
    // centre, adding where a paste would.
    run: (_c, { at }) => {
      const point = at ?? pointerOverCanvas();
      const origin = point ?? canvasCentre();
      openAddMenu({ left: origin.x, top: origin.y, at: point });
    },
  });
}
