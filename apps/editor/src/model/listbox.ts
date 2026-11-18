/**
 * Keyboard logic for the custom select (WAI-ARIA "select-only combobox" pattern), kept free
 * of the DOM so it can be tested directly. Indexes refer to the option list; disabled options
 * are skipped.
 */

export interface ListOption {
  label: string;
  disabled?: boolean;
}

/** How far PageUp/PageDown jump. */
export const PAGE_SIZE = 10;

const enabled = (options: readonly ListOption[], i: number) =>
  i >= 0 && i < options.length && !options[i]?.disabled;

/** The nearest enabled option from `from` in direction `step`, or `fallback` if none. */
function seek(options: readonly ListOption[], from: number, step: 1 | -1, fallback: number) {
  for (let i = from; i >= 0 && i < options.length; i += step) if (enabled(options, i)) return i;
  return fallback;
}

/**
 * The option that should become active after `key`, or `null` if the key doesn't move the
 * highlight. `current` is -1 when nothing is active yet.
 */
export function moveActive(
  options: readonly ListOption[],
  current: number,
  key: string,
): number | null {
  const last = options.length - 1;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? seek(options, 0, 1, -1) : seek(options, current + 1, 1, current);
    case "ArrowUp":
      return current < 0 ? seek(options, last, -1, -1) : seek(options, current - 1, -1, current);
    case "Home":
      return seek(options, 0, 1, current);
    case "End":
      return seek(options, last, -1, current);
    case "PageDown":
      return seek(options, Math.min(last, Math.max(0, current) + PAGE_SIZE), -1, current);
    case "PageUp":
      return seek(options, Math.max(0, current - PAGE_SIZE), 1, current);
    default:
      return null;
  }
}

/**
 * Typeahead: the first enabled option whose label starts with `query` (case-insensitive),
 * searching after `current` and wrapping around. Typing the same letter repeatedly cycles
 * through the options that start with it. Returns `current` when nothing matches.
 */
export function typeahead(options: readonly ListOption[], current: number, query: string): number {
  const q = query.toLowerCase();
  if (q === "" || options.length === 0) return current;
  const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = repeated ? (q[0] ?? q) : q;
  // A fresh multi-letter query may still match the current option; a single letter moves on.
  const start = needle.length > 1 && !repeated ? Math.max(0, current) : current + 1;
  for (let n = 0; n < options.length; n++) {
    const i = (start + n) % options.length;
    if (enabled(options, i) && options[i]?.label.toLowerCase().startsWith(needle)) return i;
  }
  return current;
}
