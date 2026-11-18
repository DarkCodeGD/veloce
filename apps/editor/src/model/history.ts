/**
 * The history panel's logic, pure: who made a change, how long ago, and how a list of changes
 * reads (newest first, consecutive changes by the same author grouped under one header).
 */
import type { HistoryEntry, Origin } from "@veloce/core";

export type HistoryFilter = "all" | "you" | "ai";

/** `"user"` → "You"; `"agent:claude-code"` → "Claude Code". */
export function originName(origin: Origin): string {
  if (origin === "user") return "You";
  const id = origin.slice("agent:".length);
  if (!id || id === "unknown") return "AI agent";
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export const isAgent = (origin: Origin) => origin !== "user";

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function timeAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export interface HistoryGroup {
  origin: Origin;
  /** Newest first. */
  entries: HistoryEntry[];
}

/**
 * Entries (oldest first, as the server keeps them) → groups for display: newest first, a new
 * group whenever the author changes. `filter` keeps only your changes or only the agents'.
 */
export function historyGroups(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter = "all",
): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as HistoryEntry;
    if (filter === "you" && isAgent(entry.origin)) continue;
    if (filter === "ai" && !isAgent(entry.origin)) continue;
    const last = groups.at(-1);
    if (last && last.origin === entry.origin) last.entries.push(entry);
    else groups.push({ origin: entry.origin, entries: [entry] });
  }
  return groups;
}
