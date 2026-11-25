const TEXT_ENTRY = ["INPUT", "TEXTAREA"];

/** True when the key press belongs to a text field, not to the editor. */
export const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    [...TEXT_ENTRY, "SELECT"].includes(target.tagName) ||
    target.getAttribute("role") === "combobox");

/**
 * A focused dropdown trigger (our `Select`: a button with role combobox) or on/off switch
 * (a checkbox) has no text of its own to undo, copy or paste, so Ctrl+Z / Ctrl+Y and the
 * clipboard still act on the deck. Without this, undo did nothing right after picking from
 * an inspector dropdown or flipping a switch, and Ctrl+V did nothing right after switching
 * decks, until focus moved.
 */
export const deckKeysPassThrough = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !target.isContentEditable &&
  ((target.getAttribute("role") === "combobox" && !TEXT_ENTRY.includes(target.tagName)) ||
    (target instanceof HTMLInputElement &&
      (target.type === "checkbox" || target.type === "radio")));
