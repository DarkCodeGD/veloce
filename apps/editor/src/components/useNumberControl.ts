/**
 * Everything a number field does, as props for its <label> and <input>:
 *
 * - **Scrub:** drag the label sideways (Shift 10× faster, Alt 10× finer). A press without
 *   movement is still a normal label click that focuses the input.
 * - **Nudge:** ↑/↓ in the input, same modifiers. Holding the key repeats.
 * - **Type:** a number with an optional unit ("24px", "50%"); Enter or blur commits, an empty
 *   field resets to the default.
 * - **Esc** cancels a scrub, nudge or edit and restores the value.
 *
 * During a scrub or nudge the field shows the value itself and the canvas shows it through
 * `onPreview` (applied locally, D39); one `onCommit` follows when the gesture ends (pointer
 * up, key up, blur). So a long drag is one undo step and one message to the server.
 * `value` must be the committed value, never the preview: it's what "did it change?" and
 * Esc compare against.
 */
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { type NumberConstraints, nudge, parseNumber, quantize, Scrub } from "../model/scrub.js";

export interface NumberControlOptions extends NumberConstraints {
  value: number | undefined;
  /** Where scrubbing/nudging starts when the value is unset (the effective default). */
  fallback?: () => number | undefined;
  /** Show a value live without committing it; `null` drops the preview. */
  onPreview?(value: number | null): void;
  /** Commit one change (`null` resets to the default). */
  onCommit(value: number | null): void;
}

/** Pixels the pointer must travel before a label press becomes a scrub. */
const SCRUB_THRESHOLD = 3;

const format = (value: number | undefined) =>
  value === undefined ? "" : String(Math.round(value * 100) / 100);

export function useNumberControl(o: NumberControlOptions) {
  // Latest options for the event handlers, which outlive a render during a gesture.
  const opts = useRef(o);
  opts.current = o;

  const [draft, setDraft] = useState(format(o.value));
  const [scrubbing, setScrubbing] = useState(false);
  /** The input holds typed or nudged text that hasn't been committed yet. */
  const dirty = useRef(false);
  /** The last nudged value, committed when the arrow key is released. */
  const nudged = useRef<number | null>(null);
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    lastX: number;
    scrub: Scrub | null;
    value: number;
    frame: number;
    /** Esc handler while scrubbing (kept here so the same function is removed). */
    onKey: ((e: globalThis.KeyboardEvent) => void) | null;
  } | null>(null);
  const suppressClick = useRef(false);

  // Follow the document (and live previews) unless the user is editing the text.
  useEffect(() => {
    if (!dirty.current) setDraft(format(o.value));
  }, [o.value]);

  const constraints = (): NumberConstraints => {
    const { min, max, step, integer } = opts.current;
    return { min, max, step, integer };
  };
  const startValue = () => opts.current.value ?? opts.current.fallback?.() ?? opts.current.min ?? 0;
  const preview = (value: number | null) => opts.current.onPreview?.(value);
  /** Commit if the value changed; otherwise just drop the preview. */
  const commit = (value: number | null) => {
    if (value === (opts.current.value ?? null)) preview(null);
    else opts.current.onCommit(value);
  };

  // ── Scrubbing (label) ─────────────────────────────────────────────────────────────
  const endScrub = (mode: "commit" | "cancel") => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    cancelAnimationFrame(g.frame);
    document.documentElement.classList.remove("is-scrubbing");
    if (g.onKey) window.removeEventListener("keydown", g.onKey, true);
    if (!g.scrub) return; // a plain click, never became a scrub
    setScrubbing(false);
    suppressClick.current = true; // the click after a drag must not focus the input
    if (mode === "commit") return commit(g.value);
    preview(null);
    setDraft(format(opts.current.value));
  };

  const labelProps = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0 || gesture.current) return;
      e.preventDefault(); // no text selection while dragging
      e.currentTarget.setPointerCapture(e.pointerId);
      suppressClick.current = false;
      gesture.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        lastX: e.clientX,
        scrub: null,
        value: startValue(),
        frame: 0,
        onKey: null,
      };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      if (!g.scrub) {
        if (Math.abs(e.clientX - g.startX) < SCRUB_THRESHOLD) return;
        g.scrub = new Scrub(g.value, constraints());
        g.lastX = g.startX;
        setScrubbing(true);
        dirty.current = false;
        document.documentElement.classList.add("is-scrubbing");
        // Esc cancels the scrub, and never reaches the editor's shortcuts.
        g.onKey = (ev) => {
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          endScrub("cancel");
        };
        window.addEventListener("keydown", g.onKey, true);
      }
      const next = g.scrub.move(e.clientX - g.lastX, e);
      g.lastX = e.clientX;
      if (next === g.value) return;
      g.value = next;
      // At most one preview per frame, however fast the pointer reports.
      cancelAnimationFrame(g.frame);
      g.frame = requestAnimationFrame(() => {
        if (gesture.current !== g) return;
        setDraft(format(g.value));
        preview(g.value);
      });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      if (gesture.current?.pointerId === e.pointerId) endScrub("commit");
    },
    onPointerCancel() {
      endScrub("cancel");
    },
    // Capture lost without a pointer up (e.g. the window lost focus): keep what's shown.
    onLostPointerCapture() {
      endScrub("commit");
    },
    onClick(e: MouseEvent<HTMLElement>) {
      if (suppressClick.current) {
        e.preventDefault();
        suppressClick.current = false;
      }
    },
  };

  // Never leave the page in scrub mode if the field unmounts mid-gesture.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup only, on unmount
  useEffect(() => () => endScrub("cancel"), []);

  // ── Typing and nudging (input) ────────────────────────────────────────────────────
  const commitDraft = () => {
    if (!dirty.current) return;
    dirty.current = false;
    nudged.current = null;
    const text = draft.trim();
    if (text === "") return commit(null);
    const n = parseNumber(text);
    if (n === null) {
      preview(null);
      return setDraft(format(opts.current.value)); // not a number: put the value back
    }
    commit(quantize(n, constraints(), true, n)); // exactly as typed (whole if integer)
  };

  const revert = () => {
    dirty.current = false;
    nudged.current = null;
    preview(null);
    setDraft(format(opts.current.value));
  };

  const inputProps = {
    type: "text",
    inputMode: "decimal" as const,
    role: "spinbutton",
    autoComplete: "off",
    spellCheck: false,
    "aria-valuenow": o.value,
    "aria-valuemin": o.min,
    "aria-valuemax": o.max,
    value: draft,
    onChange(e: { target: { value: string } }) {
      dirty.current = true;
      nudged.current = null;
      setDraft(e.target.value);
    },
    onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
      e.stopPropagation(); // typing never triggers editor shortcuts
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const base = nudged.current ?? parseNumber(draft) ?? startValue();
        const next = nudge(base, e.key === "ArrowUp" ? 1 : -1, e, constraints());
        nudged.current = next;
        dirty.current = true;
        setDraft(format(next));
        preview(next);
      } else if (e.key === "Enter") {
        commitDraft();
      } else if (e.key === "Escape") {
        revert();
      }
    },
    onKeyUp(e: KeyboardEvent<HTMLInputElement>) {
      // Releasing the arrow ends the nudge: one transaction however long it was held.
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && nudged.current !== null) {
        const value = nudged.current;
        nudged.current = null;
        dirty.current = false;
        commit(value);
      }
    },
    onBlur(_e: FocusEvent<HTMLInputElement>) {
      if (nudged.current !== null) {
        const value = nudged.current;
        nudged.current = null;
        dirty.current = false;
        return commit(value);
      }
      commitDraft();
    },
  };

  return { labelProps, inputProps, scrubbing };
}
