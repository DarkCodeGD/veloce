/**
 * One tooltip layer for the whole editor, instead of the browser's `title` (slow, unstyled,
 * mouse-only). Elements opt in with `data-tip="Undo"` and, for shortcuts, `data-keys="Mod+Z"`.
 *
 * - Hover shows it after a short delay; once one is visible, neighbours show instantly.
 * - Keyboard focus shows it too (only for :focus-visible, not after a click).
 * - Esc, a click, scrolling or a scrub hides it; the pointer can move onto it (WCAG 1.4.13).
 *
 * It's visual only (`aria-hidden`): icon buttons carry `aria-label`, shortcuts carry
 * `aria-keyshortcuts`, so screen readers already get the same information.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { shortcutKeys } from "../model/shortcuts.js";
import { PLATFORM } from "../platform.js";

const SHOW_DELAY_MS = 500;
/** How long after hiding a tooltip the next one still shows instantly. */
const WARM_MS = 400;
/** Grace period for moving the pointer from the element onto the tooltip. */
const HIDE_GRACE_MS = 100;
const GAP = 6;
const EDGE = 8;

interface Tip {
  target: HTMLElement;
  text: string;
  keys: string[];
}

const tipTarget = (node: EventTarget | null) =>
  node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null;

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let showTimer = 0;
    let hideTimer = 0;
    let current: HTMLElement | null = null;
    let hiddenAt = 0;

    const show = (target: HTMLElement) => {
      clearTimeout(hideTimer);
      current = target;
      setTip({
        target,
        text: target.dataset.tip ?? "",
        keys: target.dataset.keys ? shortcutKeys(target.dataset.keys, PLATFORM) : [],
      });
    };
    const hide = () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (current) hiddenAt = performance.now();
      current = null;
      setTip(null);
    };
    const schedule = (target: HTMLElement) => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      const warm = current !== null || performance.now() - hiddenAt < WARM_MS;
      if (warm) return show(target);
      showTimer = window.setTimeout(() => show(target), SHOW_DELAY_MS);
    };
    const busy = (e: PointerEvent) =>
      e.buttons !== 0 || document.documentElement.classList.contains("is-scrubbing");

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch" || busy(e)) return;
      if (ref.current?.contains(e.target as Node)) return clearTimeout(hideTimer);
      const target = tipTarget(e.target);
      if (target && target !== current) schedule(target);
      else if (target) clearTimeout(hideTimer);
    };
    const onOut = (e: PointerEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && (current?.contains(to) || ref.current?.contains(to))) return;
      clearTimeout(showTimer);
      if (current) hideTimer = window.setTimeout(hide, HIDE_GRACE_MS);
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = tipTarget(e.target);
      if (target && target === e.target && target.matches(":focus-visible")) show(target);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && current) hide();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Above the element, centred; below it when there's no room; always inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return setPos(null);
    if (!tip.target.isConnected) return setTip(null);
    const r = tip.target.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = el;
    const above = r.top - GAP - h;
    setPos({
      left: Math.max(EDGE, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - EDGE)),
      top: above >= EDGE ? above : r.bottom + GAP,
    });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className="tooltip"
      aria-hidden="true"
      style={pos ?? { visibility: "hidden", left: 0, top: 0 }}
    >
      <span>{tip.text}</span>
      {tip.keys.length > 0 && (
        <span className="tooltip-keys">
          {tip.keys.map((key) => (
            <kbd key={key}>{key}</kbd>
          ))}
        </span>
      )}
    </div>
  );
}
