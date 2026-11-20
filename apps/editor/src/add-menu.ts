/**
 * The Add menu's state (D81): where it's open on screen, and where its layer will go. Shift+A
 * opens it at the pointer, a right-click at the click, the tool bar's ➕ under the button.
 */
import { createStore } from "./store.js";

export interface AddMenuState {
  /** Screen point the menu opens from. */
  left: number;
  top: number;
  /** Where to add, in screen pixels; null: where a paste would go. */
  at: { x: number; y: number } | null;
  /** The element to focus when it closes (the button that opened it), if any. */
  returnFocus?: HTMLElement | null;
}

export const addMenuStore = createStore<AddMenuState | null>(null);
export const openAddMenu = (state: AddMenuState) => addMenuStore.set(state);
export const closeAddMenu = () => addMenuStore.set(null);

/** The pointer's last spot in the window, for Shift+A (key presses don't carry one). */
let pointer: { x: number; y: number } | null = null;
let tracking = false;

export function trackPointer(): void {
  if (tracking) return;
  tracking = true;
  const note = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
  };
  window.addEventListener("pointermove", note, { passive: true });
  window.addEventListener("pointerdown", note, { passive: true });
  // Left the window: Shift+A then has no spot, and opens at the canvas's centre.
  document.documentElement.addEventListener("pointerleave", () => {
    pointer = null;
  });
}

/** The pointer's spot if it's over the canvas (where a layer can go), else null. */
export function pointerOverCanvas(): { x: number; y: number } | null {
  if (!pointer) return null;
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  return hit?.closest(".editor-canvas") ? pointer : null;
}

/** The canvas's centre on screen (Shift+A with the pointer elsewhere). */
export function canvasCentre(): { x: number; y: number } {
  const rect = document.querySelector(".editor-canvas")?.getBoundingClientRect();
  return rect
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 }
    : { x: window.innerWidth / 2, y: window.innerHeight / 3 };
}
