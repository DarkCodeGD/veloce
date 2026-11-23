/**
 * Whether the command palette (D92) is open. A tiny store, so the command that opens it and
 * App, which renders it, never meet.
 */
import { createStore } from "./store.js";

export const paletteStore = createStore(false);
export const openPalette = () => paletteStore.set(true);
export const closePalette = () => paletteStore.set(false);
