/**
 * "Recently used" lists kept in this browser (the Add menu, the command palette): IDs, most
 * recent first. Storage can be missing or blocked (a private window): the lists are a
 * convenience, never required, so every failure just means "nothing remembered".
 */
import { rememberRecent } from "./model/insert.js";

export function loadRecent(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Puts `id` first in the list under `key`, keeping at most `max`. */
export function noteRecent(key: string, id: string, max?: number): void {
  try {
    localStorage.setItem(key, JSON.stringify(rememberRecent(loadRecent(key), id, max)));
  } catch {
    // Blocked storage: nothing is remembered.
  }
}
