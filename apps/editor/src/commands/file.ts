/**
 * The File and Help menus (D76–D78, D89, D91, D93): the app's dialogs.
 */
import { trashDeck } from "../actions.js";
import { openDialog, openPreferences } from "../dialogs.js";
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
      id: "file.manageDecks",
      label: "Manage decks…",
      keywords: "open switch delete remove trash decks presentations files",
      group: "file",
      menu: "file",
      section: "deck",
      run: () => openDialog("decks"),
    },
    // Versions (D93). No keys: Ctrl+Alt+S is a letter on AltGr keyboards (ś in Polish).
    {
      id: "file.saveVersion",
      label: "Save version…",
      keywords: "snapshot checkpoint backup history",
      group: "file",
      menu: "file",
      section: "versions",
      enabled: (c) => c.deck !== undefined,
      run: () => openDialog("save-version"),
    },
    {
      id: "file.versions",
      label: "Versions…",
      keywords: "snapshot history restore backup saved",
      group: "file",
      menu: "file",
      section: "versions",
      enabled: (c) => c.deck !== undefined,
      run: () => openDialog("versions"),
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
    // Destructive but undoable: the Undo toast, not an "are you sure?" (D99).
    {
      id: "file.trashDeck",
      label: "Move deck to trash",
      keywords: "delete remove deck presentation file",
      group: "file",
      menu: "file",
      section: "trash",
      enabled: (c) => c.deck !== undefined,
      run: () => void trashDeck(),
    },
    {
      id: "file.preferences",
      label: "Preferences…",
      shortcut: SHORTCUTS.preferences,
      keywords: "settings options snapping nudge undo lint autosave folder port keymap",
      group: "file",
      menu: "file",
      section: "app",
      run: () => openPreferences(),
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
