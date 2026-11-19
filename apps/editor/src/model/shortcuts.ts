/**
 * Keyboard shortcuts as data, so tooltips and `aria-keyshortcuts` show the same keys the
 * editor listens for. Specs use "Mod" for Ctrl (Windows/Linux) or ⌘ (macOS).
 */

export type Platform = "mac" | "other";

export const SHORTCUTS = {
  undo: "Mod+Z",
  redo: "Mod+Shift+Z",
  duplicate: "Mod+D",
  group: "Mod+G",
  ungroup: "Mod+Shift+G",
  // Alignment (Figma's keys). Matched by physical key, since Alt+letter types symbols on macOS.
  alignLeft: "Alt+A",
  alignCenter: "Alt+H",
  alignRight: "Alt+D",
  alignTop: "Alt+W",
  alignMiddle: "Alt+V",
  alignBottom: "Alt+S",
  distributeHorizontal: "Alt+Shift+H",
  distributeVertical: "Alt+Shift+V",
  delete: "Delete",
  selectSiblings: "Mod+A",
  rename: "F2",
  moveUp: "Alt+ArrowUp",
  moveDown: "Alt+ArrowDown",
  // Canvas zoom (Figma's keys; Shift+digit matched by physical key).
  zoomIn: "Mod+=",
  zoomOut: "Mod+-",
  zoomToFit: "Shift+1",
  zoomTo100: "Shift+0",
  zoomToSelection: "Shift+2",
  // Paragraph alignment while typing (Google Docs' keys), matched on the letter.
  textAlignLeft: "Mod+Shift+L",
  textAlignCenter: "Mod+Shift+E",
  textAlignRight: "Mod+Shift+R",
  textAlignJustify: "Mod+Shift+J",
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

/**
 * For ProseMirror's keymap (the text editor): "Mod+Shift+L" → "Mod-Shift-l". Letters go
 * lowercase: the keymap matches Shift + a letter by its base key.
 */
export function proseMirrorKey(spec: ShortcutSpec): string {
  return spec
    .split("+")
    .map((key) => (key.length === 1 ? key.toLowerCase() : key))
    .join("-");
}
