/**
 * The command registry (D79 §4, D81, D89): every command the user can run, with its label,
 * shortcut and menu place, in ONE list that the menu bar, the tool bar, the Add menu and the
 * keyboard all read. Built-in commands register here exactly as plugin commands will, so the
 * command palette and the keymap preferences (roadmap round 5) only add views of this list.
 *
 * Pure: no DOM, no React. The app keeps one instance (editor-commands.ts) and hands it the
 * editor's state (`C`) when a command runs, so commands never reach into components.
 */
import { type KeyPress, matchesShortcut, type Platform, type ShortcutSpec } from "./shortcuts.js";

/** Where a command was invoked on screen (a right-click, the pointer at Shift+A), if anywhere. */
export interface RunOptions {
  at?: { x: number; y: number } | undefined;
}

/**
 * Where keyboard focus is when a key is pressed: the editor itself, a dropdown (a button
 * with no text of its own, so undo still means the deck's), or a field you type into.
 */
export type KeyTarget = "editor" | "dropdown" | "field";

export interface CommandSpec<C, I = unknown> {
  /** Unique, dotted: `tool.text`, `edit.undo`, later `plugin.<id>.<name>`. */
  id: string;
  label: string;
  /** Opaque to the registry (the app passes icon components). */
  icon?: I;
  /** The key shown next to it everywhere (menus, tooltips) and matched by the keyboard. */
  shortcut?: ShortcutSpec;
  /** More keys that run it, never shown: Ctrl+Y for Redo, PageDown for Next slide. */
  moreKeys?: readonly ShortcutSpec[];
  /**
   * Matches key presses itself instead of by its keys: zoom's "+" sits on a different key
   * per layout. `() => false` when the browser delivers the key another way (the
   * clipboard's own events carry Ctrl+C, X and V).
   */
  matchKey?(press: KeyPress): boolean;
  /**
   * Its keys still work while focus is in a field: in any field (`"always"`: zoom, which
   * types nothing), or only in a dropdown (`"dropdown"`: undo). Otherwise a field's keys
   * are its own.
   */
  inFields?: "always" | "dropdown";
  /** Runs again while its key is held down (undo, next slide). Off by default. */
  repeat?: boolean;
  /**
   * When its keys apply, beyond being enabled: the arrows change slides only with nothing
   * selected, Delete removes a slide only from the slide list. Menus ignore it.
   */
  keyWhen?(context: C): boolean;
  /** Which list shows it: "tools", "add"… (the tool bar and the Add menu read these). */
  group: string;
  /**
   * Which menu bar menu lists it ("edit", "view"…). None: it's reached by its keys, the
   * tool bar or (later) the command palette only.
   */
  menu?: string;
  /** Section within its menus ("Shapes"): a heading in the Add menu, a line in the menu bar. */
  section?: string;
  /** More words a search matches. */
  keywords?: string;
  enabled?(context: C): boolean;
  /** Shown as the current choice: the active tool, the open panel. */
  checked?(context: C): boolean;
  /** `checked` is on/off on its own (Follow AI), not one choice of several. */
  toggle?: boolean;
  run(context: C, options: RunOptions): void;
}

/** A key press as the registry sees it: held-down repeats are flagged. */
export type CommandKeyPress = KeyPress & { repeat?: boolean };

export class CommandRegistry<C, I = unknown> {
  readonly #commands = new Map<string, CommandSpec<C, I>>();
  readonly #listeners = new Set<() => void>();
  #version = 0;

  /** Adds a command; returns a function that removes it (a plugin unloading). */
  register(spec: CommandSpec<C, I>): () => void {
    if (this.#commands.has(spec.id)) throw new Error(`Command "${spec.id}" is already registered`);
    this.#commands.set(spec.id, spec);
    this.#changed();
    return () => {
      if (this.#commands.get(spec.id) === spec && this.#commands.delete(spec.id)) this.#changed();
    };
  }

  get(id: string): CommandSpec<C, I> | undefined {
    return this.#commands.get(id);
  }

  /** The commands of one list ("tools", "add"), in registration order. */
  list(group?: string): CommandSpec<C, I>[] {
    const all = [...this.#commands.values()];
    return group === undefined ? all : all.filter((c) => c.group === group);
  }

  /** One menu bar menu: its commands in registration order, split where the section changes. */
  menu(menu: string): CommandSpec<C, I>[][] {
    return splitSections([...this.#commands.values()].filter((c) => c.menu === menu));
  }

  isEnabled(id: string, context: C): boolean {
    const command = this.#commands.get(id);
    return command !== undefined && (command.enabled?.(context) ?? true);
  }

  /** Runs a command if it's enabled. True when it ran. */
  run(id: string, context: C, options: RunOptions = {}): boolean {
    const command = this.#commands.get(id);
    if (!command || !this.isEnabled(id, context)) return false;
    command.run(context, options);
    return true;
  }

  /**
   * The command a key press runs, if any: the first, in registration order, whose key it is
   * and that applies right now (enabled, its `keyWhen`, where focus is, not a held-down
   * repeat unless it repeats). So one key can mean different things by context: Enter
   * edits a text layer or goes into a frame, Esc leaves a tool or selects the parent.
   */
  forKey(
    press: CommandKeyPress,
    platform: Platform,
    context: C,
    target: KeyTarget = "editor",
  ): CommandSpec<C, I> | undefined {
    for (const command of this.#commands.values()) {
      if (!keyMatches(command, press, platform)) continue;
      if (press.repeat && !command.repeat) continue;
      if (!worksIn(command, target)) continue;
      if (command.keyWhen && !command.keyWhen(context)) continue;
      if (this.isEnabled(command.id, context)) return command;
    }
    return undefined;
  }

  /** For `useSyncExternalStore`: a number that changes whenever the list does. */
  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  readonly version = () => this.#version;

  #changed(): void {
    this.#version++;
    for (const listener of this.#listeners) listener();
  }
}

function keyMatches<C, I>(
  command: CommandSpec<C, I>,
  press: KeyPress,
  platform: Platform,
): boolean {
  if (command.matchKey) return command.matchKey(press);
  const keys = command.shortcut ? [command.shortcut, ...(command.moreKeys ?? [])] : [];
  return keys.some((spec) => matchesShortcut(press, spec, platform));
}

function worksIn<C, I>(command: CommandSpec<C, I>, target: KeyTarget): boolean {
  if (target === "editor" || command.inFields === "always") return true;
  return target === "dropdown" && command.inFields === "dropdown";
}

/** Consecutive runs of the same section, in order: the groups a menu draws lines between. */
export function splitSections<T extends { section?: string | undefined }>(
  items: readonly T[],
): T[][] {
  const groups: T[][] = [];
  let last: string | undefined;
  for (const item of items) {
    const group = groups.at(-1);
    if (group && item.section === last) group.push(item);
    else groups.push([item]);
    last = item.section;
  }
  return groups;
}
