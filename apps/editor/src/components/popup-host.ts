/**
 * Where a popup (a dropdown's list, a color picker) is portaled: the open modal dialog its
 * trigger is in, else the body. `showModal` makes everything outside the dialog inert, so a
 * popup portaled to the body from inside a dialog could be seen but never clicked (D76).
 */
export function popupHost(from: Element | null | undefined): HTMLElement {
  return from?.closest<HTMLElement>("dialog[open]") ?? document.body;
}

/**
 * The modal dialogs open right now, last opened on top (D108). Feedback that isn't tied to a
 * trigger, toasts, is portaled into the topmost one: outside it, it would be inert, and an
 * error or an Undo from a dialog's own action could be seen but never clicked. Popovers
 * don't help: Chrome makes them inert behind a modal dialog too (checked, Chromium 156).
 */
let modals: readonly HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const modalStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The topmost open modal dialog, or null. */
  top: (): HTMLDialogElement | null => modals.at(-1) ?? null,
};

/** Records a dialog just opened with `showModal`; call the result when it closes. */
export function trackModal(dialog: HTMLDialogElement): () => void {
  modals = [...modals, dialog];
  emit();
  return () => {
    modals = modals.filter((d) => d !== dialog);
    emit();
  };
}
