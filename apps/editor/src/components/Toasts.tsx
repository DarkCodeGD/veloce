import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { dismissToast, toastStore } from "../toasts.js";
import { modalStore } from "./popup-host.js";

/**
 * Announced politely to screen readers; actions are real buttons. Shown inside the topmost
 * modal dialog while one is open (D108): everything outside it is inert, so a toast there
 * could be seen but its Undo never clicked.
 */
export function Toasts() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.get);
  const host = useSyncExternalStore(modalStore.subscribe, modalStore.top) ?? document.body;
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    host,
  );
}
