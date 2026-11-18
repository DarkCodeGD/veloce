/**
 * A themed dropdown that replaces the native <select>, whose popup is drawn by the OS and can't
 * be styled. It follows the WAI-ARIA "select-only combobox" pattern: focus stays on the trigger,
 * `aria-activedescendant` points at the highlighted option, and the keyboard works like a native
 * select (arrows, Home/End, PageUp/PageDown, typeahead, Enter/Space, Esc).
 *
 * The popup is portalled to <body> with fixed positioning, so panels with `overflow` can't clip
 * it. It opens below the trigger, or above when there's more room there. While open it follows
 * the trigger when a panel scrolls (closing on scroll would fight inertial touchpad scrolling)
 * and closes once the trigger scrolls out of sight, on outside clicks and on blur.
 */
import { Check, ChevronDown } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { moveActive, typeahead } from "../model/listbox.js";

export interface SelectOption {
  value: string;
  label: string;
  /** Muted text on the right, e.g. a token's value. */
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface Props {
  /** Pair with `<label htmlFor>` for a visible label (preferred). */
  id?: string;
  "aria-label"?: string;
  value: string;
  options: readonly SelectOption[];
  onChange(value: string): void;
  className?: string;
  /** Shown when `value` matches no option. */
  placeholder?: string;
}

const TYPEAHEAD_MS = 500;
const GAP = 4;
const EDGE = 8;
const MAX_HEIGHT = 300;

interface Placement {
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxHeight: number;
}

/** True when no scrolling/clipping ancestor hides the trigger. */
function inView(el: HTMLElement, r: DOMRect) {
  if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (style.overflowY === "visible" && style.overflowX === "visible") continue;
    const clip = p.getBoundingClientRect();
    if (r.bottom <= clip.top || r.top >= clip.bottom) return false;
  }
  return true;
}

/**
 * Where the popup goes: below the trigger, or above it when there's more room there.
 * `null` when the trigger is out of sight (the popup should close).
 */
function placement(trigger: HTMLElement, list: HTMLElement): Placement | null {
  const r = trigger.getBoundingClientRect();
  if (!inView(trigger, r)) return null;
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const wanted = Math.min(MAX_HEIGHT, list.scrollHeight);
  const up = below < wanted && above > below;
  const width = Math.max(r.width, list.offsetWidth);
  return {
    left: Math.max(EDGE, Math.min(r.left, window.innerWidth - width - EDGE)),
    minWidth: r.width,
    maxHeight: Math.min(MAX_HEIGHT, up ? above : below),
    ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
  };
}

export function Select({
  id,
  "aria-label": ariaLabel,
  value,
  options,
  onChange,
  className,
  placeholder = "Select…",
}: Props) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const listId = `${triggerId}-list`;
  const optionId = (i: number) => `${triggerId}-option-${i}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Placement | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const show = (start = selectedIndex) => {
    setActive(start >= 0 ? start : (moveActive(options, -1, "ArrowDown") ?? -1));
    setPlace(null);
    setOpen(true);
  };
  const close = () => setOpen(false);
  const choose = (i: number) => {
    const option = options[i];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };
  /** Typeahead with a short memory, so "sp" finds "Space between". */
  const typed = (key: string, from: number) => {
    const now = performance.now();
    const text = now - query.current.at < TYPEAHEAD_MS ? query.current.text + key : key;
    query.current = { text, at: now };
    return typeahead(options, from, text);
  };
  const typing = () => performance.now() - query.current.at < TYPEAHEAD_MS;

  // ── Placement: measured before paint, so the popup never flashes in the wrong spot ──
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!open || place || !trigger || !list) return;
    const next = placement(trigger, list);
    if (next) setPlace(next);
    else setOpen(false);
  }, [open, place]);

  // Keep the highlighted option in view (keyboard navigation in long lists).
  // biome-ignore lint/correctness/useExhaustiveDependencies: optionId is derived from triggerId
  useLayoutEffect(() => {
    if (open && place && active >= 0) {
      document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    }
  }, [open, place, active, triggerId]);

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node) ||
      !(triggerRef.current?.contains(target) || listRef.current?.contains(target));
    const onPointerDown = (e: PointerEvent) => outside(e.target) && setOpen(false);
    // Follow the trigger (once per frame); close when it scrolls out of sight.
    let frame = 0;
    const follow = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const trigger = triggerRef.current;
        const list = listRef.current;
        if (!trigger || !list) return;
        const next = placement(trigger, list);
        if (next) setPlace(next);
        else setOpen(false);
      });
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    const { key } = e;
    const claim = () => {
      e.preventDefault();
      e.stopPropagation(); // never reaches the editor's shortcuts
    };
    const printable = key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (key === "Tab") return open && close();

    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        claim();
        return show();
      }
      if (key === "Home" || key === "End") {
        claim();
        return show(moveActive(options, -1, key === "Home" ? "ArrowDown" : "ArrowUp") ?? -1);
      }
      if (printable) {
        claim();
        return show(typed(key, selectedIndex));
      }
      return;
    }

    if (key === "Escape") {
      claim();
      return close();
    }
    if (key === "Enter" || (key === " " && !typing()) || (e.altKey && key === "ArrowUp")) {
      claim();
      return choose(active);
    }
    const next = moveActive(options, active, key);
    if (next !== null) {
      claim();
      return setActive(next);
    }
    if (printable) {
      claim();
      setActive(typed(key, active));
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        className={`select-trigger${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        onBlur={close}
      >
        {selected?.icon && <span className="select-icon">{selected.icon}</span>}
        <span className={`select-value${selected ? "" : " is-placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        {selected?.hint && <span className="select-hint">{selected.hint}</span>}
        <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={triggerId}
            className="select-popup"
            style={place ?? { visibility: "hidden", left: 0, top: 0 }}
            // Clicking an option must not steal focus from the trigger.
            onPointerDown={(e) => e.preventDefault()}
          >
            {options.map((option, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard drives options through the combobox (aria-activedescendant)
              <div
                key={option.value}
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={i === selectedIndex}
                aria-disabled={option.disabled || undefined}
                className={`select-option${i === active ? " is-active" : ""}`}
                onPointerMove={() => !option.disabled && i !== active && setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="select-check" aria-hidden="true">
                  {i === selectedIndex && <Check size={14} />}
                </span>
                {option.icon && <span className="select-icon">{option.icon}</span>}
                <span className="select-label">{option.label}</span>
                {option.hint && <span className="select-hint">{option.hint}</span>}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
