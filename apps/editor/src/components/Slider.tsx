/**
 * The editor's sliders (D122), custom-made like its other inputs, in two flavours:
 *
 * - **`StepSliderField`** picks one of a few named stops (the motion level): the thumb
 *   springs into each notch, the stops' names sit under the track and jump there on a
 *   click, and a small mark shows the default.
 * - **`RangeSliderField`** picks a number in a range, with a typed value beside it: drag
 *   for feel, type for exact.
 *
 * Both preview as they move (`onPreview`, never an op) and commit once when you let go:
 * on release, on key up, or on blur, so a drag or four arrow presses are one undo step.
 * Double-click the track to go back to the default. Keyboard: arrows (Shift: ten steps on
 * a range), Page Up/Down, Home, End, like a native slider; `role="slider"` with a spoken
 * value (`aria-valuetext`).
 */
import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  nearestStop,
  type Range,
  snapValue,
  stopForKey,
  stopFraction,
  valueAt,
  valueForKey,
  valueFraction,
} from "../model/slider.js";
import { usePointerDrag } from "./usePointerDrag.js";

/** May return the commit's promise: the dragged value shows until it lands. */
type Commit<T> = (value: T | null) => unknown;

/**
 * A value being dragged or keyed, shown until the committed value catches up (or the
 * commit ends), so the thumb never jumps back while the op is on its way.
 */
function useDraft<T>(committed: T, onPreview: ((value: T | null) => void) | undefined) {
  const [draft, setDraftState] = useState<T | null>(null);
  const draftRef = useRef<T | null>(null);
  const setDraft = (next: T | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  // The document caught up: what's committed is what's shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the committed value changes
  useEffect(() => setDraft(null), [committed]);

  const move = (next: T) => {
    if (next === (draftRef.current ?? committed)) return;
    setDraft(next);
    onPreview?.(next);
  };
  /** The interaction is over: commit what it moved to, if anything changed. */
  const finish = (commit: (value: T) => unknown) => {
    const next = draftRef.current;
    if (next === null) return;
    if (next === committed) {
      setDraft(null);
      onPreview?.(null);
      return;
    }
    // The preview ends once the commit has landed, so what's shown never steps back.
    void Promise.resolve(commit(next)).finally(() => {
      onPreview?.(null);
      if (draftRef.current === next) setDraft(null);
    });
  };
  return { shown: draft ?? committed, move, finish, active: draft !== null };
}

/** The track: a rail, its fill up to the thumb, optional notches, the thumb. */
function SliderTrack({
  fraction,
  ticks = [],
  fill,
  dragging,
  label,
  now,
  min,
  max,
  valueText,
  children,
  ...props
}: {
  fraction: number;
  /** The ARIA value: where it is between `min` and `max`, spoken as `valueText`. */
  now: number;
  min: number;
  max: number;
  valueText: string | undefined;
  ticks?: ReadonlyArray<{ at: number; passed: boolean; isDefault: boolean }>;
  fill?: string;
  dragging: boolean;
  label: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const at = `${fraction * 100}%`;
  return (
    <div
      className={`slider${dragging ? " is-dragging" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={now}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={valueText}
      style={{ "--slider-at": at, ...(fill && { "--slider-fill": fill }) } as CSSProperties}
      {...props}
    >
      <span className="slider-rail" />
      <span className="slider-fill" />
      {ticks.map((tick) => (
        <span
          key={tick.at}
          className={`slider-tick${tick.passed ? " is-passed" : ""}${tick.isDefault ? " is-default" : ""}`}
          style={{ left: `${tick.at * 100}%` }}
        />
      ))}
      <span className="slider-thumb" />
      {children}
    </div>
  );
}

const SLIDER_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

// ── Stepped ───────────────────────────────────────────────────────────────────────────

export interface SliderStop {
  value: string;
  label: string;
}

export function StepSliderField({
  label,
  stops,
  value,
  defaultValue,
  fill,
  onPreview,
  onCommit,
}: {
  label: string;
  stops: readonly SliderStop[];
  /** Unset: the default. */
  value: string | undefined;
  defaultValue: string;
  /** The filled part of the track: a color or a gradient. */
  fill?: string;
  /** The stop it's moved to, as it moves; null once the interaction ends. */
  onPreview?(value: string | null): void;
  /** Null: back to the default (picking the default commits null too). */
  onCommit: Commit<string>;
}) {
  const labelId = useId();
  const indexOf = (v: string | undefined) =>
    Math.max(
      0,
      stops.findIndex((s) => s.value === (v ?? defaultValue)),
    );
  const committed = indexOf(value);
  const preview =
    onPreview && ((i: number | null) => onPreview(i === null ? null : (stops[i]?.value ?? null)));
  const { shown, move, finish, active } = useDraft(committed, preview);
  const [dragging, setDragging] = useState(false);
  const commitIndex = (i: number) => {
    const next = stops[i]?.value;
    return onCommit(next === undefined || next === defaultValue ? null : next);
  };

  const drag = usePointerDrag<HTMLDivElement>((x, _y, phase) => {
    setDragging(phase !== "end");
    move(nearestStop(x, stops.length));
    if (phase === "end") finish(commitIndex);
  });
  const onKeyDown = (e: KeyboardEvent) => {
    const next = stopForKey(e.key, shown, stops.length);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // not a layer nudge or a slide change
    move(next);
  };
  const current = stops[shown];

  return (
    <div className="slider-field">
      <div className="slider-head">
        <span className="slider-label" id={labelId}>
          {label}
        </span>
        <span className={`slider-value${active ? " is-live" : ""}`}>{current?.label}</span>
      </div>
      <SliderTrack
        label={label}
        aria-labelledby={labelId}
        min={0}
        max={stops.length - 1}
        now={shown}
        valueText={current?.label}
        fraction={stopFraction(shown, stops.length)}
        fill={fill}
        dragging={dragging}
        ticks={stops.map((stop, i) => ({
          at: stopFraction(i, stops.length),
          passed: i <= shown,
          isDefault: stop.value === defaultValue,
        }))}
        {...drag}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => SLIDER_KEYS.has(e.key) && finish(commitIndex)}
        onBlur={() => finish(commitIndex)}
        onDoubleClick={() => value !== undefined && void onCommit(null)}
      />
      <div className="slider-stops" aria-hidden>
        {stops.map((stop, i) => (
          <button
            key={stop.value}
            type="button"
            tabIndex={-1}
            className={`slider-stop${i === shown ? " is-current" : ""}`}
            style={{ left: `${stopFraction(i, stops.length) * 100}%` }}
            onClick={() => i !== committed && void commitIndex(i)}
          >
            {stop.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Continuous ────────────────────────────────────────────────────────────────────────

export function RangeSliderField({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  suffix,
  fill,
  onPreview,
  onCommit,
}: {
  label: string;
  /** Unset: the default. */
  value: number | undefined;
  defaultValue: number;
  suffix?: string;
  fill?: string;
  onPreview?(value: number | null): void;
  /** Null: back to the default. */
  onCommit: Commit<number>;
} & Range) {
  const labelId = useId();
  const range: Range = { min, max, step };
  const committed = value ?? defaultValue;
  const { shown, move, finish, active } = useDraft(committed, onPreview);
  const [dragging, setDragging] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const commit = (next: number) => onCommit(next === defaultValue ? null : next);

  const drag = usePointerDrag<HTMLDivElement>((x, _y, phase) => {
    setDragging(phase !== "end");
    move(valueAt(x, range));
    if (phase === "end") finish(commit);
  });
  const finishTyping = () => {
    if (typed === null) return;
    const parsed = Number.parseFloat(typed);
    setTyped(null);
    if (Number.isFinite(parsed)) {
      const next = snapValue(parsed, range);
      if (next !== committed) void commit(next);
    }
  };

  return (
    <div className="slider-field">
      <div className="slider-head">
        <span className="slider-label" id={labelId}>
          {label}
        </span>
        <span className={`input-with-suffix slider-number${active ? " is-live" : ""}`}>
          <input
            type="text"
            inputMode="decimal"
            spellCheck={false}
            aria-label={`${label} value`}
            value={typed ?? String(shown)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={finishTyping}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTyped(null);
                e.currentTarget.blur();
              }
            }}
          />
          {suffix && <span className="suffix">{suffix}</span>}
        </span>
      </div>
      <SliderTrack
        label={label}
        aria-labelledby={labelId}
        min={min}
        max={max}
        now={shown}
        valueText={`${shown}${suffix ? ` ${suffix}` : ""}`}
        fraction={valueFraction(shown, range)}
        fill={fill}
        dragging={dragging}
        ticks={
          defaultValue >= min && defaultValue <= max
            ? [{ at: valueFraction(defaultValue, range), passed: false, isDefault: true }]
            : []
        }
        {...drag}
        onKeyDown={(e) => {
          const next = valueForKey(e.key, shown, range, e.shiftKey);
          if (next === null) return;
          e.preventDefault();
          e.stopPropagation();
          move(next);
        }}
        onKeyUp={(e) => SLIDER_KEYS.has(e.key) && finish(commit)}
        onBlur={() => finish(commit)}
        onDoubleClick={() => value !== undefined && void onCommit(null)}
      />
    </div>
  );
}
