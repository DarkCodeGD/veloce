/**
 * Whether the deck is being presented, and from which slide (D116). A tiny store like
 * `dialogs.ts`, so a command, the top bar's Present button or a test can start it while
 * App renders the presentation at the top level.
 */
import { useSyncExternalStore } from "react";

export interface Presenting {
  /** The slide to start on, or null for the first. */
  from: string | null;
}

let presenting: Presenting | null = null;
const listeners = new Set<() => void>();

const set = (next: Presenting | null) => {
  presenting = next;
  for (const listener of listeners) listener();
};

export const startPresenting = (from: string | null) => set({ from });
export const stopPresenting = () => set(null);
export const isPresenting = () => presenting !== null;

export function usePresenting(): Presenting | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => presenting,
  );
}
