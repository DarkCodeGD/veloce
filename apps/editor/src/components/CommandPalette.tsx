/**
 * The command palette (D92), Ctrl/Cmd+K: one search box for everything. It lists
 *
 * - every command in the registry (the menus, the tools, the Add menu's layers), with its
 *   keys, so a plugin's command shows up here with no extra code;
 * - the settings: switches flip right here, the rest open Preferences on their tab;
 * - the deck's slides (go to one) and layers (go to its slide and select it).
 *
 * Typing filters (`paletteSections`); arrows move, Enter runs, Esc closes. Nothing typed
 * shows the last few commands run, then all of them. The keyboard stays in the search box
 * throughout (the WAI-ARIA combobox pattern, like the Add menu).
 */
import type { Deck, Settings, SettingsPatch } from "@veloce/core";
import {
  Check,
  Layers,
  type LucideIcon,
  RectangleHorizontal,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { closePalette, paletteStore } from "../command-palette.js";
import { openPreferences, type PreferencesTab } from "../dialogs.js";
import {
  commandContext,
  commands,
  isCommandChecked,
  isCommandEnabled,
  MENU_BAR,
  runCommand,
} from "../editor-commands.js";
import { deckLayers, type PaletteEntry, paletteSections, slideLabel } from "../model/palette.js";
import { shortcutKeys } from "../model/shortcuts.js";
import { nodeLabel } from "../model/slide-index.js";
import { PLATFORM } from "../platform.js";
import { loadRecent, noteRecent } from "../recent.js";
import { changeSettings, settings, useSettings } from "../settings.js";

const RECENT_KEY = "veloce.palette.recent";
const RECENT_MAX = 5;

/** An entry as the palette shows and runs it. */
interface Row extends PaletteEntry {
  icon?: LucideIcon | undefined;
  shortcut?: string | undefined;
  /** A switch that's on, or the current choice: a check mark. */
  checked?: boolean;
  run(): void;
}

type Flag = readonly ["editing", "snapping" | "lint"] | readonly ["ai", "followAI"];

/** The settings it finds: a `flag` flips in place, the rest open Preferences on `tab`. */
const SETTINGS: ReadonlyArray<{
  id: string;
  label: string;
  tab: PreferencesTab;
  keywords?: string;
  flag?: Flag;
}> = [
  {
    id: "snapping",
    label: "Snapping",
    tab: "editing",
    keywords: "snap guides",
    flag: ["editing", "snapping"],
  },
  { id: "nudge", label: "Nudge distance", tab: "editing", keywords: "arrow keys move shift" },
  { id: "undo", label: "Undo steps", tab: "editing", keywords: "history memory" },
  {
    id: "lint",
    label: "Check slides for issues",
    tab: "editing",
    keywords: "lint problems warnings",
    flag: ["editing", "lint"],
  },
  { id: "rules", label: "Issue rules", tab: "editing", keywords: "lint mute hide problems" },
  { id: "folder", label: "Decks folder", tab: "files", keywords: "directory location" },
  { id: "autosave", label: "Autosave delay", tab: "files", keywords: "save interval" },
  { id: "keymap", label: "Keymap", tab: "keymap", keywords: "keyboard shortcuts keys hotkeys" },
  {
    id: "follow",
    label: "Start with Follow AI on",
    tab: "ai",
    keywords: "agent default",
    flag: ["ai", "followAI"],
  },
  { id: "port", label: "Port", tab: "ai", keywords: "mcp server address" },
  { id: "connect", label: "Connect an agent", tab: "ai", keywords: "claude code mcp add" },
];

const TAB_NAMES: Record<PreferencesTab, string> = {
  editing: "Editing",
  files: "Files",
  keymap: "Keymap",
  ai: "AI",
};
const MENU_NAMES = new Map<string, string>(MENU_BAR.map((m) => [m.id, m.label]));

/** Everything the palette can find, as of now (built once per opening, and per deck change). */
function paletteRows(deck: Deck | undefined, current: Settings): Row[] {
  const rows: Row[] = [];
  for (const command of commands.list()) {
    if (command.palette === false) continue;
    const group = command.group.charAt(0).toUpperCase() + command.group.slice(1);
    rows.push({
      id: `command:${command.id}`,
      kind: "command",
      label: command.label,
      detail: (command.menu && MENU_NAMES.get(command.menu)) ?? group,
      keywords: [command.section, command.keywords].filter(Boolean).join(" "),
      disabled: !isCommandEnabled(command.id),
      icon: command.icon,
      shortcut: command.shortcut,
      checked: command.toggle === true && isCommandChecked(command.id),
      run: () => runCommand(command.id),
    });
  }
  for (const setting of SETTINGS) {
    const flag = setting.flag;
    rows.push({
      id: `setting:${setting.id}`,
      kind: "setting",
      label: setting.label,
      detail: `Preferences › ${TAB_NAMES[setting.tab]}`,
      keywords: `preferences settings ${setting.keywords ?? ""}`,
      icon: SettingsIcon,
      ...(flag
        ? {
            checked: (current[flag[0]] as Record<string, unknown>)[flag[1]] === true,
            run: () => {
              const on = (settings()[flag[0]] as Record<string, unknown>)[flag[1]] === true;
              changeSettings({ [flag[0]]: { [flag[1]]: !on } } as SettingsPatch);
            },
          }
        : { run: () => openPreferences(setting.tab) }),
    });
  }
  if (!deck) return rows;
  deck.slides.forEach((slide, i) => {
    rows.push({
      id: `slide:${slide.id}`,
      kind: "slide",
      label: slideLabel(slide, i),
      keywords: "go to",
      icon: RectangleHorizontal,
      run: () => commandContext().goToSlide(slide.id),
    });
  });
  for (const { slideId, slideIndex, node } of deckLayers(deck)) {
    rows.push({
      id: `layer:${slideId}/${node.id}`,
      kind: "layer",
      label: nodeLabel(node),
      detail: `Slide ${slideIndex + 1}`,
      icon: Layers,
      run: () => commandContext().reveal(slideId, [node.id]),
    });
  }
  return rows;
}

export function CommandPalette({ deck }: { deck: Deck | undefined }) {
  // A fresh popup per opening: the search and highlight start over.
  return paletteStore.use() ? <PalettePopup deck={deck} /> : null;
}

function PalettePopup({ deck }: { deck: Deck | undefined }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  /** What had focus before it opened, to give it back. */
  const returnFocus = useRef<Element | null>(document.activeElement);
  const listId = useId();

  // Rebuilt when the deck or the settings change while it's open (an agent at work, another
  // tab), not per keystroke.
  const prefs = useSettings();
  const rows = useMemo(() => paletteRows(deck, prefs), [deck, prefs]);
  const sections = useMemo(
    () => paletteSections(rows, query, loadRecent(RECENT_KEY)),
    [rows, query],
  );
  const flat = sections.flatMap((s) => s.items);
  const current = Math.min(active, flat.length - 1);
  const rowId = (i: number) => `${listId}-${i}`;

  useLayoutEffect(() => input.current?.focus(), []);
  // Arrowing past the visible part scrolls the highlight into view.
  useEffect(() => {
    document.getElementById(rowId(current))?.scrollIntoView({ block: "nearest" });
  });

  const close = () => {
    closePalette();
    if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
  };

  const choose = (row: Row) => {
    if (row.disabled) return;
    if (row.kind === "command") noteRecent(RECENT_KEY, row.id, RECENT_MAX);
    close(); // focus goes back first: a command that moves focus (rename) then wins
    row.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the palette's keys never reach the editor's shortcuts
    const n = flat.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (n > 0) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      if (n > 0) setActive(Math.max(0, Math.min(n - 1, current + (e.key === "PageDown" ? 8 : -8))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flat[current];
      if (row) choose(row);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault(); // it's modal: focus stays in the search box
    }
  };

  let i = -1;
  return (
    // A press on the backdrop closes it (the palette itself stops it below).
    <div className="palette-backdrop" onPointerDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="palette-search">
          <div className="search-field">
            <Search size={15} aria-hidden="true" />
            <input
              ref={input}
              className="search-field-input"
              type="search"
              role="combobox"
              aria-label="Search commands, settings, slides and layers"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={flat.length > 0 ? rowId(current) : undefined}
              placeholder="Search commands, settings, slides and layers…"
              spellCheck={false}
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
            />
          </div>
        </div>
        <div id={listId} role="listbox" aria-label="Results" className="palette-list">
          {sections.map((section) => (
            // biome-ignore lint/a11y/useSemanticElements: a listbox's option group (ARIA), not a form fieldset
            <div key={section.title} role="group" aria-label={section.title}>
              <div className="palette-section" aria-hidden="true">
                {section.title}
              </div>
              {section.items.map((row) => {
                i++;
                const at = i;
                const Icon = row.icon;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard goes through the search box (combobox pattern)
                  <div
                    key={`${section.title}:${row.id}`}
                    id={rowId(at)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={at === current}
                    aria-disabled={row.disabled || undefined}
                    aria-checked={row.checked || undefined}
                    className={`palette-item${at === current ? " is-active" : ""}${row.disabled ? " is-disabled" : ""}`}
                    onPointerMove={() => at !== current && setActive(at)}
                    onPointerDown={(e) => e.preventDefault()} // keep focus in the search box
                    onClick={() => choose(row)}
                  >
                    <span className="palette-icon" aria-hidden="true">
                      {Icon && <Icon size={15} />}
                    </span>
                    <span className="palette-label">{row.label}</span>
                    {row.detail && <span className="palette-detail">{row.detail}</span>}
                    {row.checked && (
                      <Check size={14} className="palette-check" aria-hidden="true" />
                    )}
                    {row.shortcut && (
                      <span className="palette-keys" aria-hidden="true">
                        {shortcutKeys(row.shortcut, PLATFORM).map((key) => (
                          <kbd key={key}>{key}</kbd>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div className="palette-empty">Nothing matches “{query.trim()}”</div>
          )}
        </div>
      </div>
    </div>
  );
}
