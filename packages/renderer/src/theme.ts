/**
 * Theme → CSS custom properties on the stage. Content references tokens as `var(--v-…)`,
 * so switching themes restyles every element without re-rendering any of them.
 */
import { type Theme, themeToCssVariables } from "@veloce/core";

/** Variables set by the previous theme, so tokens a new theme doesn't define get removed. */
const applied = new WeakMap<HTMLElement, string[]>();

export function applyTheme(el: HTMLElement, theme: Theme): void {
  for (const name of applied.get(el) ?? []) el.style.removeProperty(name);
  const vars = themeToCssVariables(theme);
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
  applied.set(el, Object.keys(vars));
  // Defaults inherited by everything on the slide.
  el.style.fontFamily = "var(--v-font-body)";
  el.style.color = "var(--v-color-text)";
}
