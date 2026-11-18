/**
 * Wires an `<input type="color">` to the gesture contract (D41): dragging in the system picker
 * previews (at most once per frame), closing it commits once. React's `onChange` is the
 * `input` event, so the commit listens to the native `change` event instead.
 *
 * Returns a callback ref: listeners bind whenever the input mounts (it may appear later, e.g.
 * when a gradient fill is replaced by a color) and are removed when it unmounts.
 */
import { useCallback, useEffect, useRef } from "react";

export function useColorPicker(
  /** `#rrggbb` the input should show; follows changes from undo, the AI or other tabs. */
  value: string,
  onCommit: (hex: string) => void,
  onPreview?: (hex: string) => void,
) {
  const element = useRef<HTMLInputElement | null>(null);
  const detach = useRef<(() => void) | null>(null);
  // Latest props, so the listeners (bound once per element) never see stale ones.
  const latest = useRef({ value, onCommit, onPreview });
  latest.current = { value, onCommit, onPreview };

  const ref = useCallback((el: HTMLInputElement | null) => {
    detach.current?.();
    detach.current = null;
    element.current = el;
    if (!el) return;
    el.value = latest.current.value;
    let frame = 0;
    const onInput = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => latest.current.onPreview?.(el.value));
    };
    const onChange = () => {
      cancelAnimationFrame(frame);
      latest.current.onCommit(el.value);
    };
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    detach.current = () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    const el = element.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);

  return ref;
}
