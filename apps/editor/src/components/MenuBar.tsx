/**
 * The app menu bar (D89): File, Edit, View, Insert, Slide, Arrange, Help, every item a
 * registry command with its shortcut, so a plugin's command shows up in its menu without
 * editor code. It behaves like a desktop menu bar: ←/→ move between menus (open or not),
 * and once one is open, pointing at another opens that one instead.
 *
 * Narrow windows fold it into one ☰ menu that lists every menu under its name.
 */
import { Menu } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { commands, MENU_BAR } from "../editor-commands.js";
import { commandMenuItem } from "./command-menu.js";
import { MenuButton, type MenuItem } from "./MenuButton.js";

/** One menu's items, a line between its sections. */
function menuItems(menu: string): MenuItem[] {
  return commands.menu(menu).flatMap((section, i) =>
    section.map((command, j) => ({
      ...commandMenuItem(command.id),
      ...(i > 0 && j === 0 && { separator: true }),
    })),
  );
}

export function MenuBar() {
  // Re-render when commands come or go (a plugin loading).
  useSyncExternalStore(commands.subscribe, commands.version);
  /** The open menu, if any. */
  const [active, setActive] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  const neighbour = (at: number, direction: 1 | -1) =>
    (at + direction + MENU_BAR.length) % MENU_BAR.length;
  const cross = (from: string, direction: 1 | -1, open: boolean) => {
    if (open) {
      // From the menu open NOW: a fast second → can reach the menu that's closing.
      setActive((now) => {
        const at = MENU_BAR.findIndex((m) => m.id === (now ?? from));
        return MENU_BAR[neighbour(at, direction)]?.id ?? null;
      });
    } else {
      const at = MENU_BAR.findIndex((m) => m.id === from);
      bar.current
        ?.querySelectorAll<HTMLButtonElement>(".menu-button")
        [neighbour(at, direction)]?.focus();
    }
  };

  return (
    <>
      <div ref={bar} className="menubar" role="toolbar" aria-label="Menu bar">
        {MENU_BAR.map(({ id, label }) => (
          <MenuButton
            key={id}
            label={label}
            items={menuItems(id)}
            open={active === id}
            onOpenChange={(open) => setActive((now) => (open ? id : now === id ? null : now))}
            onCross={(direction, open) => cross(id, direction, open)}
            onHover={() => {
              if (active !== null && active !== id) setActive(id);
            }}
          />
        ))}
      </div>
      <MenuButton
        label="Menu"
        tip="Menu"
        className="menubar-folded"
        trigger={<Menu size={16} aria-hidden="true" />}
        items={MENU_BAR.flatMap(({ id, label }) =>
          menuItems(id).map((item, i) => ({
            ...item,
            id: `${id}:${item.id ?? item.label}`,
            ...(i === 0 && { heading: label }),
          })),
        )}
      />
    </>
  );
}
