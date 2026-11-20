/**
 * The Deck info dialog's logic, pure (D76): the deck's title, description, authors and
 * language (`deck.meta`) as a form, checked before saving, and saved as one `deck.updateMeta`
 * with only what changed: the op agents use (golden rule 1).
 *
 * The limits mirror `DeckMetaSchema`, so the dialog says what's wrong in words instead of the
 * server rejecting the save. Language tags are checked and tidied by the browser's own
 * `Intl` (`pt-br` → `pt-BR`), so a typo can't reach the file.
 */
import { type DeckMeta, diffPatch } from "@veloce/core";
import type { Command } from "./commands.js";

/** The form's fields, as typed. Authors are one string, separated by commas. */
export interface MetaDraft {
  title: string;
  description: string;
  authors: string;
  language: string;
}

export type DraftErrors = Partial<Record<keyof MetaDraft, string>>;

const LIMITS = { title: 300, description: 5000, author: 200, authors: 100, language: 35 };

export function draftOf(meta: DeckMeta): MetaDraft {
  return {
    title: meta.title,
    description: meta.description ?? "",
    authors: (meta.authors ?? []).join(", "),
    language: meta.language ?? "",
  };
}

/** "Ada Lovelace, Alan Turing" → two names (blank entries dropped). */
export function parseAuthors(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * A BCP 47 tag in its canonical form (`pt-br` → `pt-BR`), or null if it isn't one. Grammar
 * only, like the schema: a well-formed tag the browser can't name (an agent's rare language)
 * is still accepted. The dialog shows the language's name, so a typo stands out.
 */
export function canonicalLanguage(tag: string): string | null {
  try {
    const [canonical] = Intl.getCanonicalLocales(tag.trim());
    return canonical ?? null;
  } catch {
    return null;
  }
}

/** The deck meta the form describes, or what to fix (per field). */
export function metaFromDraft(draft: MetaDraft): { meta: DeckMeta } | { errors: DraftErrors } {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Give the deck a title.";
  else if (title.length > LIMITS.title) {
    errors.title = `Keep the title under ${LIMITS.title} characters.`;
  }
  const description = draft.description.trim();
  if (description.length > LIMITS.description) {
    errors.description = `Keep the description under ${LIMITS.description} characters.`;
  }
  const authors = parseAuthors(draft.authors);
  if (authors.length > LIMITS.authors) {
    errors.authors = `List at most ${LIMITS.authors} authors.`;
  } else if (authors.some((name) => name.length > LIMITS.author)) {
    errors.authors = `Keep each name under ${LIMITS.author} characters.`;
  }
  let language: string | undefined;
  if (draft.language.trim()) {
    const canonical = canonicalLanguage(draft.language);
    if (canonical === null || canonical.length > LIMITS.language) {
      errors.language = 'Use a language tag like "en", "fr" or "pt-BR".';
    } else language = canonical;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    meta: {
      title,
      ...(description && { description }),
      ...(authors.length > 0 && { authors }),
      ...(language && { language }),
    },
  };
}

/** Save `next` over `current` as one step, patching only what changed (null: nothing did). */
export function updateMetaCommand(current: DeckMeta, next: DeckMeta): Command | null {
  const set = diffPatch(current, next);
  if (set === undefined) return null;
  return { label: "Edit deck info", ops: [{ op: "deck.updateMeta", set: set as never }] };
}

/** Languages offered by name; any other tag can still be typed ("Other…"). */
export const COMMON_LANGUAGES = [
  "ar",
  "de",
  "en",
  "en-GB",
  "es",
  "fil",
  "fr",
  "he",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "pt-BR",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh-Hans",
  "zh-Hant",
] as const;

/** A language's name in `displayIn` ("pt-BR" → "Brazilian Portuguese"), or the tag itself. */
export function languageName(tag: string, displayIn: string): string {
  try {
    return new Intl.DisplayNames([displayIn], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The language menu: common languages by name (A–Z), each hinted with its tag. */
export function languageOptions(
  displayIn: string,
): Array<{ value: string; label: string; hint: string }> {
  return COMMON_LANGUAGES.map((tag) => ({
    value: tag,
    label: languageName(tag, displayIn),
    hint: tag,
  })).sort((a, b) => a.label.localeCompare(b.label, displayIn));
}
