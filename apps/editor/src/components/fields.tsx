/**
 * Inspector controls. Every control has a visible label, commits on Enter/blur (text, numbers)
 * or immediately (choices), and can reset to the default (`null` in the patch).
 * Token-aware: colors and lengths offer the theme's tokens first, raw values second.
 */
import type { Theme } from "@veloce/core";
import { RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Select, type SelectOption } from "./Select.js";

type Value = unknown;
export type Commit = (value: Value | null) => void;

export function Field({
  label,
  htmlFor,
  isSet,
  onReset,
  children,
}: {
  label: string;
  htmlFor?: string;
  isSet?: boolean;
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {htmlFor ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      <div className="field-control">{children}</div>
      {isSet && onReset ? (
        <button
          type="button"
          className="icon-button field-reset"
          aria-label={`Reset ${label} to default`}
          title="Reset to default"
          onClick={onReset}
        >
          <RotateCcw size={12} />
        </button>
      ) : (
        <span className="field-reset" />
      )}
    </div>
  );
}

/** A draft that follows the document until the user types, then commits on Enter/blur. */
function useDraft(value: string, commit: (text: string) => void) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const finish = () => {
    if (!editing.current) return;
    editing.current = false;
    if (draft !== value) commit(draft);
  };
  return {
    value: draft,
    onChange: (e: { target: { value: string } }) => {
      editing.current = true;
      setDraft(e.target.value);
    },
    onBlur: finish,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation(); // typing never triggers editor shortcuts
      // Enter commits single-line fields; in a textarea it inserts a line break (blur commits).
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) finish();
      if (e.key === "Escape") {
        editing.current = false;
        setDraft(value);
      }
    },
  };
}

export function TextField({
  label,
  value,
  placeholder,
  multiline,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  placeholder?: string;
  multiline?: boolean;
  onCommit: Commit;
}) {
  const id = useId();
  const draft = useDraft(value ?? "", (text) => onCommit(text === "" ? null : text));
  return (
    <Field label={label} htmlFor={id}>
      {multiline ? (
        <textarea id={id} rows={3} placeholder={placeholder} {...draft} />
      ) : (
        <input id={id} type="text" placeholder={placeholder} {...draft} />
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  placeholder,
  min,
  max,
  step,
  suffix,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onCommit: Commit;
}) {
  const id = useId();
  const draft = useDraft(value === undefined ? "" : String(round(value)), (text) => {
    if (text.trim() === "") return onCommit(null);
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  });
  return (
    <Field label={label} htmlFor={id} isSet={value !== undefined} onReset={() => onCommit(null)}>
      <div className="input-with-suffix">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          placeholder={placeholder}
          step={step}
          {...draft}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </Field>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

export function SelectField({
  label,
  value,
  options,
  defaultLabel,
  defaultValue,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  /** Plain strings are shown humanized: "space-between" → "Space between". */
  options: ReadonlyArray<string | SelectOption>;
  /** An extra "unset" entry, for when the default isn't one of the options (e.g. "Default"). */
  defaultLabel?: string;
  /**
   * The option that applies when the value is unset. It's shown as selected, and picking it
   * resets the field (`null`), so the default never appears twice in the list.
   */
  defaultValue?: string;
  onCommit: Commit;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <Select
        id={id}
        value={value ?? defaultValue ?? ""}
        options={[
          ...(defaultLabel === undefined ? [] : [{ value: "", label: defaultLabel }]),
          ...options.map((o) => (typeof o === "string" ? { value: o, label: humanize(o) } : o)),
        ]}
        onChange={(v) => onCommit(v === "" || v === defaultValue ? null : v)}
      />
    </Field>
  );
}

/** "space-between" → "Space between". */
export const humanize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " ");

export function ToggleField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: boolean | undefined;
  onCommit: Commit;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="switch"
        checked={value === true}
        onChange={(e) => onCommit(e.target.checked ? true : null)}
      />
    </Field>
  );
}

/** Theme tokens of one group, as select options: `$space.md` → "md", hinted "32". */
export function tokenOptions(theme: Theme, group: string): SelectOption[] {
  const record = (theme as unknown as Record<string, Record<string, unknown>>)[group] ?? {};
  return Object.entries(record).map(([name, v]) => ({
    value: `$${group}.${name}`,
    label: name,
    ...((typeof v === "number" || typeof v === "string") && { hint: String(v) }),
  }));
}

export function TokenField({
  label,
  value,
  theme,
  group,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  theme: Theme;
  group: string;
  onCommit: Commit;
}) {
  return (
    <SelectField
      label={label}
      value={value}
      options={tokenOptions(theme, group)}
      defaultLabel="Default"
      onCommit={onCommit}
    />
  );
}

/** Pixels or a theme token (`$space.*`, `$radius.*`). */
export function LengthField({
  label,
  value,
  theme,
  group,
  onCommit,
}: {
  label: string;
  value: unknown;
  theme: Theme;
  group: string;
  onCommit: Commit;
}) {
  const id = useId();
  const isToken = typeof value === "string";
  const [custom, setCustom] = useState(typeof value === "number");
  useEffect(() => setCustom(typeof value === "number"), [value]);
  const draft = useDraft(typeof value === "number" ? String(value) : "", (text) => {
    const n = Number(text);
    onCommit(text.trim() === "" ? null : Number.isFinite(n) && n >= 0 ? n : (value ?? null));
  });
  return (
    <Field label={label} htmlFor={id} isSet={value !== undefined} onReset={() => onCommit(null)}>
      <div className="length">
        <Select
          id={id}
          value={isToken ? String(value) : custom ? "custom" : ""}
          options={[
            { value: "", label: "Default" },
            ...tokenOptions(theme, group),
            { value: "custom", label: "Custom…" },
          ]}
          onChange={(v) => {
            if (v === "custom") return setCustom(true);
            setCustom(false);
            onCommit(v === "" ? null : v);
          }}
        />
        {custom && (
          <div className="input-with-suffix">
            <input aria-label={`${label} in pixels`} type="number" min={0} {...draft} />
            <span className="suffix">px</span>
          </div>
        )}
      </div>
    </Field>
  );
}

/** Theme color swatches first, then any hex color. Gradients/images are kept, not edited. */
export function ColorField({
  label,
  value,
  theme,
  onCommit,
}: {
  label: string;
  value: unknown;
  theme: Theme;
  onCommit: Commit;
}) {
  const id = useId();
  const tokens = Object.entries(theme.colors);
  const isObject = typeof value === "object" && value !== null;
  const resolved =
    typeof value === "string" && value.startsWith("$color.")
      ? theme.colors[value.slice(7) as keyof typeof theme.colors]
      : typeof value === "string"
        ? value
        : undefined;
  const draft = useDraft(typeof value === "string" ? value : "", (text) => {
    const t = text.trim();
    if (t === "") return onCommit(null);
    if (
      /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) ||
      /^\$color\.[\w-]+$/.test(t) ||
      t === "transparent"
    ) {
      onCommit(t);
    }
  });
  return (
    <Field label={label} htmlFor={id} isSet={value !== undefined} onReset={() => onCommit(null)}>
      <div className="color">
        {isObject ? (
          <span className="color-note">
            {(value as { type?: string }).type === "image" ? "Image fill" : "Gradient"}: pick a
            swatch to replace it
          </span>
        ) : (
          <div className="color-input">
            <span className="color-chip" style={{ background: resolved ?? "transparent" }} />
            <input id={id} type="text" spellCheck={false} placeholder="Default" {...draft} />
          </div>
        )}
        <div className="swatches">
          {tokens.map(([name, hex]) => {
            const token = `$color.${name}`;
            return (
              <button
                key={name}
                type="button"
                className={`swatch${value === token ? " is-on" : ""}`}
                style={{ background: hex }}
                aria-label={`${label}: ${name}`}
                aria-pressed={value === token}
                title={`${name} · ${hex}`}
                onClick={() => onCommit(token)}
              />
            );
          })}
        </div>
      </div>
    </Field>
  );
}

const SIZING: SelectOption[] = [
  { value: "", label: "Auto" },
  { value: "hug", label: "Hug content" },
  { value: "fill", label: "Fill" },
  { value: "fixed", label: "Fixed" },
];

/** Width/height: hug the content, fill the parent, or a fixed size. */
export function SizingField({
  label,
  value,
  current,
  onCommit,
}: {
  label: string;
  value: unknown;
  /** The rendered size, used when switching to "Fixed". */
  current: number | undefined;
  onCommit: Commit;
}) {
  const id = useId();
  const mode =
    typeof value === "number" ? "fixed" : value === "fill" ? "fill" : value === "hug" ? "hug" : "";
  const draft = useDraft(typeof value === "number" ? String(Math.round(value)) : "", (text) => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) onCommit(n);
  });
  return (
    <Field label={label} htmlFor={id}>
      <div className="length">
        <Select
          id={id}
          value={mode}
          options={SIZING}
          onChange={(m) => {
            if (m === "fixed") onCommit(Math.max(1, Math.round(current ?? 400)));
            else onCommit(m === "" ? null : m);
          }}
        />
        {mode === "fixed" && (
          <div className="input-with-suffix">
            <input aria-label={`${label} in pixels`} type="number" min={1} {...draft} />
            <span className="suffix">px</span>
          </div>
        )}
      </div>
    </Field>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
