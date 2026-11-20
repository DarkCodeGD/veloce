/**
 * Where a popup (a dropdown's list, a color picker) is portaled: the open modal dialog its
 * trigger is in, else the body. `showModal` makes everything outside the dialog inert, so a
 * popup portaled to the body from inside a dialog could be seen but never clicked (D76).
 */
export function popupHost(from: Element | null | undefined): HTMLElement {
  return from?.closest<HTMLElement>("dialog[open]") ?? document.body;
}
