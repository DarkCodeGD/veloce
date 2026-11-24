/**
 * Slide → Add section… and Rename section… (D97): names the section that starts at a slide.
 * The name is checked here with the core schema, so a bad one never reaches the server.
 */
import { type Deck, SectionNameSchema } from "@veloce/core";
import { useId, useState } from "react";
import { run } from "../actions.js";
import { currentSectionTarget } from "../dialogs.js";
import { addSectionCommand, renameSectionCommand } from "../model/sections.js";
import { Dialog, DialogField, describedBy } from "./Dialog.js";

export function SectionDialog({ deck, onClose }: { deck: Deck; onClose(): void }) {
  const [target] = useState(currentSectionTarget);
  const slide = deck.slides.find((s) => s.id === target?.slideId);
  const renaming = target?.rename === true && slide?.section !== undefined;
  const [name, setName] = useState(() => (renaming ? (slide?.section ?? "") : ""));
  const [error, setError] = useState<string>();
  const id = useId();
  if (!slide || !target) return null; // the slide went away (an agent deleted it)

  const save = () => {
    const parsed = SectionNameSchema.safeParse(name.trim().replace(/\s+/g, " "));
    if (!parsed.success) return setError("Give the section a name, e.g. “Results”.");
    const command = renaming
      ? renameSectionCommand(deck.slides, slide.id, parsed.data)
      : addSectionCommand(slide, parsed.data);
    if (!command) return onClose();
    void run(command).then((ok) => ok && onClose());
  };

  const at = deck.slides.indexOf(slide) + 1;
  return (
    <Dialog
      title={renaming ? "Rename section" : "Add section"}
      className="section-dialog"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary">
            {renaming ? "Rename" : "Add"}
          </button>
        </>
      }
    >
      <DialogField
        label="Name"
        htmlFor={id}
        error={error}
        hint={
          renaming
            ? undefined
            : `Starts at slide ${at} and runs until the next section, grouping slides in the list.`
        }
      >
        <input
          id={id}
          type="text"
          value={name}
          maxLength={100}
          placeholder="Results"
          {...describedBy(id, error, !renaming)}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
        />
      </DialogField>
    </Dialog>
  );
}
