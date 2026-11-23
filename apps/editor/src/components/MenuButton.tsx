/**
 * A button that opens a menu of commands (D76): the WAI-ARIA menu button pattern. Arrows
 * move between items, Home/End jump, Enter or a click runs one, Esc or a click outside
 * closes it, and focus goes back to the button.
 *
 * The menu bar (D89) is a row of these that it drives through `open`/`onOpenChange`:
 * ←/→ go to the neighbouring menu, and while one is open, pointing at another opens it.
 */
import { Check } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { shortcutKeys } from "../model/shortcuts.js";
import { PLATFORM } from "../platform.js";

export interface MenuItem {
  /** Unique within the menu when labels repeat (a folded menu of menus); else the label. */
  id?: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown on the right, the way the tooltips show keys ("Mod+Z" → Ctrl Z). */
  shortcut?: string;
  /** The current choice (the active tool): a check-mark item. */
  checked?: boolean;
  /** `checked` is on/off on its own (Follow AI): a check box, not one choice of several. */
  checkbox?: boolean;
  /** A line above it: the start of another group. */
  separator?: boolean;
  /** A heading above it (a folded menu bar names each menu). */
  heading?: string;
  onSelect(): void;
}

export function MenuButton({
  label,
  items,
  className,
  trigger,
  tip,
  open: openWanted,
  onOpenChange,
  onCross,
  onHover,
}: {
  label: string;
  items: readonly MenuItem[];
  className?: string;
  /** What the button shows instead of its label (an icon); the label is then its name. */
  trigger?: ReactNode;
  /** A tooltip (icon-only buttons). */
  tip?: string;
  /** Opened or closed from outside (the menu bar); it still opens and closes itself too. */
  open?: boolean;
  /** It opened or closed itself (a click, Esc, a click outside, a command run). */
  onOpenChange?(open: boolean): void;
  /** ← or → pressed, on the button or in the open menu: the menu bar moves to a neighbour. */
  onCross?(direction: 1 | -1, open: boolean): void;
  /** The pointer entered the button. */
  onHover?(): void;
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
    onOpenChange?.(false);
    if (refocus) button.current?.focus();
  };
  // Measured before it opens, so the menu is visible (and focusable) on its first render.
  const measure = () => {
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPlace({ left: rect.left, top: rect.bottom + 4 });
  };
  const show = () => {
    measure();
    onOpenChange?.(true);
  };

  // Opened or closed by the menu bar: follow it, without reporting back. Before paint, so
  // the switch (and focus moving into the new menu) is done before the next key arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the wish from outside drives this
  useLayoutEffect(() => {
    if (openWanted === undefined || openWanted === open) return;
    if (openWanted) measure();
    else setPlace(null);
  }, [openWanted]);

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

  // Icons, or check marks, line up in a column when any item has one.
  const iconColumn = items.some((item) => item.icon !== undefined || item.checked !== undefined);

  const onMenuKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // menu keys never reach the editor's shortcuts
    const list = enabled();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") focus(at + 1);
    else if (e.key === "ArrowUp") focus(at - 1);
    else if (onCross && (e.key === "ArrowRight" || e.key === "ArrowLeft"))
      onCross(e.key === "ArrowRight" ? 1 : -1, true);
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
        onPointerEnter={onHover}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            e.stopPropagation(); // the arrows here aren't the editor's (next slide)
            show();
          } else if (onCross && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
            e.preventDefault();
            e.stopPropagation();
            onCross(e.key === "ArrowRight" ? 1 : -1, open);
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
          // A long menu (folded menu bar, small window) scrolls instead of running off-screen.
          style={{
            left: place.left,
            top: place.top,
            maxHeight: window.innerHeight - place.top - 8,
          }}
          onKeyDown={onMenuKey}
        >
          {items.map((item) => (
            <MenuRow
              key={item.id ?? item.label}
              item={item}
              iconColumn={iconColumn}
              onSelect={() => {
                // Focus goes back to the button first, so whatever the command opens (a
                // dialog) returns focus there when it closes.
                close();
                item.onSelect();
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** One command in the menu, with the line or heading that starts its group. */
function MenuRow({
  item,
  iconColumn,
  onSelect,
}: {
  item: MenuItem;
  iconColumn: boolean;
  onSelect(): void;
}) {
  const role =
    item.checked === undefined ? "menuitem" : item.checkbox ? "menuitemcheckbox" : "menuitemradio";
  return (
    <>
      {item.heading !== undefined ? (
        <div className="menu-heading" role="presentation">
          {item.heading}
        </div>
      ) : (
        item.separator && <hr className="menu-separator" />
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is only set on checkable items (the role is chosen just above) */}
      <button
        type="button"
        role={role}
        aria-checked={item.checked}
        className="menu-item"
        disabled={item.disabled}
        onClick={onSelect}
      >
        {iconColumn && (
          <span className="menu-icon">{item.icon ?? (item.checked && <Check size={14} />)}</span>
        )}
        {item.label}
        {item.shortcut && (
          <span className="menu-keys" aria-hidden="true">
            {shortcutKeys(item.shortcut, PLATFORM).join(PLATFORM === "mac" ? "" : "+")}
          </span>
        )}
      </button>
    </>
  );
}
