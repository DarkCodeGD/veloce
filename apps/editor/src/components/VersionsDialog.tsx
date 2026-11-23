/**
 * Versions (D93): File → Save version… names the deck as it is now; File → Versions… lists
 * them, newest first, and shows the one picked, read-only (its slides drawn by the same
 * renderer, never editable). Restore turns the deck back into it as one change of your own:
 * the toast's Undo, like Ctrl+Z, brings back what was there. Delete asks once more, since
 * a version isn't an edit and can't be undone.
 */
import type { Deck, VersionInfo } from "@veloce/core";
import { History } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { deleteVersion, restoreVersion, saveVersion } from "../actions.js";
import { openDialog } from "../dialogs.js";
import { client } from "../editor-context.js";
import { timeAgo } from "../model/history.js";
import { Dialog, DialogField, describedBy } from "./Dialog.js";
import { SlideCanvas } from "./SlideCanvas.js";

const versionsOf = () => client.getState().versions;
const useVersions = (): VersionInfo[] => useSyncExternalStore(client.subscribe, versionsOf);

/** "24 Nov 2026, 14:05" in the viewer's language and time zone. */
const fullDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const slidesLabel = (n: number) => `${n} slide${n === 1 ? "" : "s"}`;

export function SaveVersionDialog({ onClose }: { onClose(): void }) {
  const count = useVersions().length;
  const [name, setName] = useState(`Version ${count + 1}`);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const nameId = useId();

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the version a name.");
    if (trimmed.length > 100) return setError("Keep the name under 100 characters.");
    setBusy(true);
    const saved = await saveVersion(trimmed);
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <Dialog
      title="Save version"
      className="save-version-dialog"
      onClose={onClose}
      onSubmit={() => void save()}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <DialogField
        label="Name"
        htmlFor={nameId}
        error={error}
        hint="A copy of the deck as it is now, kept in its file. Restore it from File → Versions."
      >
        <input
          id={nameId}
          type="text"
          value={name}
          // The suggested name is selected, so typing replaces it.
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
          {...describedBy(nameId, error, true)}
        />
      </DialogField>
    </Dialog>
  );
}

export function VersionsDialog({ deckId, onClose }: { deckId: string; onClose(): void }) {
  const versions = useVersions();
  const [picked, setPicked] = useState<string | null>(versions[0]?.id ?? null);
  // Deleted in another tab: show the newest instead.
  const current = versions.find((v) => v.id === picked) ?? versions[0];
  const [busy, setBusy] = useState(false);
  /** The version Delete was pressed on once: the second press deletes it. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmDelete = current !== undefined && confirming === current.id;

  const restore = async () => {
    if (!current) return;
    setBusy(true);
    const done = await restoreVersion(current.id, current.name);
    setBusy(false);
    if (done) onClose();
  };
  const remove = async () => {
    if (!current) return;
    if (!confirmDelete) return setConfirming(current.id);
    setBusy(true);
    await deleteVersion(current.id);
    setBusy(false);
    setConfirming(null);
  };

  return (
    <Dialog
      title="Versions"
      className="versions-dialog"
      onClose={onClose}
      onSubmit={() => void restore()}
      actions={
        current ? (
          <>
            <button
              type="button"
              className="button button-danger versions-delete"
              disabled={busy}
              onClick={() => void remove()}
            >
              {confirmDelete ? `Delete “${current.name}” for good` : "Delete"}
            </button>
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="button button-primary" disabled={busy}>
              Restore this version
            </button>
          </>
        ) : (
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      {current ? (
        <div className="versions-layout">
          <div className="versions-list" role="listbox" aria-label="Saved versions">
            {versions.map((v) => (
              <div
                key={v.id}
                role="option"
                tabIndex={v.id === current.id ? 0 : -1}
                aria-selected={v.id === current.id}
                className="versions-item"
                title={fullDate(v.savedAt)}
                onClick={() => setPicked(v.id)}
                onKeyDown={(e) => {
                  const at = versions.findIndex((x) => x.id === v.id);
                  const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                  const next = versions[at + step];
                  if (step && next) {
                    e.preventDefault();
                    setPicked(next.id);
                    (e.currentTarget.parentElement?.children[at + step] as HTMLElement)?.focus();
                  }
                }}
              >
                <span className="versions-name">{v.name}</span>
                <span className="versions-meta">
                  {timeAgo(Date.parse(v.savedAt), Date.now())} · {slidesLabel(v.slideCount)}
                </span>
              </div>
            ))}
          </div>
          <VersionPreview key={current.id} deckId={deckId} version={current} />
        </div>
      ) : (
        <div className="versions-empty">
          <History size={28} aria-hidden="true" />
          <p>No versions yet.</p>
          <p className="dialog-hint">
            Save one before a big change, like asking an agent to rework the deck. You can always
            come back to it.
          </p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => openDialog("save-version")}
          >
            Save version…
          </button>
        </div>
      )}
    </Dialog>
  );
}

/** A version's slides, read-only, fetched from the server when it's picked. */
function VersionPreview({ deckId, version }: { deckId: string; version: VersionInfo }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    client.openVersion(version.id).then(
      (d) => live && setDeck(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [version.id]);

  return (
    <section className="versions-preview" aria-label={`Slides of “${version.name}”`}>
      <header className="versions-preview-head">
        <strong>{version.name}</strong>
        <span>
          Saved {fullDate(version.savedAt)} · {slidesLabel(version.slideCount)}
        </span>
      </header>
      {failed ? (
        <p className="dialog-hint">Couldn't load this version.</p>
      ) : !deck ? (
        <p className="dialog-hint">Loading…</p>
      ) : deck.slides.length === 0 ? (
        <p className="dialog-hint">This version has no slides.</p>
      ) : (
        <ol className="versions-slides">
          {deck.slides.map((slide, i) => (
            <li key={slide.id} className="versions-slide">
              <span className="thumb-number">{i + 1}</span>
              <SlideCanvas
                className="thumb-view"
                deck={deck}
                deckId={deckId}
                slideId={slide.id}
                padding={0}
                lazy
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
