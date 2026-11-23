/**
 * The File and Help menus (D76–D78, D89, D91): the app's dialogs.
 */
import { openDialog } from "../dialogs.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import type { EditorCommand } from "./context.js";

export function fileCommands(): EditorCommand[] {
  return [
    {
      id: "file.newDeck",
      label: "New deck…",
      keywords: "create presentation",
      group: "file",
      menu: "file",
      section: "deck",
      run: () => openDialog("new-deck"),
    },
    {
      id: "file.deckInfo",
      label: "Deck info…",
      keywords: "title author language properties",
      group: "file",
      menu: "file",
      section: "settings",
      enabled: (c) => c.deck !== undefined,
      run: () => openDialog("deck-info"),
    },
    {
      id: "file.themeStyles",
      label: "Theme styles…",
      keywords: "fonts text styles spacing radius shadow",
      group: "file",
      menu: "file",
      section: "settings",
      enabled: (c) => c.deck !== undefined,
      run: () => openDialog("theme-styles"),
    },
    {
      id: "file.preferences",
      label: "Preferences…",
      shortcut: SHORTCUTS.preferences,
      keywords: "settings options snapping nudge undo lint autosave folder port keymap",
      group: "file",
      menu: "file",
      section: "app",
      run: () => openDialog("preferences"),
    },
  ];
}

export function helpCommands(): EditorCommand[] {
  return [
    {
      id: "help.shortcuts",
      label: "Keyboard shortcuts",
      shortcut: SHORTCUTS.keyboardShortcuts,
      keywords: "keys keymap hotkeys",
      group: "help",
      menu: "help",
      run: () => openDialog("shortcuts"),
    },
  ];
}
