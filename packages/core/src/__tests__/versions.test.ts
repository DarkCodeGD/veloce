import { describe, expect, it } from "vitest";
import { createSlide, element } from "../builders.js";
import { BUILTIN_THEMES } from "../themes.js";
import { applyTransaction } from "../transaction.js";
import {
  newVersionId,
  restoreOps,
  VERSION_ID_PATTERN,
  VersionNameSchema,
  versionInfo,
} from "../versions.js";
import { fixtureDeck, IMAGE_ID } from "./fixtures.js";

const OTHER_IMAGE = "b".repeat(64);

/** The fixture deck after a big rewrite: other slides, theme, meta and assets. */
function rewritten() {
  const deck = fixtureDeck();
  const assets = { ...deck.assets };
  delete assets[IMAGE_ID];
  return {
    ...deck,
    meta: { title: "Rewritten", language: "de" },
    theme: BUILTIN_THEMES.midnight ?? deck.theme,
    assets: { ...assets, [OTHER_IMAGE]: { mime: "image/png", bytes: 3 } },
    slides: [
      createSlide({ id: "new1", children: [element("text", { content: "New" }, { id: "n1" })] }),
    ],
  };
}

const strip = (deck: ReturnType<typeof fixtureDeck>) => JSON.parse(JSON.stringify(deck));

describe("restoring a version (D93)", () => {
  it("turns the deck back into the version in one transaction, and undo reverses it", () => {
    const saved = fixtureDeck();
    const now = rewritten();
    const result = applyTransaction(now, {
      origin: "user",
      label: "Restore version",
      ops: restoreOps(now, saved),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(strip(result.deck)).toEqual(strip(saved));

    const undone = applyTransaction(result.deck, {
      origin: "user",
      label: "Undo",
      ops: result.inverse,
    });
    if (!undone.ok) throw new Error(undone.error.message);
    expect(strip(undone.deck)).toEqual(strip(now));
  });

  it("only touches the theme and meta when they changed", () => {
    const deck = fixtureDeck();
    const kinds = restoreOps(deck, deck).map((op) => op.op);
    expect(kinds).not.toContain("deck.setTheme");
    expect(kinds).not.toContain("deck.updateMeta");
    expect(kinds).not.toContain("asset.add");
  });

  it("describes a version without its deck, and names IDs and names safely", () => {
    const deck = fixtureDeck();
    expect(
      versionInfo({
        id: "vr_0123456789",
        name: "Before AI",
        savedAt: "2026-11-24T10:00:00.000Z",
        deck,
      }),
    ).toEqual({
      id: "vr_0123456789",
      name: "Before AI",
      savedAt: "2026-11-24T10:00:00.000Z",
      slideCount: deck.slides.length,
    });
    expect(newVersionId()).toMatch(VERSION_ID_PATTERN);
    expect(VersionNameSchema.parse("  Draft  ")).toBe("Draft");
    expect(VersionNameSchema.safeParse("   ").success).toBe(false);
  });
});
