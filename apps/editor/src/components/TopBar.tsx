import type { DeckListing } from "@veloce/core";
import { originLabel } from "../editor-context.js";
import type { ConnectionStatus, LastChange } from "../sync-client.js";

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
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Veloce</span>
      </div>

      <div className="deck-picker">
        {decks.length > 1 ? (
          <select
            aria-label="Open deck"
            value={deckId ?? ""}
            onChange={(e) => onOpenDeck(e.target.value)}
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="deck-title">{title ?? "No deck"}</span>
        )}
        {position && <span className="deck-position">{position}</span>}
      </div>

      <div className="topbar-right">
        {activity && (
          <span className="activity" key={activity.at} role="status">
            <span className="activity-dot" aria-hidden="true" />
            <strong>{originLabel(activity.origin)}</strong>
            <span className="activity-label">{activity.label}</span>
          </span>
        )}
        <label className="follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => onFollowChange(e.target.checked)}
          />
          Follow AI
        </label>
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
      </div>
    </header>
  );
}
