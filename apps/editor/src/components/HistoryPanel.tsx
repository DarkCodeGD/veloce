/**
 * Everything that happened to the deck, by you and by agents, newest first (golden rule #7
 * made visible): consecutive changes by the same author sit under one header, each shows the
 * slides it touched (click to go there) and when. Undo stays per author: Ctrl+Z walks back
 * your own changes only, so the AI's work never disappears by surprise.
 *
 * Reviewing AI work (D71): "Revert" on an agent's run of changes, or on one change, takes it
 * back as a change of your own, so Ctrl+Z brings it back. Reverted changes stay listed,
 * struck through, and the agent is told on its next call.
 */
import type { HistoryEntry, Slide } from "@veloce/core";
import { Bot, Undo2, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  canRevert,
  type HistoryFilter,
  historyGroups,
  isAgent,
  originName,
  revertVersions,
  timeAgo,
} from "../model/history.js";

/** Slide chips per entry, before "+N". */
const MAX_CHIPS = 3;
const FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "you", label: "You" },
  { id: "ai", label: "AI" },
];

const EMPTY: Record<HistoryFilter, string> = {
  all: "No changes yet. Everything you and the AI change shows up here.",
  you: "You haven't changed anything yet.",
  ai: "The AI hasn't changed anything yet.",
};

interface Props {
  history: readonly HistoryEntry[];
  slides: readonly Slide[];
  currentSlideId: string;
  onGoToSlide(id: string): void;
  /** Revert these agent changes (history versions) as one change of the user's. */
  onRevert(versions: number[]): void;
}

export function HistoryPanel({ history, slides, currentSlideId, onGoToSlide, onRevert }: Props) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const groups = useMemo(() => historyGroups(history, filter), [history, filter]);
  const positions = useMemo(() => new Map(slides.map((s, i) => [s.id, i + 1])), [slides]);
  // "5 min ago" ages while the panel is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  // A new change arrived: it's "just now", whatever the timer says.
  const latest = history.at(-1)?.at ?? 0;
  const clock = Math.max(now, latest);

  return (
    <div className="history-panel">
      <fieldset className="history-filter">
        <legend className="sr-only">Show changes by</legend>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </fieldset>
      {groups.length === 0 ? (
        <p className="panel-empty">{EMPTY[history.length === 0 ? "all" : filter]}</p>
      ) : (
        <ol className="history-list" aria-label="Changes, newest first">
          {groups.map((group) => {
            const name = originName(group.origin);
            const open = revertVersions(group.entries);
            return (
              <li key={group.entries[0]?.version} className="history-group">
                <div className={`history-author${isAgent(group.origin) ? " is-agent" : ""}`}>
                  {isAgent(group.origin) ? <Bot size={13} /> : <User size={13} />}
                  <span className="history-author-name">{name}</span>
                  {open.length > 1 && (
                    <button
                      type="button"
                      className="history-revert-all"
                      aria-label={`Revert all ${open.length} of ${name}'s changes here`}
                      data-tip="Take these changes back (Ctrl+Z restores them)"
                      onClick={() => onRevert(open)}
                    >
                      <Undo2 size={12} /> Revert all
                    </button>
                  )}
                </div>
                <ol>
                  {group.entries.map((entry) => {
                    const touched = entry.slideIds.filter((id) => positions.has(id));
                    const first = touched[0];
                    return (
                      <li
                        key={entry.version}
                        className={`history-item${entry.reverted ? " is-reverted" : ""}`}
                      >
                        <button
                          type="button"
                          className={`history-entry${first === currentSlideId ? " is-current" : ""}`}
                          disabled={!first}
                          onClick={() => first && onGoToSlide(first)}
                        >
                          <span className="history-label">{entry.label}</span>
                          <span className="history-meta">
                            {entry.reverted && <span className="history-chip">Reverted</span>}
                            {touched.slice(0, MAX_CHIPS).map((id) => (
                              <span key={id} className="history-chip">
                                <span className="sr-only">Slide </span>
                                {positions.get(id)}
                              </span>
                            ))}
                            {touched.length > MAX_CHIPS && (
                              <span className="history-chip">+{touched.length - MAX_CHIPS}</span>
                            )}
                            <time dateTime={new Date(entry.at).toISOString()}>
                              {timeAgo(entry.at, clock)}
                            </time>
                          </span>
                        </button>
                        {canRevert(entry) && (
                          <button
                            type="button"
                            className="history-revert"
                            aria-label={`Revert "${entry.label}"`}
                            data-tip="Revert this change"
                            onClick={() => onRevert([entry.version])}
                          >
                            <Undo2 size={13} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>
      )}
      <p className="history-hint">
        Undo only takes back your own changes. Revert an AI change from its row.
      </p>
    </div>
  );
}
