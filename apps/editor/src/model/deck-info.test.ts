import { applyOp, createDeck, type DeckMeta } from "@veloce/core";
import { describe, expect, it } from "vitest";
import {
  canonicalLanguage,
  draftOf,
  languageName,
  languageOptions,
  metaFromDraft,
  parseAuthors,
  updateMetaCommand,
} from "./deck-info.js";

const meta: DeckMeta = {
  title: "Pitch",
  description: "Seed round",
  authors: ["Ada Lovelace", "Alan Turing"],
  language: "en",
};

/** Save a draft over `meta` through the real op, and return the deck's meta after. */
function save(from: DeckMeta, edit: Partial<ReturnType<typeof draftOf>>) {
  const result = metaFromDraft({ ...draftOf(from), ...edit });
  if (!("meta" in result)) throw new Error(JSON.stringify(result.errors));
  const command = updateMetaCommand(from, result.meta);
  const deck = { ...createDeck({ title: "x" }), meta: from };
  return { command, meta: (command?.ops ?? []).reduce((d, op) => applyOp(d, op).deck, deck).meta };
}

describe("deck info (D76)", () => {
  it("round-trips meta through the form, and saves nothing when nothing changed", () => {
    expect(draftOf(meta)).toEqual({
      title: "Pitch",
      description: "Seed round",
      authors: "Ada Lovelace, Alan Turing",
      language: "en",
    });
    expect(draftOf({ title: "T" })).toEqual({
      title: "T",
      description: "",
      authors: "",
      language: "",
    });
    expect(save(meta, {}).command).toBeNull();
    expect(
      save(meta, { title: "  Pitch ", authors: "Ada Lovelace,Alan Turing, " }).command,
    ).toBeNull();
  });

  it("patches only what changed; clearing a field removes it", () => {
    const renamed = save(meta, { title: "Series A" });
    expect(renamed.command?.ops).toEqual([{ op: "deck.updateMeta", set: { title: "Series A" } }]);
    expect(renamed.command?.label).toBe("Edit deck info");
    expect(renamed.meta).toEqual({ ...meta, title: "Series A" });

    const cleared = save(meta, { description: "  ", authors: "", language: "" });
    expect(cleared.meta).toEqual({ title: "Pitch" });
    expect(save({ title: "T" }, { authors: "Grace Hopper\nKatherine Johnson" }).meta).toEqual({
      title: "T",
      authors: ["Grace Hopper", "Katherine Johnson"],
    });
  });

  it("says what to fix, per field", () => {
    const errors = (edit: Partial<ReturnType<typeof draftOf>>) => {
      const result = metaFromDraft({ ...draftOf(meta), ...edit });
      return "errors" in result ? result.errors : {};
    };
    expect(errors({ title: "   " })).toEqual({ title: "Give the deck a title." });
    expect(errors({ title: "x".repeat(301) }).title).toMatch(/under 300/);
    expect(errors({ description: "x".repeat(5001) }).description).toMatch(/under 5000/);
    expect(errors({ authors: "x".repeat(201) }).authors).toMatch(/each name under 200/);
    expect(
      errors({ authors: Array.from({ length: 101 }, (_, i) => `A${i}`).join(",") }).authors,
    ).toMatch(/at most 100/);
    expect(errors({ language: "not a tag!" })).toEqual({
      language: 'Use a language tag like "en", "fr" or "pt-BR".',
    });
    expect(errors({ title: "", language: "??" })).toHaveProperty("language");
  });

  it("tidies language tags; names languages for the menu", () => {
    expect(canonicalLanguage("pt-br")).toBe("pt-BR");
    expect(canonicalLanguage(" EN ")).toBe("en");
    expect(canonicalLanguage("zh-hant")).toBe("zh-Hant");
    // Grammar only (so a tag an agent wrote is never rejected): "english" is well-formed.
    expect(canonicalLanguage("english")).toBe("english");
    expect(canonicalLanguage("e")).toBeNull();
    expect(canonicalLanguage("en_US")).toBeNull();
    expect(save(meta, { language: "pt-br" }).meta.language).toBe("pt-BR");
    expect(languageName("pt-BR", "en")).toBe("Brazilian Portuguese");
    expect(languageName("fr", "fr")).toBe("français");
    const options = languageOptions("en");
    expect(options.find((o) => o.value === "de")).toEqual({
      value: "de",
      label: "German",
      hint: "de",
    });
    const labels = options.map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("splits authors on commas and new lines", () => {
    expect(parseAuthors(" Ada , ,Alan\nGrace ")).toEqual(["Ada", "Alan", "Grace"]);
    expect(parseAuthors("")).toEqual([]);
  });
});
