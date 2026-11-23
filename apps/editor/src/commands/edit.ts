/**
 * The Edit menu (D89): undo and redo, the clipboard, duplicate and delete, and moving the
 * selection through the layer tree.
 */
import { redo, run, undo } from "../actions.js";
import { deleteNodes, duplicateNodes } from "../model/commands.js";
import {
  editableText,
  selectFirstChild,
  selectParents,
  selectSiblings,
} from "../model/selection.js";
import { SHORTCUTS, shortcutKeys } from "../model/shortcuts.js";
import { PLATFORM } from "../platform.js";
import { showToast } from "../toasts.js";
import { type EditorCommand, hasSelection, onlySelected, onSlide } from "./context.js";

/**
 * Cut, copy and paste from the menu: the same clipboard events the keys fire (useClipboard
 * handles both), so the system clipboard carries layers either way. Browsers let a click
 * copy but never read the clipboard (Google Docs has the same limit): then the toast names
 * the key. The desktop app (Phase 6) pastes from the menu too.
 */
function clipboard(action: "cut" | "copy" | "paste", shortcut: string): void {
  let done = false;
  try {
    done = document.execCommand(action);
  } catch {
    // Some browsers throw instead of returning false.
  }
  if (!done) {
    const keys = shortcutKeys(shortcut, PLATFORM).join(PLATFORM === "mac" ? "" : "+");
    showToast({
      message: `Your browser doesn't let menus use the clipboard: press ${keys}`,
      tone: "info",
    });
  }
}

/** The browser's clipboard events carry these keys (useClipboard), never the registry. */
const browserKey = () => false;

export function editCommands(): EditorCommand[] {
  return [
    {
      id: "edit.undo",
      label: "Undo",
      shortcut: SHORTCUTS.undo,
      group: "edit",
      menu: "edit",
      section: "history",
      inFields: "dropdown",
      repeat: true,
      run: undo,
    },
    {
      id: "edit.redo",
      label: "Redo",
      shortcut: SHORTCUTS.redo,
      moreKeys: [SHORTCUTS.redoAlt],
      group: "edit",
      menu: "edit",
      section: "history",
      inFields: "dropdown",
      repeat: true,
      run: redo,
    },
    {
      id: "edit.cut",
      label: "Cut",
      shortcut: SHORTCUTS.cut,
      matchKey: browserKey,
      group: "edit",
      menu: "edit",
      section: "clipboard",
      enabled: hasSelection,
      run: () => clipboard("cut", SHORTCUTS.cut),
    },
    {
      id: "edit.copy",
      label: "Copy",
      shortcut: SHORTCUTS.copy,
      matchKey: browserKey,
      group: "edit",
      menu: "edit",
      section: "clipboard",
      enabled: hasSelection,
      run: () => clipboard("copy", SHORTCUTS.copy),
    },
    {
      id: "edit.paste",
      label: "Paste",
      shortcut: SHORTCUTS.paste,
      matchKey: browserKey,
      group: "edit",
      menu: "edit",
      section: "clipboard",
      enabled: onSlide,
      run: () => clipboard("paste", SHORTCUTS.paste),
    },
    {
      id: "edit.duplicate",
      label: "Duplicate",
      shortcut: SHORTCUTS.duplicate,
      group: "edit",
      menu: "edit",
      section: "clipboard",
      repeat: true,
      enabled: hasSelection,
      run: (c) => {
        if (!hasSelection(c)) return;
        const command = duplicateNodes(c.slideIndex, c.selection);
        void run(command).then((ok) => ok && c.select(command?.select ?? []));
      },
    },
    {
      id: "edit.delete",
      label: "Delete",
      shortcut: SHORTCUTS.delete,
      moreKeys: [SHORTCUTS.backspace],
      group: "edit",
      menu: "edit",
      section: "clipboard",
      enabled: hasSelection,
      run: (c) => {
        if (!hasSelection(c)) return;
        void run(deleteNodes(c.slideIndex, c.selection), { undoToast: true }).then(
          (ok) => ok && c.select([]),
        );
      },
    },
    {
      id: "edit.selectAll",
      label: "Select all",
      shortcut: SHORTCUTS.selectSiblings,
      keywords: "siblings everything",
      group: "edit",
      menu: "edit",
      section: "select",
      enabled: onSlide,
      run: (c) => {
        if (onSlide(c)) c.select(selectSiblings(c.slideIndex, c.selection));
      },
    },
    {
      id: "edit.selectParent",
      label: "Select parent",
      shortcut: SHORTCUTS.selectParent,
      keywords: "up out frame",
      group: "edit",
      menu: "edit",
      section: "select",
      enabled: hasSelection,
      run: (c) => {
        if (onSlide(c)) c.select(selectParents(c.slideIndex, c.selection));
      },
    },
    // Enter: a text layer starts typing, all text selected (Figma); a frame goes inside.
    {
      id: "edit.editText",
      label: "Edit text",
      shortcut: SHORTCUTS.enter,
      keywords: "type write",
      group: "edit",
      menu: "edit",
      section: "select",
      enabled: (c) => onSlide(c) && editableText(c.slideIndex, onlySelected(c)),
      run: (c) => {
        const id = onlySelected(c);
        if (id) c.editText(id);
      },
    },
    {
      id: "edit.selectChildren",
      label: "Select children",
      shortcut: SHORTCUTS.enter,
      keywords: "down into frame",
      group: "edit",
      menu: "edit",
      section: "select",
      enabled: (c) => {
        const id = onlySelected(c);
        const node = id ? c.slideIndex?.nodes.get(id)?.node : undefined;
        return node?.kind === "frame" && node.children.length > 0;
      },
      run: (c) => {
        if (onSlide(c)) c.select(selectFirstChild(c.slideIndex, c.selection));
      },
    },
  ];
}
