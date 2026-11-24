/**
 * File → Manage decks… (D99): every deck in the workspace, most recently edited first, to
 * open one or move it to the trash, several in a row. Trashing is the same undoable step as
 * File → Move deck to trash, so there's no "are you sure?": its toast's Undo, which shows
 * over the dialog (D108).
 * The list is the server's, live: a deck an agent creates or another tab trashes shows here.
 */
import type { DeckListing } from "@veloce/core";
import { Presentation, Search, Trash2 } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { trashDeck } from "../actions.js";
import { openDialog } from "../dialogs.js";
import { client } from "../editor-context.js";
import { filterDecks } from "../model/decks.js";
import { timeAgo } from "../model/history.js";
import { Dialog } from "./Dialog.js";

const decksOf = () => client.getState().decks;
const openOf = () => client.getState().deckId;

const slidesLabel = (n: number) => `${n} slide${n === 1 ? "" : "s"}`;

export function ManageDecksDialog({ onClose }: { onClose(): void }) {
  const decks = useSyncExternalStore(client.subscribe, decksOf);
  const openId = useSyncExternalStore(client.subscribe, openOf);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const search = useRef<HTMLInputElement>(null);
  const shown = filterDecks(decks, query);

  const trash = async (deck: DeckListing) => {
    // Its row (and the focused button) goes: keep focus in the dialog, on the search.
    search.current?.focus();
    await trashDeck({ id: deck.id, title: deck.title });
  };

  const open = (id: string) => {
    if (id !== openId) client.open(id);
    onClose();
  };

  return (
    <Dialog
      title="Manage decks"
      className="decks-dialog"
      onClose={onClose}
      // Enter in the search opens the only match, like a launcher.
      onSubmit={() => {
        const only = shown.length === 1 ? shown[0] : undefined;
        if (only) open(only.id);
      }}
      actions={
        <>
          <button type="button" className="button" onClick={() => openDialog("new-deck")}>
            New deck…
          </button>
          <button type="button" className="button button-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {decks.length === 0 ? (
        <div className="versions-empty">
          <Presentation size={28} aria-hidden="true" />
          <p>No decks yet.</p>
          <p className="dialog-hint">Make one with New deck, or ask an agent to build one.</p>
        </div>
      ) : (
        <div className="decks-layout">
          <label className="search-field" htmlFor={searchId}>
            <Search size={14} aria-hidden="true" />
            <input
              ref={search}
              id={searchId}
              type="search"
              className="search-field-input"
              placeholder="Search decks"
              aria-label="Search decks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {shown.length === 0 ? (
            <p className="dialog-hint decks-none">No deck is called that.</p>
          ) : (
            <ul className="decks-list" aria-label="Decks">
              {shown.map((d) => (
                <DeckRow
                  key={d.id}
                  deck={d}
                  isOpen={d.id === openId}
                  onOpen={() => open(d.id)}
                  onTrash={() => void trash(d)}
                />
              ))}
            </ul>
          )}
          <p className="dialog-hint">
            Trashed decks stay in the <code>.trash</code> folder inside your decks folder for 30
            days.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function DeckRow({
  deck,
  isOpen,
  onOpen,
  onTrash,
}: {
  deck: DeckListing;
  isOpen: boolean;
  onOpen(): void;
  onTrash(): void;
}) {
  const edited = deck.modifiedAt
    ? ` · edited ${timeAgo(Date.parse(deck.modifiedAt), Date.now())}`
    : "";
  return (
    <li className="decks-item" aria-current={isOpen ? "true" : undefined}>
      <button type="button" className="decks-open" onClick={onOpen} title={deck.file}>
        <span className="decks-name">{deck.title}</span>
        <span className="decks-meta">
          {slidesLabel(deck.slideCount)}
          {edited}
        </span>
      </button>
      {isOpen && <span className="decks-badge">Open</span>}
      <button
        type="button"
        className="icon-button decks-trash"
        aria-label={`Move “${deck.title}” to trash`}
        data-tip="Move to trash"
        onClick={onTrash}
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}
