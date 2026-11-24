/** Manage decks (D99): the deck list as the dialog shows it. */
import type { DeckListing } from "@veloce/core";

/** Decks whose title has every word of the search, in any order and case. */
export function filterDecks(decks: readonly DeckListing[], query: string): DeckListing[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...decks];
  return decks.filter((d) => {
    const title = d.title.toLocaleLowerCase();
    return words.every((w) => title.includes(w));
  });
}
