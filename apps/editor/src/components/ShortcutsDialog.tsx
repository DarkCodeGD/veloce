/**
 * Help → Keyboard shortcuts (D89): every registry command with a key, under its menu, plus
 * the canvas gestures that aren't commands. A view of the registry, so a plugin's shortcuts
 * appear here too. Preferences → Keymap (D91) shows the same list with a search field.
 */
import { useSyncExternalStore } from "react";
import { commands, MENU_BAR } from "../editor-commands.js";
import { shortcutKeys } from "../model/shortcuts.js";
import { PLATFORM } from "../platform.js";
import { useSettings } from "../settings.js";
import { Dialog } from "./Dialog.js";

/** Lists for commands no menu shows, by their `group`. */
const OTHER_LISTS: Record<string, string> = { tools: "Tools", slide: "Slide" };

interface Row {
  id: string;
  label: string;
  keys: string[];
  /** More words a search matches (the command's keywords). */
  words: string;
}

interface ShortcutSection {
  title: string;
  rows: Row[];
}

/** Every shortcut by menu, then the canvas gestures (the nudge as Preferences sets it). */
function sections(nudgeBig: number): ShortcutSection[] {
  const byTitle = new Map<string, Row[]>();
  const titleOf = (menu: string | undefined, group: string) =>
    MENU_BAR.find((m) => m.id === menu)?.label ?? OTHER_LISTS[group] ?? "Other";
  // Menus in menu bar order first, then the other lists.
  for (const { label } of MENU_BAR) byTitle.set(label, []);
  for (const command of commands.list()) {
    if (!command.shortcut) continue;
    const title = titleOf(command.menu, command.group);
    const rows = byTitle.get(title) ?? [];
    rows.push({
      id: command.id,
      label: command.label.replace(/…$/, ""),
      keys: shortcutKeys(command.shortcut, PLATFORM),
      words: command.keywords ?? "",
    });
    byTitle.set(title, rows);
  }
  const gestures: ReadonlyArray<[string, string]> = [
    [`Nudge (Shift: ${nudgeBig} px)`, "↑ ↓ ← →"],
    ["Pan the canvas", "Space + drag"],
    ["Rename a layer (Layers panel)", "F2"],
  ];
  const result = [...byTitle].map(([title, rows]) => ({ title, rows }));
  result.push({
    title: "Canvas",
    rows: gestures.map(([label, keys]) => ({ id: label, label, keys: [keys], words: "" })),
  });
  return result;
}

/**
 * The sections whose title, or rows whose name, keys or keywords, contain every word of
 * the query (any case). An empty query keeps everything.
 */
function matching(all: ShortcutSection[], query: string): ShortcutSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  return all
    .map(({ title, rows }) => ({
      title,
      rows: hit(title)
        ? rows
        : rows.filter((r) => hit(`${r.label} ${r.keys.join(" ")} ${r.words}`)),
    }))
    .filter((s) => s.rows.length > 0);
}

/** The shortcut list, optionally filtered (Preferences → Keymap). */
export function ShortcutList({ query = "" }: { query?: string }) {
  useSyncExternalStore(commands.subscribe, commands.version);
  const { nudgeBig } = useSettings().editing;
  const shown = matching(sections(nudgeBig), query);
  if (shown.length === 0) return <p className="shortcut-empty">No shortcut matches “{query}”.</p>;
  return (
    <div className="shortcut-sections">
      {shown.map(({ title, rows }) => (
        <section key={title} className="shortcut-section">
          <h3>{title}</h3>
          <dl>
            {rows.map((row) => (
              <div key={row.id} className="shortcut-row">
                <dt>{row.label}</dt>
                <dd>
                  {row.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog
      title="Keyboard shortcuts"
      className="shortcuts-dialog"
      onClose={onClose}
      onSubmit={onClose}
      actions={
        <button type="submit" className="button button-primary">
          Done
        </button>
      }
    >
      <ShortcutList />
    </Dialog>
  );
}
