/**
 * Inspector controls. Every control has a visible label, commits on Enter/blur (text, numbers)
 * or immediately (choices), and can reset to the default (`null` in the patch).
 * Token-aware: colors and lengths offer the theme's tokens first, raw values second.
 */
import { type Deck, primaryFamily, resolveColor, type Theme } from "@veloce/core";
import { RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { assetUrl } from "../editor-context.js";
import type { Imported } from "../model/asset-insert.js";
import {
  baseToken,
  colorLabel,
  fromPicked,
  keepOpacity,
  opacityOf,
  type PickedColor,
  parseTypedColor,
  pickerColor,
  withOpacity,
} from "../model/color.js";
import { paintCss, paintLabel } from "../model/paint.js";
import { parseNumber } from "../model/scrub.js";
import { nearestColorToken } from "../model/theme-edit.js";
import { ColorPicker, ColorPopover } from "./ColorPicker.js";
import { PaintPicker } from "./PaintPicker.js";
import { Select, type SelectOption } from "./Select.js";
import { useNumberControl } from "./useNumberControl.js";

type LabelProps = ReturnType<typeof useNumberControl>["labelProps"];

/** Shown on a scrubbable label. */
const SCRUB_TIP = "Drag to adjust · Shift ×10 · Alt fine · ↑↓ in the field";

type Value = unknown;
export type Commit = (value: Value | null) => void;

export function Field({
  label,
  htmlFor,
  isSet,
  onReset,
  scrub,
  scrubbing,
  children,
}: {
  label: string;
  htmlFor?: string;
  isSet?: boolean;
  onReset?: () => void;
  /** Makes the label a scrub handle for a number input. */
  scrub?: LabelProps;
  scrubbing?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {htmlFor ? (
        <label
          className={`field-label${scrub ? " is-scrubbable" : ""}${scrubbing ? " is-scrubbing" : ""}`}
          htmlFor={htmlFor}
          data-tip={scrub ? SCRUB_TIP : undefined}
          {...scrub}
        >
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
          data-tip="Reset to default"
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
  integer,
  suffix,
  fallback,
  onCommit,
  onPreview,
}: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  suffix?: string;
  /** Where scrubbing starts when unset. Default: the placeholder, if it's a number. */
  fallback?: () => number | undefined;
  onCommit: Commit;
  onPreview?: (value: number | null) => void;
}) {
  const id = useId();
  const control = useNumberControl({
    value,
    min,
    max,
    step,
    integer,
    fallback: fallback ?? (() => parseNumber(placeholder ?? "") ?? undefined),
    onCommit,
    onPreview,
  });
  return (
    <Field
      label={label}
      htmlFor={id}
      isSet={value !== undefined}
      onReset={() => onCommit(null)}
      scrub={control.labelProps}
      scrubbing={control.scrubbing}
    >
      <div className="input-with-suffix">
        <input id={id} placeholder={placeholder} {...control.inputProps} />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </Field>
  );
}

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
        role="switch"
        className="switch"
        checked={value === true}
        aria-checked={value === true}
        onChange={(e) => onCommit(e.target.checked ? true : null)}
      />
    </Field>
  );
}

/**
 * Theme tokens of one group, as select options: `$space.md` → "md", hinted "32". Fonts and
 * text styles show in their own typeface, hinted with the family / size and weight, so you
 * pick by look, not by token name.
 */
export function tokenOptions(theme: Theme, group: string): SelectOption[] {
  if (group === "font") {
    return Object.entries(theme.fonts).map(([name, stack]) => ({
      value: `$font.${name}`,
      label: name,
      hint: primaryFamily(stack),
      fontFamily: stack,
    }));
  }
  if (group === "text") {
    return Object.entries(theme.text).map(([name, style]) => ({
      value: `$text.${name}`,
      label: name,
      hint: `${style.size} · ${style.weight}`,
      fontFamily: theme.fonts[style.font],
    }));
  }
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
  onPreview,
  current,
}: {
  label: string;
  value: unknown;
  theme: Theme;
  group: string;
  onCommit: Commit;
  onPreview?: (value: number | null) => void;
  /** The rendered size in pixels, where "Custom…" starts. */
  current?: () => number | undefined;
}) {
  const id = useId();
  const isToken = typeof value === "string";
  const [custom, setCustom] = useState(typeof value === "number");
  useEffect(() => setCustom(typeof value === "number"), [value]);
  const control = useNumberControl({
    value: typeof value === "number" ? value : undefined,
    min: 0,
    fallback: current,
    onCommit,
    onPreview,
  });
  return (
    <Field
      label={label}
      htmlFor={id}
      isSet={value !== undefined}
      onReset={() => onCommit(null)}
      scrub={custom ? control.labelProps : undefined}
      scrubbing={control.scrubbing}
    >
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
            <input aria-label={`${label} in pixels`} placeholder="0" {...control.inputProps} />
            <span className="suffix">px</span>
          </div>
        )}
      </div>
    </Field>
  );
}

/**
 * Theme color swatches first, then any color (typed, or from the color picker the chip
 * opens), and an opacity in percent next to it. A token at an opacity stays a token
 * (`$color.secondary/30`), so glows and tints follow theme switches; a raw hex takes an alpha
 * byte. Changing the color keeps the opacity (like Figma). The text shows a token by its name
 * (`primary`), so it fits beside the opacity. A raw color gets a one-click "use the closest
 * theme color".
 *
 * With `paint`, the field holds a fill or background: the chip opens the paint picker
 * (gradients and images too, D66), and a gradient or image shows as its kind in the row.
 * Without it, gradients and images are kept, not edited.
 */
export function ColorField({
  label,
  value,
  theme,
  onCommit,
  onPreview,
  paint,
}: {
  label: string;
  value: unknown;
  theme: Theme;
  /** One change; `imported` is a file uploaded for an image fill (paint fields only). */
  onCommit: (value: Value | null, imported?: Imported) => void;
  /** Show a value live while the opacity or picker is dragged; `null` drops the preview. */
  onPreview?: (value: unknown | null) => void;
  /** A paint (fill, background): gradients and images can be made here too. */
  paint?: {
    deck: Pick<Deck, "id" | "assets">;
    /** Where a gradient starts when there's no color yet. Default: the primary color. */
    fallback?: string;
  };
}) {
  const id = useId();
  const chip = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const isObject = typeof value === "object" && value !== null;
  const text = typeof value === "string" ? value : undefined;
  const chipCss = paint ? paintCss(value, theme, (id) => assetUrl(paint.deck.id, id)) : undefined;
  const resolved = text === undefined ? undefined : resolveColor(theme, text);
  /** Any new color, at the opacity the current one has. */
  const pick = (color: string) => onCommit(keepOpacity(value, color));
  const draft = useDraft(colorLabel(value), (typed) => {
    if (typed.trim() === "") return onCommit(null);
    const color = parseTypedColor(typed, theme.colors, value);
    if (color !== null && color !== value) onCommit(color);
  });
  const shown = pickerColor(resolved, value);
  /** The picker's color as a document color (a token stays a token if only alpha moved). */
  const picked = (p: PickedColor) => fromPicked(value, shown.hex, p);
  const opacity = opacityOf(value);
  const opacityControl = useNumberControl({
    value: opacity ?? undefined,
    min: 0,
    max: 100,
    integer: true,
    onCommit: (pct) => {
      if (text !== undefined) onCommit(withOpacity(text, pct ?? 100));
    },
    onPreview: (pct) => {
      if (text !== undefined) onPreview?.(pct === null ? null : withOpacity(text, pct));
    },
  });
  // A raw color (not a token): offer the closest theme color, so the slide stays on-theme and
  // follows the next theme switch.
  const snapToken = text?.startsWith("#") ? nearestColorToken(theme, text) : null;
  const snap = snapToken
    ? { token: snapToken, name: snapToken.slice(7), hex: theme.colors[snapToken.slice(7)] }
    : null;
  const colorPicker = (
    <ColorPicker
      label={label}
      value={shown}
      onPreview={(p) => onPreview?.(picked(p))}
      onCommit={(p) => {
        const next = picked(p);
        if (next !== value) onCommit(next);
        else onPreview?.(null);
      }}
    />
  );
  const popover = (
    <ColorPopover title={label} trigger={chip} onClose={() => setPicking(false)}>
      {paint ? (
        <PaintPicker
          label={label}
          value={value}
          theme={theme}
          deck={paint.deck}
          fallback={paint.fallback ?? defaultPaintColor(theme)}
          onPreview={(next) => onPreview?.(next)}
          onCommit={(next, imported) => onCommit(next, imported)}
        >
          {colorPicker}
        </PaintPicker>
      ) : (
        colorPicker
      )}
    </ColorPopover>
  );
  return (
    <Field label={label} htmlFor={id} isSet={value !== undefined} onReset={() => onCommit(null)}>
      <div className="color">
        {isObject && !paint ? (
          <span className="color-note">
            {(value as { type?: string }).type === "image" ? "Image fill" : "Gradient"}: pick a
            swatch to replace it
          </span>
        ) : isObject ? (
          // A gradient or image: its kind, and the picker to edit it.
          <div className="color-row">
            <div className="color-input">
              <button
                ref={chip}
                type="button"
                className={`color-chip${picking ? " is-open" : ""}`}
                style={{ "--chip-paint": chipCss } as React.CSSProperties}
                aria-label={`${label}: color picker`}
                aria-haspopup="dialog"
                aria-expanded={picking}
                onClick={() => setPicking((open) => !open)}
              />
              <button
                type="button"
                id={id}
                className="paint-name"
                aria-haspopup="dialog"
                aria-expanded={picking}
                onClick={() => setPicking((open) => !open)}
              >
                {paintLabel(value)}
              </button>
            </div>
            {picking && popover}
          </div>
        ) : (
          <div className="color-row">
            <div className="color-input">
              {/* The chip opens the color picker, for a color outside the theme. */}
              <button
                ref={chip}
                type="button"
                className={`color-chip${picking ? " is-open" : ""}${resolved === undefined ? " is-unset" : ""}`}
                style={{ "--chip": resolved ?? "transparent" } as React.CSSProperties}
                aria-label={`${label}: color picker`}
                aria-haspopup="dialog"
                aria-expanded={picking}
                onClick={() => setPicking((open) => !open)}
              />
              <input id={id} type="text" spellCheck={false} placeholder="Default" {...draft} />
            </div>
            {opacity !== null && (
              <div className="input-with-suffix color-opacity">
                <input aria-label={`${label} opacity`} {...opacityControl.inputProps} />
                <span className="suffix">%</span>
              </div>
            )}
            {picking && popover}
          </div>
        )}
        {snap && (
          <button type="button" className="color-snap" onClick={() => pick(snap.token)}>
            <span className="color-snap-dot" style={{ background: snap.hex }} />
            Use theme color “{snap.name}”
          </button>
        )}
        <Swatches theme={theme} label={label} value={value} onPick={pick} />
      </div>
    </Field>
  );
}

/** A theme color to start a gradient from when there's none: primary, else the first. */
function defaultPaintColor(theme: Theme): string {
  const name = Object.hasOwn(theme.colors, "primary") ? "primary" : Object.keys(theme.colors)[0];
  return name ? `$color.${name}` : "#4f46e5";
}

/**
 * The theme's colors as round swatches; picking one sets its token (`$color.primary`), so the
 * color follows theme switches. Shared by the inspector and the text toolbar.
 */
export function Swatches({
  theme,
  label,
  value,
  onPick,
  keepFocus = false,
}: {
  theme: Theme;
  /** Names each swatch for screen readers: "<label>: primary". */
  label: string;
  /** The current color: its swatch shows as picked. */
  value: unknown;
  onPick(token: string): void;
  /** Pressing a swatch leaves the focus where it is (the text being typed into). */
  keepFocus?: boolean;
}) {
  return (
    <div className="swatches">
      {Object.entries(theme.colors).map(([name, hex]) => {
        const token = `$color.${name}`;
        const on = baseToken(value) === token; // at any opacity
        return (
          <button
            key={name}
            type="button"
            className={`swatch${on ? " is-on" : ""}`}
            style={{ background: hex }}
            aria-label={`${label}: ${name}`}
            aria-pressed={on}
            data-tip={`${name} · ${hex}`}
            onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
            onClick={() => onPick(token)}
          />
        );
      })}
    </div>
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
  onPreview,
}: {
  label: string;
  value: unknown;
  /** The rendered size, used when switching to "Fixed". */
  current: number | undefined;
  onCommit: Commit;
  onPreview?: (value: number | null) => void;
}) {
  const id = useId();
  const mode =
    typeof value === "number" ? "fixed" : value === "fill" ? "fill" : value === "hug" ? "hug" : "";
  const control = useNumberControl({
    value: typeof value === "number" ? value : undefined,
    min: 1,
    integer: true,
    fallback: () => current,
    onCommit,
    onPreview,
  });
  return (
    <Field
      label={label}
      htmlFor={id}
      scrub={mode === "fixed" ? control.labelProps : undefined}
      scrubbing={control.scrubbing}
    >
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
            <input aria-label={`${label} in pixels`} {...control.inputProps} />
            <span className="suffix">px</span>
          </div>
        )}
      </div>
    </Field>
  );
}

/** A top-level inspector block ("Layer", "Theme"), divided from the next by a rule. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="inspector-section">
      <h3 className="inspector-section-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A titled group inside a section ("Colors" and "Fonts" in Theme): set apart by space and a
 * smaller, sentence-case heading, so it reads as one level below the section title.
 */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="inspector-group">
      <h4 className="inspector-group-title">{title}</h4>
      {children}
    </div>
  );
}
