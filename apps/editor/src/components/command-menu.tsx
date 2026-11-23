/**
 * Registry commands as menu items (D81, D89): the menu bar and the tool bar's menus show a
 * command's label, shortcut, enabled and checked state exactly as the registry has them.
 */
import { commands, isCommandChecked, isCommandEnabled, runCommand } from "../editor-commands.js";
import type { MenuItem } from "./MenuButton.js";

export function commandMenuItem(
  id: string,
  { icon = false, then }: { icon?: boolean; then?: () => void } = {},
): MenuItem {
  const command = commands.get(id);
  const Icon = icon ? command?.icon : undefined;
  return {
    id,
    label: command?.label ?? id,
    ...(Icon && { icon: <Icon size={14} /> }),
    ...(command?.shortcut && { shortcut: command.shortcut }),
    ...(command?.checked && { checked: isCommandChecked(id), checkbox: command.toggle === true }),
    disabled: !isCommandEnabled(id),
    onSelect: () => {
      then?.();
      runCommand(id);
    },
  };
}
