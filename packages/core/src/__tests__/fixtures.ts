import { createDeck, createSlide, element, frame } from "../builders.js";
import type { Deck } from "../schema/deck.js";

export const IMAGE_ID = "a".repeat(64);

/**
 * Two slides:
 *   intro (root "intro-root"): title, cards(grid) → card-1(stack) → card-1-text
 *   outro (root "outro-root"): box
 */
export function fixtureDeck(): Deck {
  const title = element("text", { content: "Hello" }, { id: "title", name: "Title" });
  const card1 = frame({
    id: "card-1",
    layout: { mode: "stack", gap: 16 },
    style: { fill: "$color.surface", radius: "$radius.md" },
    children: [element("text", { content: "A" }, { id: "card-1-text" })],
  });
  const cards = frame({ id: "cards", layout: { mode: "grid", columns: 3 }, children: [card1] });
  const intro = createSlide({ id: "intro", rootId: "intro-root", children: [title, cards] });
  const outro = createSlide({
    id: "outro",
    rootId: "outro-root",
    children: [element("shape", { shape: "rect" }, { id: "box" })],
  });
  return deepFreeze(createDeck({ id: "deck", title: "Test deck", slides: [intro, outro] }));
}

/** Freeze recursively, so any accidental mutation throws (proves ops are pure). */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
