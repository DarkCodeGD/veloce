/**
 * Which app dialog is open (D78). A tiny store, so any component can open one (the File
 * menu, the empty state, the inspector's Theme section) while App renders it at the top
 * level: a dialog inside the inspector would unmount, losing its draft, whenever the
 * inspector re-keys (Follow AI switching slides).
 */
import { useSyncExternalStore } from "react";

export type DialogId = "new-deck" | "deck-info" | "theme-styles" | "shortcuts" | "preferences";

let open: DialogId | null = null;
const listeners = new Set<() => void>();

const set = (next: DialogId | null) => {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
};

export const openDialog = (id: DialogId) => set(id);

/** Preferences' tabs (D91). */
export type PreferencesTab = "editing" | "files" | "keymap" | "ai";
let preferencesTab: PreferencesTab = "editing";

/** Opens Preferences on a tab (the command palette's settings, D92). */
export function openPreferences(tab: PreferencesTab = "editing"): void {
  preferencesTab = tab;
  set("preferences");
}

/** The tab Preferences opens on. */
export const initialPreferencesTab = (): PreferencesTab => preferencesTab;
export const closeDialog = () => set(null);

/** The open dialog, re-rendering when it changes. */
export function useOpenDialog(): DialogId | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}
