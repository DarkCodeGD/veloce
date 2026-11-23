/**
 * The workspace layout on screen (D90): which workspace, and its panels' sizes and collapsed
 * states. A tiny store, so the View menu's commands, the splitters and App share it without
 * prop drilling, and it's remembered across launches.
 *
 * Remembered in this browser profile (localStorage), like VS Code keeps its layout out of
 * settings.json: it's how this window was left, not a preference (D53 §5 keeps those in the
 * server's settings file) and never deck content.
 */
import { useSyncExternalStore } from "react";
import {
  DEFAULT_LAYOUT,
  type LayoutState,
  type PanelId,
  type PanelLayout,
  panelLayout,
  parseLayout,
  withPanel,
} from "./model/workspace.js";

const STORAGE_KEY = "veloce.layout";
/** Writes wait this long, so a burst of changes (keys held on a splitter) saves once. */
const SAVE_DELAY_MS = 250;

let state: LayoutState = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load(): LayoutState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? parseLayout(JSON.parse(raw)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT; // storage blocked, or not JSON: start from the preset
  }
}

function save(): void {
  saveTimer = undefined;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked: the layout just isn't remembered
  }
}

// A pending save still lands when the window closes.
globalThis.addEventListener?.("pagehide", () => {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    save();
  }
});

function set(next: LayoutState): void {
  if (next === state) return;
  state = next;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const layoutState = (): LayoutState => state;

/** One panel of the current workspace, as it is now. */
export const panel = (id: PanelId): PanelLayout => panelLayout(state, id);

/** Resizes, collapses or opens a panel of the current workspace. */
export const updatePanel = (id: PanelId, patch: Partial<PanelLayout>): void =>
  set(withPanel(state, id, patch));

export const setPanelCollapsed = (id: PanelId, collapsed: boolean): void =>
  updatePanel(id, { collapsed });

export const togglePanel = (id: PanelId): void => setPanelCollapsed(id, !panel(id).collapsed);

/** The layout, re-rendering when it changes. */
export function useLayout(): LayoutState {
  return useSyncExternalStore(subscribe, layoutState);
}
