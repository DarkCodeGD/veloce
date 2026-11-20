/**
 * The command registry (D79 §4, D81): every command the user can run, with its label, icon,
 * shortcut and menu place, in ONE list that the tool bar, the Add menu and the keyboard all
 * read. Built-in commands register here exactly as plugin commands will, so the menu bar and
 * command palette (roadmap round 5) only add views of this list.
 *
 * Pure: no DOM, no React. The app keeps one instance (editor-commands.ts) and hands it the
 * editor's state (`C`) when a command runs, so commands never reach into components.
 */
import { type KeyPress, matchesShortcut, type Platform, type ShortcutSpec } from "./shortcuts.js";

/** Where a command was invoked on screen (a right-click, the pointer at Shift+A), if anywhere. */
export interface RunOptions {
  at?: { x: number; y: number } | undefined;
}

export interface CommandSpec<C, I = unknown> {
  /** Unique, dotted: `tool.text`, `add.rect`, later `plugin.<id>.<name>`. */
  id: string;
  label: string;
  /** Opaque to the registry (the app passes icon components). */
  icon?: I;
  shortcut?: ShortcutSpec;
  /** Which menu lists it: "tools", "add"… */
  group: string;
  /** Section within the menu ("Shapes"). */
  section?: string;
  /** More words a search matches. */
  keywords?: string;
  enabled?(context: C): boolean;
  /** Shown as the current choice (the active tool). */
  checked?(context: C): boolean;
  run(context: C, options: RunOptions): void;
}

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

  /** The commands of one menu, in registration order. */
  list(group?: string): CommandSpec<C, I>[] {
    const all = [...this.#commands.values()];
    return group === undefined ? all : all.filter((c) => c.group === group);
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

  /** The enabled command whose shortcut is exactly this key press, if any. */
  forKey(press: KeyPress, platform: Platform, context: C): CommandSpec<C, I> | undefined {
    for (const command of this.#commands.values()) {
      if (command.shortcut && matchesShortcut(press, command.shortcut, platform)) {
        return this.isEnabled(command.id, context) ? command : undefined;
      }
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
