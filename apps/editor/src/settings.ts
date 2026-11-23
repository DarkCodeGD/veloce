/**
 * The app settings in the editor (D91): what the server sent, read by components through
 * `useSettings` and by plain code (drags, keys) through `settings()`. A change goes to the
 * server, which saves it and sends it to every tab, this one included: no local copy that
 * could disagree with the file.
 */
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch,
  type SettingsReport,
} from "@veloce/core";
import { useSyncExternalStore } from "react";
import { client } from "./editor-context.js";
import { showToast } from "./toasts.js";

/** The settings now (the defaults until the server's arrive). */
export const settings = (): Settings => client.getState().settings?.settings ?? DEFAULT_SETTINGS;

const report = (): SettingsReport | null => client.getState().settings;

/** The settings, re-rendering when they change. */
export function useSettings(): Settings {
  return useSyncExternalStore(client.subscribe, settings);
}

/** The settings with where they're stored and what the server runs with; null until known. */
export function useSettingsReport(): SettingsReport | null {
  return useSyncExternalStore(client.subscribe, report);
}

/** Changes some settings; a refusal (an out-of-range value) shows the server's reason. */
export function changeSettings(patch: SettingsPatch): void {
  client.updateSettings(patch).catch((error: unknown) => {
    showToast({ message: error instanceof Error ? error.message : String(error), tone: "error" });
  });
}
