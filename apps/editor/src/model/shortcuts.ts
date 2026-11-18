/**
 * Keyboard shortcuts as data, so tooltips and `aria-keyshortcuts` show the same keys the
 * editor listens for. Specs use "Mod" for Ctrl (Windows/Linux) or ⌘ (macOS).
 */

export type Platform = "mac" | "other";

export const SHORTCUTS = {
  undo: "Mod+Z",
  redo: "Mod+Shift+Z",
  duplicate: "Mod+D",
  delete: "Delete",
  selectSiblings: "Mod+A",
  rename: "F2",
  moveUp: "Alt+ArrowUp",
  moveDown: "Alt+ArrowDown",
} as const;

export type ShortcutSpec = string;

const MAC: Record<string, string> = {
  Mod: "⌘",
  Shift: "⇧",
  Alt: "⌥",
  Delete: "⌫",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
const OTHER: Record<string, string> = {
  Mod: "Ctrl",
  Delete: "Del",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** The keys to show, one chip each: "Mod+Shift+Z" → ["Ctrl", "Shift", "Z"] or ["⌘", "⇧", "Z"]. */
export function shortcutKeys(spec: ShortcutSpec, platform: Platform): string[] {
  const names = platform === "mac" ? MAC : OTHER;
  return spec.split("+").map((key) => names[key] ?? key);
}

/** For `aria-keyshortcuts`: "Mod+Shift+Z" → "Control+Shift+Z" (or "Meta+Shift+Z" on macOS). */
export function ariaShortcut(spec: ShortcutSpec, platform: Platform): string {
  return spec
    .split("+")
    .map((key) => (key === "Mod" ? (platform === "mac" ? "Meta" : "Control") : key))
    .join("+");
}
