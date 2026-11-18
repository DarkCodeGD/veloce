/**
 * Live previews: while a value is being scrubbed or nudged, its ops are applied to a local
 * copy of the deck for this tab only. Nothing reaches the server until the gesture ends,
 * which then sends one transaction (D39). Keeps undo history and other clients clean.
 */
import { applyTransaction, type Deck, type Op } from "@veloce/core";
import { registry } from "./editor-context.js";

let current: readonly Op[] | null = null;
const listeners = new Set<() => void>();

export const previewStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => current,
};

/** Show these ops on top of the document (`null` drops the preview). */
export function setPreview(ops: readonly Op[] | null) {
  if (ops === current) return;
  current = ops;
  for (const listener of listeners) listener();
}

const context = registry.applyContext();

/** The deck with the preview applied; the deck itself if the preview no longer applies. */
export function previewDeck(deck: Deck, ops: readonly Op[] | null): Deck {
  if (!ops) return deck;
  const result = applyTransaction(deck, { origin: "user", label: "preview", ops }, context);
  return result.ok ? result.deck : deck;
}
