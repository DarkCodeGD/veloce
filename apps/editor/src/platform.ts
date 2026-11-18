import { ariaShortcut, type Platform, type ShortcutSpec } from "./model/shortcuts.js";

/** macOS shows ⌘/⇧/⌥; everything else shows Ctrl/Shift/Alt. */
export const PLATFORM: Platform = (() => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const name = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
  return /mac|iphone|ipad/i.test(name) ? "mac" : "other";
})();

/** Attributes for an element with a shortcut: shown in its tooltip, announced by screen readers. */
export function shortcutAttrs(spec: ShortcutSpec) {
  return { "data-keys": spec, "aria-keyshortcuts": ariaShortcut(spec, PLATFORM) };
}
