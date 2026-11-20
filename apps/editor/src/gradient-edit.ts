/**
 * The gradient being edited in the paint picker, shared with the canvas (D87). While a
 * picker is open on a gradient, it publishes what it shows here, and the canvas draws
 * handles for it on the painted layer (or the slide, for its background). Both sides change
 * the gradient through the picker's own preview/commit, so a drag on the canvas is one undo
 * step exactly like a drag on the picker's stop bar, and the selected stop is shared.
 */
import type { Gradient, Theme } from "@veloce/core";
import { createStore } from "./store.js";

export interface GradientSession {
  /** The layer or slide whose paint this is. */
  owner: string;
  /** The gradient as the picker shows it (its own drag's draft included). */
  gradient: Gradient;
  /** The deck's theme, to show the stops' colors. */
  theme: Theme;
  /** The selected stop. */
  selected: number;
  select(index: number): void;
  /** Show a gradient live on the slide; `null` drops the preview. */
  preview(gradient: Gradient | null): void;
  /** One change, with the stop to select afterwards. */
  commit(gradient: Gradient, selected: number): void;
}

export const gradientStore = createStore<GradientSession | null>(null);
export const useGradientSession = gradientStore.use;

/**
 * True while a gradient handle is dragged on the canvas: Esc then cancels the drag, and the
 * picker's popover (which listens first) leaves it alone instead of closing.
 */
let dragging = false;
export const gradientDragging = () => dragging;
export function setGradientDragging(on: boolean) {
  dragging = on;
}
