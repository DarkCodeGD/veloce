/**
 * A modal dialog on the native `<dialog>` element (D76): the browser traps focus, closes on
 * Esc, makes the rest of the page inert and restores focus afterwards, so none of that is
 * hand-rolled. Mount it to open it, unmount to close it: each opening starts from fresh state.
 * It opens with its first field focused: `showModal` alone would focus the header's Close
 * button, and React's `autoFocus` runs before the dialog is shown, so it can't. Closing gives
 * focus back to what opened it (the browser does, so openers must still exist: MenuButton
 * refocuses itself first). Focus left on a removed field would make every editor shortcut
 * dead (keys sent to a detached element never reach the window) until the next click.
 *
 * The body is a form, so Enter in a field submits it (`onSubmit`) like any dialog's default
 * button. Clicking the backdrop closes it, as Esc does.
 */
import { X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef } from "react";

export function Dialog({
  title,
  onClose,
  onSubmit,
  children,
  actions,
  className,
}: {
  title: string;
  /** Esc, the close button, the backdrop, or the caller after a successful submit. */
  onClose(): void;
  onSubmit(): void;
  children: ReactNode;
  /** The footer's buttons (a submit button saves). */
  actions: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog
        .querySelector<HTMLElement>(".dialog-body :is(input, textarea, button, [tabindex])")
        ?.focus();
    }
    return () => {
      dialog?.close(); // the browser gives focus back to what opened it, if it's still there
      // If it isn't, don't leave focus on this dialog's removed fields.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && (!focused.isConnected || dialog?.contains(focused))) {
        focused.blur();
      }
    };
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <dialog
      ref={ref}
      className={`dialog${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={(e) => {
        // The dialog element itself is only hit outside its box: the backdrop.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <form className="dialog-form" onSubmit={submit} noValidate>
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={() => ref.current?.close()}
          >
            <X size={16} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-actions">{actions}</footer>
      </form>
    </dialog>
  );
}

/** A labelled form field in a dialog: label above, then the control, then a hint or error. */
export function DialogField({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={`dialog-field${error ? " is-invalid" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <p className="dialog-error" id={`${htmlFor}-message`} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p className="dialog-hint" id={`${htmlFor}-message`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Props that tie a control to its DialogField's hint or error. */
export const describedBy = (id: string, error?: string, hint?: unknown) => ({
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error || hint ? `${id}-message` : undefined,
});
