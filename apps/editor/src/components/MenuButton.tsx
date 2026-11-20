/**
 * A button that opens a menu of commands (the top bar's File menu, D76): the WAI-ARIA menu
 * button pattern. Arrows move between items, Home/End jump, Enter or a click runs one, Esc
 * or a click outside closes it, and focus goes back to the button.
 *
 * It's the seed of the app menu bar (File, Edit, View… with every command, roadmap round 5):
 * the bar will be a row of these.
 */
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { shortcutKeys } from "../model/shortcuts.js";
import { PLATFORM } from "../platform.js";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown on the right, the way the tooltips show keys ("Mod+Z" → Ctrl Z). */
  shortcut?: string;
  /** The current choice (the active tool): a check-mark item. */
  checked?: boolean;
  onSelect(): void;
}

export function MenuButton({
  label,
  items,
  className,
  trigger,
  tip,
}: {
  label: string;
  items: readonly MenuItem[];
  className?: string;
  /** What the button shows instead of its label (an icon); the label is then its name. */
  trigger?: ReactNode;
  /** A tooltip (icon-only buttons). */
  tip?: string;
}) {
  /** Where the open menu sits (under the button); null when closed. */
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const open = place !== null;
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const enabled = () =>
    [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])].filter(
      (el) => !el.disabled,
    );
  const close = (refocus = true) => {
    setPlace(null);
    if (refocus) button.current?.focus();
  };
  // Measured before it opens, so the menu is visible (and focusable) on its first render.
  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPlace({ left: rect.left, top: rect.bottom + 4 });
  };

  // Focus the first command once it's open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when it opens; the helpers only read refs
  useLayoutEffect(() => {
    if (open) enabled()[0]?.focus();
  }, [open]);

  // A click anywhere else closes it (without stealing focus from what was clicked).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when it opens; the helpers only read refs
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // menu keys never reach the editor's shortcuts
    const list = enabled();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") focus(at + 1);
    else if (e.key === "ArrowUp") focus(at - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(list.length - 1);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") close(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`menu-button${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={trigger ? label : undefined}
        data-tip={open ? undefined : tip}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
      >
        {trigger ?? label}
      </button>
      {place && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          className="menu-popup"
          style={{ left: place.left, top: place.top }}
          onKeyDown={onMenuKey}
        >
          {items.map((item) => (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is only set on menuitemradio items (the role is chosen just above)
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              className="menu-item"
              disabled={item.disabled}
              onClick={() => {
                // Focus goes back to the button first, so whatever the command opens (a
                // dialog) returns focus there when it closes.
                close();
                item.onSelect();
              }}
            >
              {item.icon && <span className="menu-icon">{item.icon}</span>}
              {item.label}
              {item.shortcut && (
                <span className="menu-keys" aria-hidden="true">
                  {shortcutKeys(item.shortcut, PLATFORM).join(PLATFORM === "mac" ? "" : "+")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
