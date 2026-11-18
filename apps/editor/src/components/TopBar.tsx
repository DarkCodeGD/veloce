import type { DeckListing } from "@veloce/core";
import { Redo2, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { redo, undo } from "../actions.js";
import { originName } from "../model/history.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import { shortcutAttrs } from "../platform.js";
import type { ConnectionStatus, LastChange } from "../sync-client.js";
import { Select } from "./Select.js";

interface Props {
  status: ConnectionStatus;
  decks: DeckListing[];
  deckId: string | null;
  title: string | null;
  activity: LastChange | null;
  follow: boolean;
  onFollowChange(follow: boolean): void;
  onOpenDeck(deckId: string): void;
  position: string | null;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  online: "Live",
  offline: "Offline: reconnecting",
};

export function TopBar({
  status,
  decks,
  deckId,
  title,
  activity,
  follow,
  onFollowChange,
  onOpenDeck,
  position,
}: Props) {
  // The document leads; the app's name lives in the window/tab title, as in Figma or Keynote.
  useEffect(() => {
    document.title = title ? `${title} – Veloce` : "Veloce";
  }, [title]);

  return (
    <header className="topbar">
      <div className="deck-picker">
        {decks.length > 1 ? (
          <Select
            aria-label="Open deck"
            className="deck-select"
            value={deckId ?? ""}
            options={decks.map((d) => ({ value: d.id, label: d.title }))}
            onChange={onOpenDeck}
          />
        ) : (
          <span className="deck-title">{title ?? "No deck"}</span>
        )}
        {position && <span className="deck-position">{position}</span>}
      </div>

      <div className="history">
        <button
          type="button"
          className="icon-button"
          aria-label="Undo"
          data-tip="Undo"
          {...shortcutAttrs(SHORTCUTS.undo)}
          onClick={undo}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Redo"
          data-tip="Redo"
          {...shortcutAttrs(SHORTCUTS.redo)}
          onClick={redo}
        >
          <Redo2 size={16} />
        </button>
      </div>

      <div className="topbar-right">
        {activity && (
          <span className="activity" key={activity.at} role="status">
            <span className="activity-dot" aria-hidden="true" />
            <strong>{originName(activity.origin)}</strong>
            <span className="activity-label">{activity.label}</span>
          </span>
        )}
        <label className="follow" data-tip="Jump to the slide the AI is working on">
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={follow}
            aria-checked={follow}
            onChange={(e) => onFollowChange(e.target.checked)}
          />
          Follow AI
        </label>
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
      </div>
    </header>
  );
}
