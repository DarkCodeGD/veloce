/**
 * Toasts: brief, non-blocking feedback. Destructive edits show one with an Undo action
 * instead of an "are you sure?" dialog. Every edit is undoable, so we don't interrupt.
 */
export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
  action?: { label: string; run(): void };
}

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const toastStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => toasts,
};

export function showToast(toast: Omit<Toast, "id">, durationMs = 5000): void {
  const id = nextId++;
  toasts = [...toasts.slice(-2), { ...toast, id }]; // at most three on screen
  emit();
  setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
