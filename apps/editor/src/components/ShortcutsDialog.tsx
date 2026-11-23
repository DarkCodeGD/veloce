/**
 * Help → Keyboard shortcuts (D89): every registry command with a key, under its menu, plus
 * the canvas gestures that aren't commands. A view of the registry, so a plugin's shortcuts
 * appear here too. Preferences → Keymap (roadmap round 5) grows from this list.
 */
import { useSyncExternalStore } from "react";
import { commands, MENU_BAR } from "../editor-commands.js";
import { shortcutKeys } from "../model/shortcuts.js";
import { PLATFORM } from "../platform.js";
import { Dialog } from "./Dialog.js";

/** Lists for commands no menu shows, by their `group`. */
const OTHER_LISTS: Record<string, string> = { tools: "Tools", slide: "Slide" };

/** Keys that drive gestures rather than commands. */
const GESTURES: ReadonlyArray<{ label: string; keys: string }> = [
  { label: "Nudge (Shift: 10 px)", keys: "↑ ↓ ← →" },
  { label: "Pan the canvas", keys: "Space + drag" },
  { label: "Rename a layer (Layers panel)", keys: "F2" },
];

interface Row {
  id: string;
  label: string;
  keys: string[];
}

function sections(): Array<{ title: string; rows: Row[] }> {
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
    });
    byTitle.set(title, rows);
  }
  const result = [...byTitle].map(([title, rows]) => ({ title, rows }));
  result.push({
    title: "Canvas",
    rows: GESTURES.map(({ label, keys }) => ({ id: label, label, keys: [keys] })),
  });
  return result.filter((s) => s.rows.length > 0);
}

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  useSyncExternalStore(commands.subscribe, commands.version);
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
      <div className="shortcut-sections">
        {sections().map(({ title, rows }) => (
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
    </Dialog>
  );
}
