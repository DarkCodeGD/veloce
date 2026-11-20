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
  // Figma's is Shift+A, which opens the Add menu here (D81); Ctrl+Alt+A is free (D83).
  autoLayout: "Mod+Alt+A",
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
  // Tools (D81, Figma's letters) and the Add menu (Blender's Shift+A).
  toolSelect: "V",
  toolFrame: "F",
  toolRect: "R",
  toolEllipse: "O",
  toolText: "T",
  toolHand: "H",
  addMenu: "Shift+A",
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

/** The parts of a key press a shortcut is matched on. */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Whether a key press is exactly `spec`: the same modifiers, no more ("T" isn't Shift+T or
 * Ctrl+T). Letters match the character typed, so they follow the keyboard layout, except
 * with Alt, which types symbols on macOS: then (like Shift + a digit) the physical key.
 */
export function matchesShortcut(e: KeyPress, spec: ShortcutSpec, platform: Platform): boolean {
  const parts = spec.split("+");
  const key = parts.at(-1) ?? "";
  const mods = new Set(parts.slice(0, -1));
  const [mod, other] = platform === "mac" ? [e.metaKey, e.ctrlKey] : [e.ctrlKey, e.metaKey];
  if (mod !== mods.has("Mod") || other) return false;
  if (e.shiftKey !== mods.has("Shift") || e.altKey !== mods.has("Alt")) return false;
  if (/^[A-Za-z]$/.test(key)) {
    return e.altKey
      ? e.code === `Key${key.toUpperCase()}`
      : e.key.toLowerCase() === key.toLowerCase();
  }
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.key === key;
  return e.key === key;
}
