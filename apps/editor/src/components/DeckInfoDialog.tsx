/**
 * File → Deck info (D76): the deck's title, description, authors and language. Saving is one
 * undoable `deck.updateMeta` with only what changed (the op agents use); a field the form
 * can't save says why, in place. The language menu names common languages; "Other…" takes
 * any BCP 47 tag, named as you type so a typo stands out.
 */
import type { Deck } from "@veloce/core";
import { useId, useMemo, useState } from "react";
import { run } from "../actions.js";
import {
  canonicalLanguage,
  type DraftErrors,
  draftOf,
  languageName,
  languageOptions,
  type MetaDraft,
  metaFromDraft,
  updateMetaCommand,
} from "../model/deck-info.js";
import { Dialog, DialogField, describedBy } from "./Dialog.js";
import { Select } from "./Select.js";

const OTHER = "other";
/** Languages are named in the editor's own language. */
const displayIn = () => navigator.language || "en";

export function DeckInfoDialog({ deck, onClose }: { deck: Deck; onClose(): void }) {
  const [draft, setDraft] = useState<MetaDraft>(() => draftOf(deck.meta));
  const [errors, setErrors] = useState<DraftErrors>({});
  const options = useMemo(() => languageOptions(displayIn()), []);
  const listed = (tag: string) => options.some((o) => o.value === tag);
  // A tag that isn't in the menu (an agent's, or typed earlier) opens as "Other…".
  const [otherLanguage, setOtherLanguage] = useState(
    () => draft.language !== "" && !listed(draft.language),
  );
  const ids = {
    title: useId(),
    description: useId(),
    authors: useId(),
    language: useId(),
    tag: useId(),
  };
  const set = (key: keyof MetaDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const save = () => {
    const result = metaFromDraft(draft);
    if ("errors" in result) {
      setErrors(result.errors);
      return;
    }
    const command = updateMetaCommand(deck.meta, result.meta);
    if (!command) return onClose();
    void run(command).then((ok) => ok && onClose());
  };

  const typedTag = canonicalLanguage(draft.language);
  const typedName = typedTag ? languageName(typedTag, displayIn()) : null;

  return (
    <Dialog
      title="Deck info"
      className="deck-info-dialog"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary">
            Save
          </button>
        </>
      }
    >
      <DialogField label="Title" htmlFor={ids.title} error={errors.title}>
        <input
          id={ids.title}
          type="text"
          value={draft.title}
          onChange={(e) => set("title")(e.target.value)}
          {...describedBy(ids.title, errors.title)}
        />
      </DialogField>
      <DialogField
        label="Description"
        htmlFor={ids.description}
        error={errors.description}
        hint="What it's for. Agents read it too, so they write for that audience."
      >
        <textarea
          id={ids.description}
          rows={3}
          value={draft.description}
          onChange={(e) => set("description")(e.target.value)}
          {...describedBy(ids.description, errors.description, true)}
        />
      </DialogField>
      <DialogField
        label="Authors"
        htmlFor={ids.authors}
        error={errors.authors}
        hint="Separate names with commas."
      >
        <input
          id={ids.authors}
          type="text"
          value={draft.authors}
          placeholder="Ada Lovelace, Alan Turing"
          onChange={(e) => set("authors")(e.target.value)}
          {...describedBy(ids.authors, errors.authors, true)}
        />
      </DialogField>
      <DialogField
        label="Language"
        htmlFor={ids.language}
        hint={
          otherLanguage ? undefined : "Screen readers read the slides in it; agents write in it."
        }
      >
        <Select
          id={ids.language}
          value={otherLanguage ? OTHER : draft.language}
          options={[{ value: "", label: "Not set" }, ...options, { value: OTHER, label: "Other…" }]}
          onChange={(value) => {
            setOtherLanguage(value === OTHER);
            if (value !== OTHER) set("language")(value);
          }}
        />
      </DialogField>
      {otherLanguage && (
        <DialogField
          label="Language tag"
          htmlFor={ids.tag}
          error={errors.language}
          hint={
            typedName && typedName !== typedTag ? typedName : 'A BCP 47 tag, like "ca" or "es-MX".'
          }
        >
          <input
            id={ids.tag}
            type="text"
            value={draft.language}
            placeholder="es-MX"
            spellCheck={false}
            onChange={(e) => set("language")(e.target.value)}
            {...describedBy(ids.tag, errors.language, true)}
          />
        </DialogField>
      )}
    </Dialog>
  );
}
