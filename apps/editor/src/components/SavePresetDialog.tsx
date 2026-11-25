/**
 * Animate → Save as preset… (D119): the tuned animation's motion and timing, kept in the deck
 * under a name, offered first in the gallery and played by that name (agents use it too).
 * The animation being tuned plays the new preset right away.
 *
 * Saving is ordinary ops (`preset.save`, then `animation.update`), so it's one undo step,
 * and the toast offers Undo too.
 */
import { type Animation, type Deck, presetNames } from "@veloce/core";
import { useId, useState } from "react";
import { run } from "../actions.js";
import { registry } from "../editor-context.js";
import { savePreset } from "../model/animate.js";
import { Dialog, DialogField, describedBy } from "./Dialog.js";

export function SavePresetDialog({
  deck,
  animation,
  suggested,
  onClose,
}: {
  deck: Deck;
  animation: Animation;
  /** The effect's title, to start the name from ("Pop in" → "Pop in 2"). */
  suggested: string | undefined;
  onClose(): void;
}) {
  const [title, setTitle] = useState(() => suggestedTitle(deck, suggested));
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed) return setError("Give it a name.");
    setBusy(true);
    const { command } = savePreset(
      deck,
      animation,
      { title: trimmed, ...(description.trim() && { description: description.trim() }) },
      registry.hasEffect,
    );
    const done = await run(command, { undoToast: `Saved preset “${trimmed}”` });
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Dialog
      title="Save as preset"
      className="save-preset-dialog"
      onClose={onClose}
      onSubmit={() => void save()}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <DialogField
        label="Name"
        htmlFor={titleId}
        error={error}
        hint="Shows first in Add effect, on any slide of this deck. It follows the motion level like the effect it came from."
      >
        <input
          id={titleId}
          type="text"
          value={title}
          maxLength={60}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(undefined);
          }}
          {...describedBy(titleId, error, true)}
        />
      </DialogField>
      <DialogField label="Description" htmlFor={descriptionId} hint="What it's for. Optional.">
        <input
          id={descriptionId}
          type="text"
          value={description}
          maxLength={300}
          placeholder="e.g. Big, bouncy entrance for headline numbers"
          onChange={(e) => setDescription(e.target.value)}
          {...describedBy(descriptionId, undefined, true)}
        />
      </DialogField>
    </Dialog>
  );
}

/** "Pop in 2", "Pop in 3"…: the effect's title with the next number no preset's title has. */
function suggestedTitle(deck: Deck, effect: string | undefined): string {
  const base = effect ?? "My preset";
  const titles = new Set(
    presetNames(deck).map((n) => (deck.presets?.[n]?.title ?? n).toLowerCase()),
  );
  for (let n = 2; ; n++) if (!titles.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}
