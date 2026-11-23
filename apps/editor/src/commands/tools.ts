/**
 * The canvas tools and the Add menu's entries (D81). The tool bar shows the tools; the Add
 * menu and Insert lists every registered element type, so a plugin's element appears in
 * both without editor code.
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
import { canvasCentre, openAddMenu, pointerOverCanvas } from "../add-menu.js";
import { addLayer, elementInfos } from "../insert-actions.js";
import { insertables } from "../model/insert.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import { setTool, type Tool, toolStore } from "../tools.js";
import { type EditorCommand, onSlide } from "./context.js";

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

export function toolCommands(): EditorCommand[] {
  return [
    ...TOOLS.map(
      ({ tool, label, icon, shortcut }): EditorCommand => ({
        id: `tool.${tool}`,
        label,
        icon,
        shortcut,
        group: "tools",
        enabled: (c) => tool === "select" || onSlide(c),
        checked: () => toolStore.get() === tool,
        run: () => setTool(tool),
      }),
    ),
    // Esc leaves a drawing tool before it changes the selection (registered before
    // Select parent, so it wins while a tool is armed).
    {
      id: "tool.cancel",
      label: "Back to Select",
      shortcut: SHORTCUTS.selectParent,
      group: "tools",
      keyWhen: () => toolStore.get() !== "select",
      run: () => setTool("select"),
    },
  ];
}

export function addCommands(): EditorCommand[] {
  return [
    {
      id: "add.menu",
      label: "Add…",
      icon: Plus,
      shortcut: SHORTCUTS.addMenu,
      group: "app",
      menu: "insert",
      section: "menu",
      enabled: onSlide,
      // At the pointer when it's over the canvas (the layer goes there); else from the
      // canvas's centre, adding where a paste would.
      run: (_c, { at }) => {
        const point = at ?? pointerOverCanvas();
        const origin = point ?? canvasCentre();
        openAddMenu({ left: origin.x, top: origin.y, at: point });
      },
    },
    ...insertables(elementInfos()).map(
      (item): EditorCommand => ({
        id: `add.${item.id}`,
        label: item.label,
        icon: ADD_ICONS[item.id] ?? Puzzle,
        group: "add",
        menu: "insert",
        section: item.group,
        keywords: item.keywords,
        enabled: onSlide,
        run: (c, { at }) => {
          if (onSlide(c)) void addLayer(c, item, at ?? null);
        },
      }),
    ),
  ];
}
