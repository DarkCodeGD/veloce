import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { dismissToast, toastStore } from "../toasts.js";

/** Announced politely to screen readers; actions are real buttons. */
export function Toasts() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.get);
  return (
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
    </div>
  );
}
