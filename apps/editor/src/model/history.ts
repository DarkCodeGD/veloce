/**
 * The history panel's logic, pure: who made a change, how long ago, how a list of changes
 * reads (newest first, consecutive changes by the same author grouped under one header), and
 * what reverting an AI change takes back (D71).
 */
import { type HistoryEntry, isAgentOrigin, type Origin } from "@veloce/core";

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

/** The user can revert an agent's change that's still in effect (their own: Ctrl+Z). */
export const canRevert = (entry: HistoryEntry): boolean =>
  isAgentOrigin(entry.origin) && !entry.reverted;

/** Versions to send for reverting `entries` (those still revertable). */
export const revertVersions = (entries: readonly HistoryEntry[]): number[] =>
  entries.filter(canRevert).map((e) => e.version);

/**
 * The toast after reverting `versions`: what went, plus the slides it touched that you'd
 * edited since (a revert of "Add slide" takes your edits on that slide with it; Undo brings
 * both back). Only real edits count: your reverts, and undoing or redoing them, only moved
 * AI content around (D72). Slides are numbered as they were before the revert, so a slide
 * the revert removed still has a number; `stillThere` says which ones it removed.
 */
export function revertMessage(
  history: readonly HistoryEntry[],
  versions: readonly number[],
  numberBefore: (slideId: string) => number | undefined,
  stillThere: (slideId: string) => boolean,
): string {
  const wanted = new Set(versions);
  const targets = history.filter((e) => wanted.has(e.version));
  const first = targets[0];
  const head =
    targets.length === 1 && first
      ? `Reverted "${first.label}".`
      : `Reverted ${versions.length} AI changes.`;
  const oldest = Math.min(...versions);
  const touched = new Set(targets.flatMap((e) => e.slideIds));
  const yours = new Set(
    history
      .filter(
        (e) =>
          e.origin === "user" &&
          e.version > oldest &&
          !wanted.has(e.version) &&
          !e.reverts &&
          !e.restores,
      )
      .flatMap((e) => e.slideIds)
      .filter((id) => touched.has(id)),
  );
  if (!yours.size) return head;
  const numbered = (ids: string[]) => {
    const numbers = ids
      .map(numberBefore)
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b);
    if (!numbers.length) return ids.length === 1 ? "a slide" : `${ids.length} slides`;
    const unknown = ids.length - numbers.length;
    const list = `${numbers.length === 1 ? "slide" : "slides"} ${numbers.join(", ")}`;
    return unknown ? `${list} and ${unknown} more` : list;
  };
  const kept = [...yours].filter(stillThere);
  const removed = [...yours].filter((id) => !stillThere(id));
  const parts = [
    kept.length && `touched ${numbered(kept)}`,
    removed.length && `removed ${numbered(removed)}`,
  ].filter(Boolean);
  return `${head} It also ${parts.join(" and ")} you'd edited since.`;
}
