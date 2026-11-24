/**
 * Insert → Footer and slide numbers… (D97), PowerPoint's Header & Footer: the date, a line
 * of text and the slide number along the bottom of every slide. Title and section header
 * slides made from the built-in layouts leave it off; any slide can, from its Slide settings.
 * Saving is one undoable `deck.setFooter`.
 */
import { type Deck, fieldValues } from "@veloce/core";
import { useId, useState } from "react";
import { run } from "../actions.js";
import { type FooterDraft, footerDraft, setFooterCommand } from "../model/footer.js";
import { Dialog, DialogField } from "./Dialog.js";

export function FooterDialog({ deck, onClose }: { deck: Deck; onClose(): void }) {
  const [draft, setDraft] = useState<FooterDraft>(() => footerDraft(deck.footer));
  const ids = { date: useId(), text: useId(), number: useId() };
  const today = fieldValues(deck, 0, new Date()).date;
  const set = <K extends keyof FooterDraft>(key: K, value: FooterDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    const command = setFooterCommand(deck.footer, draft);
    if (!command) return onClose();
    void run(command).then((ok) => ok && onClose());
  };

  const toggle = (id: string, key: "date" | "slideNumber", label: string, hint: string) => (
    <div className="footer-option">
      <label htmlFor={id}>
        {label}
        <span className="dialog-hint">{hint}</span>
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={draft[key]}
        aria-checked={draft[key]}
        onChange={(e) => set(key, e.target.checked)}
      />
    </div>
  );

  return (
    <Dialog
      title="Footer and slide numbers"
      className="footer-dialog"
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary">
            Apply to all slides
          </button>
        </>
      }
    >
      {toggle(ids.date, "date", "Date", `Left, today's: ${today}`)}
      <DialogField
        label="Footer text"
        htmlFor={ids.text}
        hint="Centered, e.g. your company or the talk's name. Leave empty for none."
      >
        <input
          id={ids.text}
          type="text"
          value={draft.text}
          maxLength={200}
          placeholder="Acme · Confidential"
          onChange={(e) => set("text", e.target.value)}
        />
      </DialogField>
      {toggle(ids.number, "slideNumber", "Slide number", "Right")}
      <p className="dialog-hint">
        Title and section header slides leave the footer off. Turn it off for any slide with Show
        footer in its Slide settings.
      </p>
    </Dialog>
  );
}
