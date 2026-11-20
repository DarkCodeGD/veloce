/**
 * File → New deck (D77): a title and a built-in theme, then the server makes the deck the
 * way an agent's `create_deck` does. It becomes the active deck, so the editor (and every
 * other tab) switches to it. The theme can be changed later in the inspector.
 */
import { BUILTIN_THEMES } from "@veloce/core";
import { useId, useState } from "react";
import { createDeck } from "../actions.js";
import { Dialog, DialogField, describedBy } from "./Dialog.js";
import { ThemeCard } from "./ThemeSection.js";

const THEME_IDS = Object.keys(BUILTIN_THEMES);
const DEFAULT_TITLE = "Untitled deck";

export function NewDeckDialog({ onClose }: { onClose(): void }) {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [theme, setTheme] = useState("light");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  const create = async () => {
    const name = title.trim();
    if (!name) return setError("Give the deck a title.");
    if (name.length > 300) return setError("Keep the title under 300 characters.");
    setBusy(true);
    const made = await createDeck(name, theme);
    setBusy(false);
    if (made) onClose();
  };

  return (
    <Dialog
      title="New deck"
      className="new-deck-dialog"
      onClose={onClose}
      onSubmit={() => void create()}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      <DialogField label="Title" htmlFor={titleId} error={error}>
        <input
          id={titleId}
          type="text"
          value={title}
          // The default name is selected, so typing replaces it.
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(undefined);
          }}
          {...describedBy(titleId, error)}
        />
      </DialogField>
      <fieldset className="dialog-field">
        <legend className="dialog-label">Theme</legend>
        <div className="theme-grid">
          {THEME_IDS.map((id) => {
            const t = BUILTIN_THEMES[id];
            return t ? (
              <ThemeCard key={id} theme={t} on={theme === id} onPick={() => setTheme(id)} />
            ) : null;
          })}
        </div>
        <p className="dialog-hint">You can fine-tune colors and fonts later in the inspector.</p>
      </fieldset>
    </Dialog>
  );
}
