/**
 * The tool bar in the top bar's centre (D62, D81): Select, Frame, Shape (Rectangle or Ellipse),
 * Text, Image, Hand, and ➕ for the Add menu. A drawing tool clicks or drags a new layer onto
 * the canvas; Image picks a file. Every button is a registry command, so its label, icon and
 * shortcut (in the tooltip) are the ones the keyboard and the Add menu use.
 *
 * Narrow windows fold it into one menu, so the bar never wraps or pushes the AI controls off.
 */
import { ChevronDown, ImagePlus, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { openAddMenu } from "../add-menu.js";
import { commands, isCommandChecked, isCommandEnabled, runCommand } from "../editor-commands.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import { shortcutAttrs } from "../platform.js";
import { useTool } from "../tools.js";
import { MenuButton } from "./MenuButton.js";

/** The tool buttons, left to right; the two shapes share one slot. */
const SLOTS = [
  "tool.select",
  "tool.frame",
  "shape",
  "tool.text",
  "add.image",
  "tool.hand",
] as const;
const SHAPES = ["tool.rect", "tool.ellipse"] as const;

export function ToolBar() {
  const tool = useTool(); // re-render when the tool changes
  // The shape slot shows the last shape tool used (Figma).
  const [shape, setShape] = useState<(typeof SHAPES)[number]>("tool.rect");
  const shownShape = tool === "ellipse" ? "tool.ellipse" : tool === "rect" ? "tool.rect" : shape;
  const addButton = useRef<HTMLButtonElement>(null);

  const openAdd = () => {
    const rect = addButton.current?.getBoundingClientRect();
    if (rect)
      openAddMenu({
        left: rect.left,
        top: rect.bottom + 4,
        at: null,
        returnFocus: addButton.current,
      });
  };

  return (
    <div className="toolbar-slot">
      <div className="toolbar" role="toolbar" aria-label="Tools">
        {SLOTS.map((slot) =>
          slot === "shape" ? (
            <div key={slot} className="tool-split">
              <ToolButton id={shownShape} />
              <MenuButton
                label="Shapes"
                tip="Shapes"
                className="tool-more"
                trigger={<ChevronDown size={12} aria-hidden="true" />}
                items={SHAPES.map((id) => menuItem(id, () => setShape(id)))}
              />
            </div>
          ) : (
            <ToolButton key={slot} id={slot} />
          ),
        )}
        <span className="toolbar-divider" aria-hidden="true" />
        <button
          ref={addButton}
          type="button"
          className="tool-button"
          aria-label="Add…"
          aria-haspopup="listbox"
          data-tip="Add…"
          {...shortcutAttrs(SHORTCUTS.addMenu)}
          disabled={!isCommandEnabled("add.menu")}
          onClick={openAdd}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      {/* Narrow windows: the same tools, folded into one menu (D62 §4). */}
      <MenuButton
        label="Tools"
        className="toolbar-folded"
        items={[
          ...["tool.select", "tool.frame", ...SHAPES, "tool.text", "add.image", "tool.hand"].map(
            (id) => menuItem(id),
          ),
          {
            label: "Add…",
            icon: <Plus size={14} />,
            shortcut: SHORTCUTS.addMenu,
            disabled: !isCommandEnabled("add.menu"),
            onSelect: openAdd,
          },
        ]}
      />
    </div>
  );
}

/** A menu entry for a registry command. */
function menuItem(id: string, then?: () => void) {
  const command = commands.get(id);
  const Icon = command?.icon ?? ImagePlus;
  const isTool = id.startsWith("tool.");
  return {
    label: command?.label ?? id,
    icon: <Icon size={14} />,
    ...(command?.shortcut && { shortcut: command.shortcut }),
    ...(isTool && { checked: isCommandChecked(id) }),
    disabled: !isCommandEnabled(id),
    onSelect: () => {
      then?.();
      runCommand(id);
    },
  };
}

/** One command as an icon button: pressed while it's the active tool. */
function ToolButton({ id }: { id: string }) {
  const command = commands.get(id);
  if (!command) return null;
  const Icon = command.icon;
  const isTool = id.startsWith("tool.");
  const label = command.label.replace(/…$/, "");
  return (
    <button
      type="button"
      className={`tool-button${isCommandChecked(id) ? " is-active" : ""}`}
      aria-label={command.label}
      {...(isTool && { "aria-pressed": isCommandChecked(id) })}
      data-tip={label}
      {...(command.shortcut && shortcutAttrs(command.shortcut))}
      disabled={!isCommandEnabled(id)}
      onClick={() => runCommand(id)}
    >
      {Icon && <Icon size={16} aria-hidden="true" />}
    </button>
  );
}
