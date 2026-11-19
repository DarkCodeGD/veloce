/**
 * The editor's own color picker (D64), replacing the browser's `<input type="color">` popup.
 * That popup is positioned by the browser and overflowed the screen on Linux/Wayland; it had
 * no alpha; and it took the focus from text being typed into. This one is plain DOM:
 *
 *   ┌──────────────────────┐
 *   │  saturation × value  │   drag: preview on every move, commit once on release (D41)
 *   ├──────────────────────┤
 *   │ hue ════════○═══════ │
 *   │ alpha ══════○═══════ │   (optional)
 *   │ [⌖] [#4f46e5 ] [30 %]│   eyedropper (where supported), hex, opacity
 *   └──────────────────────┘
 *
 * `ColorPicker` is the body (the text toolbar shows it inline, in its Color menu);
 * `ColorPopover` floats it beside the inspector, always inside the window.
 */
import { Pipette, X } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type Hsva, hsvToHex, type PickedColor, toHsva } from "../model/color.js";
import { placePopover } from "../model/popover.js";

/** Chromium's EyeDropper API (not in TypeScript's DOM types yet). */
type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | undefined =>
  (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** Alpha in whole percents, like the opacity box. */
const roundAlpha = (a: number) => Math.round(clamp01(a) * 100) / 100;

export interface ColorPickerProps {
  /** The color shown, as `#rrggbb` + alpha 0–1. Follows undo, the AI and other tabs. */
  value: PickedColor;
  /** Show the alpha slider and percent box. */
  alpha?: boolean;
  /** Names the controls for screen readers: "<label> hue". */
  label: string;
  /** While dragging: show it live, change nothing yet. */
  onPreview?(color: PickedColor): void;
  /** A finished change: one drag, one key, a typed hex, an eyedropper pick. */
  onCommit(color: PickedColor): void;
}

export function ColorPicker({ value, alpha = true, label, onPreview, onCommit }: ColorPickerProps) {
  const [hsva, setHsva] = useState(() => toHsva(value.hex, value.alpha));
  const latest = useRef(hsva);
  latest.current = hsva;
  const dragging = useRef(false);

  // Follow outside changes, unless they're just our own color coming back (that keeps the
  // exact hue of a gray, which the hex alone can't carry).
  useEffect(() => {
    if (dragging.current) return;
    const now = latest.current;
    if (hsvToHex(now) === value.hex.toLowerCase() && roundAlpha(now.a) === roundAlpha(value.alpha))
      return;
    setHsva(toHsva(value.hex, value.alpha, now));
  }, [value.hex, value.alpha]);

  const emit = (next: Hsva, commit: boolean) => {
    latest.current = next;
    setHsva(next);
    const picked = { hex: hsvToHex(next), alpha: roundAlpha(next.a) };
    if (commit) onCommit(picked);
    else onPreview?.(picked);
  };

  const hueColor = hsvToHex({ h: hsva.h, s: 1, v: 1, a: 1 });
  const solid = hsvToHex(hsva);
  return (
    <div className="color-picker" style={{ "--hue": hueColor, "--solid": solid } as CSSProperties}>
      <DragSurface
        className="color-picker-area"
        label={`${label} saturation and brightness`}
        valueText={`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`}
        dragging={dragging}
        thumb={{ left: hsva.s, top: 1 - hsva.v }}
        onDrag={(x, y, commit) => emit({ ...latest.current, s: x, v: 1 - y }, commit)}
        onStep={(dx, dy) => {
          const c = latest.current;
          emit({ ...c, s: clamp01(c.s + dx / 100), v: clamp01(c.v - dy / 100) }, true);
        }}
      />
      <DragSurface
        className="color-picker-slider color-picker-hue"
        label={`${label} hue`}
        valueText={`${Math.round(hsva.h)}°`}
        dragging={dragging}
        thumb={{ left: hsva.h / 360 }}
        onDrag={(x, _y, commit) => emit({ ...latest.current, h: Math.min(x * 360, 359.9) }, commit)}
        onStep={(dx) => {
          const c = latest.current;
          emit({ ...c, h: Math.min(359.9, Math.max(0, c.h + dx)) }, true);
        }}
      />
      {alpha && (
        <DragSurface
          className="color-picker-slider color-picker-alpha"
          label={`${label} opacity slider`}
          valueText={`${Math.round(hsva.a * 100)}%`}
          dragging={dragging}
          thumb={{ left: hsva.a }}
          onDrag={(x, _y, commit) => emit({ ...latest.current, a: x }, commit)}
          onStep={(dx) => {
            const c = latest.current;
            emit({ ...c, a: clamp01(c.a + dx / 100) }, true);
          }}
        />
      )}
      <div className="color-picker-footer">
        {eyeDropper() && (
          <button
            type="button"
            className="icon-button"
            aria-label={`${label}: pick a color from the screen`}
            data-tip="Pick from screen"
            onMouseDown={(e) => e.preventDefault()}
            onClick={async () => {
              const Dropper = eyeDropper();
              if (!Dropper) return;
              try {
                const { sRGBHex } = await new Dropper().open();
                emit(toHsva(sRGBHex, latest.current.a, latest.current), true);
              } catch {
                // Cancelled (Esc), or the platform refused: nothing to do.
              }
            }}
          >
            <Pipette size={14} aria-hidden="true" />
          </button>
        )}
        <TypedValue
          className="color-picker-hex"
          label={`${label} hex`}
          value={solid}
          parse={(text) => {
            const t = text.trim().replace(/^#/, "");
            if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return null;
            const full = t.length === 3 ? [...t].map((c) => c + c).join("") : t;
            return `#${full.toLowerCase()}`;
          }}
          onCommit={(hex) => emit(toHsva(hex, latest.current.a, latest.current), true)}
        />
        {alpha && (
          <TypedValue
            className="color-picker-percent"
            label={`${label} opacity percent`}
            value={String(Math.round(hsva.a * 100))}
            suffix="%"
            parse={(text) => {
              const n = Number.parseFloat(text);
              return Number.isFinite(n) ? String(Math.round(Math.min(100, Math.max(0, n)))) : null;
            }}
            onCommit={(pct) => emit({ ...latest.current, a: Number(pct) / 100 }, true)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A square or slider you drag in. Pointer capture keeps the drag going outside it; the press
 * is cancelled so the focus stays where it was (the text being typed into, in the toolbar).
 * Focusable for the keyboard: arrows step 1, Shift+arrows 10, each step one commit.
 */
function DragSurface({
  className,
  label,
  valueText,
  dragging,
  thumb,
  onDrag,
  onStep,
}: {
  className: string;
  label: string;
  valueText: string;
  dragging: RefObject<boolean>;
  /** The thumb's position, 0–1 across (and down, for the square). */
  thumb: { left: number; top?: number };
  onDrag(x: number, y: number, commit: boolean): void;
  onStep(dx: number, dy: number): void;
}) {
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };
  const last = useRef<[number, number]>([0, 0]);
  const end = (commit: boolean) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (commit) onDrag(last.current[0], last.current[1], true);
  };
  return (
    <div
      className={className}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuetext={valueText}
      aria-valuenow={Math.round(thumb.left * 100)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // keep the focus (and a text selection) where it is
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        const [x = 0, y = 0] = at(e);
        last.current = [x, y];
        onDrag(x, y, false);
      }}
      onPointerMove={(e) => {
        if (!dragging.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const [x = 0, y = 0] = at(e);
        last.current = [x, y];
        onDrag(x, y, false);
      }}
      onPointerUp={() => end(true)}
      // Capture lost without a release (the window lost focus…): keep what was dragged to.
      onLostPointerCapture={() => end(true)}
      onKeyDown={(e: KeyboardEvent) => {
        const step = e.shiftKey ? 10 : 1;
        const move: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const delta = move[e.key];
        if (!delta) return;
        e.preventDefault();
        e.stopPropagation(); // not a layer nudge
        // Sliders: up/down step like right/left.
        if (thumb.top === undefined) onStep(delta[0] || -delta[1], 0);
        else onStep(delta[0], delta[1]);
      }}
    >
      <span
        className="color-picker-thumb"
        style={{
          left: `${thumb.left * 100}%`,
          top: thumb.top === undefined ? "50%" : `${thumb.top * 100}%`,
        }}
      />
    </div>
  );
}

/** A small text box that commits a parsed value on Enter or blur, and reverts on Esc. */
function TypedValue({
  className,
  label,
  value,
  suffix,
  parse,
  onCommit,
}: {
  className: string;
  label: string;
  value: string;
  suffix?: string;
  parse(text: string): string | null;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft === null) return;
    const parsed = parse(draft);
    setDraft(null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  };
  return (
    <div className={`input-with-suffix ${className}`}>
      <input
        type="text"
        spellCheck={false}
        aria-label={label}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={finish}
        onKeyDown={(e) => {
          e.stopPropagation(); // typing never triggers editor shortcuts
          if (e.key === "Enter") {
            e.preventDefault();
            finish();
          } else if (e.key === "Escape") {
            setDraft(null); // drop the typing (in a popover, Esc closes it too)
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  );
}

/**
 * The picker in a floating panel, opened from `trigger` (a swatch). It sits beside the
 * inspector and is placed by us, so it's always inside the window. Like Figma's, it closes
 * with its ✕, Esc, the trigger, or a press elsewhere in the panels, but stays open while the
 * canvas is panned or zoomed. Selecting another layer closes it too: the inspector shows
 * another layer's fields (keyed by layer), so this one unmounts.
 */
export function ColorPopover({
  title,
  trigger,
  onClose,
  children,
}: {
  /** What's being edited ("Fill", "Theme color primary"), in the header. */
  title: string;
  trigger: RefObject<HTMLElement | null>;
  onClose(): void;
  children: ReactNode;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const el = popover.current;
      const from = trigger.current;
      if (!el || !from) return;
      const panel = from.closest(".inspector")?.getBoundingClientRect() ?? null;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setAt(placePopover(from.getBoundingClientRect(), panel, size, viewport));
    };
    place();
    window.addEventListener("resize", place);
    // The paint picker's tabs change its height: stay inside the window.
    const resized = new ResizeObserver(place);
    if (popover.current) resized.observe(popover.current);
    return () => {
      window.removeEventListener("resize", place);
      resized.disconnect();
    };
  }, [trigger]);

  useEffect(() => {
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (popover.current?.contains(target) ||
        trigger.current?.contains(target) ||
        // The canvas: panning keeps the picker open; picking another layer unmounts it.
        (target instanceof Element && target.closest(".editor-canvas") !== null));
    const onDown = (e: globalThis.PointerEvent) => {
      if (inside(e.target)) return;
      // A hex typed but not entered still counts: blur commits it before we unmount.
      const active = document.activeElement;
      if (active instanceof HTMLElement && popover.current?.contains(active)) active.blur();
      close.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc closes the picker, not the selection behind it.
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [trigger]);

  return createPortal(
    <div
      ref={popover}
      className="color-popover"
      role="dialog"
      aria-label="Color picker"
      style={at ? { left: at.x, top: at.y } : { visibility: "hidden" }}
    >
      <div className="color-popover-head">
        <span>{title}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close color picker"
          data-tip="Close (Esc)"
          onClick={() => close.current()}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
