/**
 * The Add menu (D81): every layer you can add, opened by Shift+A at the pointer (Blender), a
 * right-click on the canvas, or the tool bar's ➕. Type to search ("ell" → Ellipse), arrows to
 * move, Enter to add; the last few used sit on top. It lists the registry's "add" commands,
 * so a plugin's element shows up here with no extra code.
 *
 * The layer goes where the menu was opened (the pointer, the click), or, from the ➕ button,
 * where a paste would.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AddMenuState, addMenuStore, closeAddMenu } from "../add-menu.js";
import { runCommand, useCommands } from "../editor-commands.js";
import { menuSections } from "../model/insert.js";
import { placePopover } from "../model/popover.js";
import { loadRecent, noteRecent } from "../recent.js";

const RECENT_KEY = "veloce.add-menu.recent";

export function AddMenu() {
  const state = addMenuStore.use();
  // A fresh popup per opening: the search and highlight start over.
  return state ? <AddMenuPopup key={`${state.left},${state.top}`} state={state} /> : null;
}

function AddMenuPopup({ state }: { state: AddMenuState }) {
  const commands = useCommands("add");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ x: number; y: number } | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const sections = useMemo(
    () => menuSections(commands, query, loadRecent(RECENT_KEY)),
    [commands, query],
  );
  const rows = sections.flatMap((s) => s.items.map((item) => ({ section: s.title, item })));
  const current = Math.min(active, rows.length - 1);
  const rowId = (i: number) => `${listId}-${i}`;

  // Opens below-right of the point, flipped or nudged to stay in the window.
  useLayoutEffect(() => {
    const el = popup.current;
    if (!el) return;
    const point = { left: state.left, top: state.top, right: state.left, bottom: state.top };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setPlace(
      placePopover(point, null, { width: el.offsetWidth, height: el.offsetHeight }, viewport, 4),
    );
  }, [state]);
  // Focus the search once it's placed: while it's hidden (measuring) it can't take focus.
  const placed = place !== null;
  useLayoutEffect(() => {
    if (placed) input.current?.focus();
  }, [placed]);

  const close = (refocus = true) => {
    closeAddMenu();
    if (refocus) state.returnFocus?.focus();
  };

  // A press anywhere else closes it (the press still does what it does there).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per opening; close only reads props
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!popup.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);

  const choose = (id: string) => {
    noteRecent(RECENT_KEY, id);
    close();
    runCommand(id, { at: state.at ?? undefined });
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the menu's keys never reach the editor's shortcuts
    const n = rows.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (n > 0) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[current];
      if (row) choose(row.item.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  let i = -1;
  return (
    <div
      ref={popup}
      className="add-menu"
      style={
        place
          ? { left: place.x, top: place.y }
          : { left: state.left, top: state.top, visibility: "hidden" }
      }
    >
      <input
        ref={input}
        className="add-menu-search"
        type="text"
        role="combobox"
        aria-label="Add a layer"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={rows.length > 0 ? rowId(current) : undefined}
        placeholder="Add…"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
      />
      <div id={listId} role="listbox" aria-label="Layers to add" className="add-menu-list">
        {sections.map((section) => (
          // biome-ignore lint/a11y/useSemanticElements: a listbox's option group (ARIA), not a form fieldset
          <div key={section.title} role="group" aria-label={section.title}>
            <div className="add-menu-section" aria-hidden="true">
              {section.title}
            </div>
            {section.items.map((item) => {
              i++;
              const at = i;
              const Icon = item.icon;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard goes through the search box (combobox pattern)
                <div
                  key={`${section.title}:${item.id}`}
                  id={rowId(at)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={at === current}
                  className={`add-menu-item${at === current ? " is-active" : ""}`}
                  onPointerMove={() => at !== current && setActive(at)}
                  onPointerDown={(e) => e.preventDefault()} // keep focus in the search box
                  onClick={() => choose(item.id)}
                >
                  {Icon && <Icon size={15} aria-hidden="true" className="menu-icon" />}
                  {item.label}
                </div>
              );
            })}
          </div>
        ))}
        {rows.length === 0 && <div className="add-menu-empty">Nothing called “{query.trim()}”</div>}
      </div>
    </div>
  );
}
