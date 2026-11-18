/**
 * Everything that happened to the deck, by you and by agents, newest first (golden rule #7
 * made visible): consecutive changes by the same author sit under one header, each shows the
 * slides it touched (click to go there) and when. Undo stays per author: Ctrl+Z walks back
 * your own changes only, which the footer says, so the AI's work never disappears by surprise.
 */
import type { HistoryEntry, Slide } from "@veloce/core";
import { Bot, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type HistoryFilter,
  historyGroups,
  isAgent,
  originName,
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
}

export function HistoryPanel({ history, slides, currentSlideId, onGoToSlide }: Props) {
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
          {groups.map((group) => (
            <li key={group.entries[0]?.version} className="history-group">
              <div className={`history-author${isAgent(group.origin) ? " is-agent" : ""}`}>
                {isAgent(group.origin) ? <Bot size={13} /> : <User size={13} />}
                {originName(group.origin)}
              </div>
              <ol>
                {group.entries.map((entry) => {
                  const touched = entry.slideIds.filter((id) => positions.has(id));
                  const first = touched[0];
                  return (
                    <li key={entry.version}>
                      <button
                        type="button"
                        className={`history-entry${first === currentSlideId ? " is-current" : ""}`}
                        disabled={!first}
                        onClick={() => first && onGoToSlide(first)}
                      >
                        <span className="history-label">{entry.label}</span>
                        <span className="history-meta">
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
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
      <p className="history-hint">Undo only takes back your own changes. The AI's stay.</p>
    </div>
  );
}
