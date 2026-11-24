import type { DeckListing } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { filterDecks } from "./decks.js";

const deck = (id: string, title: string): DeckListing => ({ id, title, slideCount: 1 });
const decks = [deck("a", "Q3 Business Review"), deck("b", "Launch plan"), deck("c", "Q4 plan")];

describe("Manage decks (D99)", () => {
  it("finds decks by every word of the search, in any order and case", () => {
    expect(filterDecks(decks, "").map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(filterDecks(decks, "  plan ").map((d) => d.id)).toEqual(["b", "c"]);
    expect(filterDecks(decks, "PLAN q4").map((d) => d.id)).toEqual(["c"]);
    expect(filterDecks(decks, "review q3").map((d) => d.id)).toEqual(["a"]);
    expect(filterDecks(decks, "nope")).toEqual([]);
  });
});
