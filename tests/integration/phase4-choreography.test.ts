/**
 * Phase 4 acceptance (choreography from intent, D121): "Animate this slide" works on real
 * slides. Every slide of the visual reference decks (titles, lists, cards, images, free
 * layouts, 2.5D, the layouts gallery), at every motion level and pacing, animates through
 * the real plugin registry: every effect it picks exists and suits its layer, the deck stays
 * valid, it's one undo step, and calm moves less than absurd.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createBuiltinRegistry } from "@veloce/builtins";
import {
  applyTransaction,
  CHOREOGRAPHY_PACINGS,
  choreograph,
  type Deck,
  MOTION_LEVELS,
  replaceAnimationsOps,
  validateDeck,
} from "@veloce/core";
import { migrateDocument, type RawDocument } from "@veloce/format";
import { describe, expect, it } from "vitest";

const DECKS = fileURLToPath(new URL("../visual/decks/", import.meta.url));
const registry = createBuiltinRegistry();
const ctx = registry.applyContext();

const decks: Deck[] = await Promise.all(
  (await readdir(DECKS))
    .filter((f) => f.endsWith(".json"))
    .map(async (f) => {
      const raw = JSON.parse(await readFile(DECKS + f, "utf8")) as RawDocument;
      const valid = validateDeck(migrateDocument(raw, Number(raw.formatVersion)), ctx);
      if (!valid.ok) throw new Error(`${f}: ${valid.errors[0]?.message}`);
      return valid.deck;
    }),
);

describe("Phase 4: Animate this slide on real slides (D121)", () => {
  it("animates every slide at every level and pacing, and the deck stays valid", () => {
    let slides = 0;
    for (const deck of decks) {
      for (const slide of deck.slides) {
        slides++;
        for (const motionLevel of MOTION_LEVELS) {
          for (const pacing of CHOREOGRAPHY_PACINGS) {
            const { animations } = choreograph(
              { ...deck, motionLevel },
              slide,
              { pacing },
              {
                hasEffect: registry.hasEffect,
              },
            );
            const result = applyTransaction(
              { ...deck, motionLevel },
              {
                origin: "user",
                label: "Animate slide",
                ops: replaceAnimationsOps(slide, animations),
              },
              ctx,
            );
            const where = `${slide.id} at ${motionLevel}, ${pacing}`;
            if (!result.ok) throw new Error(`${where}: ${result.error.message}`);
            const valid = validateDeck(result.deck, ctx);
            if (!valid.ok) throw new Error(`${where}: ${valid.errors[0]?.message}`);
            expect(
              valid.warnings.filter((w) => w.path?.includes("animations")),
              where,
            ).toEqual([]);
          }
        }
      }
    }
    expect(slides).toBeGreaterThan(20);
  });

  it("moves less at calm than at absurd, on every slide that has something to move", () => {
    for (const deck of decks) {
      for (const slide of deck.slides) {
        const calm = choreograph({ ...deck, motionLevel: "calm" }, slide).moving;
        const absurd = choreograph({ ...deck, motionLevel: "absurd" }, slide).moving;
        expect(calm, `${slide.id}`).toBeLessThanOrEqual(absurd);
        if (absurd > 3) expect(calm, `${slide.id}`).toBeLessThan(absurd);
      }
    }
  });
});
