/**
 * SettingsStore (D91): the app settings, in one JSON file the server owns (outside every
 * deck), handed to every editor tab and kept current.
 *
 * - Reading never fails: a missing file means the defaults, and broken values fall back
 *   field by field (`parseSettings`). A file that isn't JSON at all is copied aside to
 *   `<file>.broken` before anything overwrites it, so a hand edit with a typo isn't lost.
 * - Writes are atomic (temp file + rename) and run one after another; changes made while
 *   one is running are written together right after it.
 * - Without a file (tests) the settings live in memory only.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  formatIssues,
  parseSettings,
  type Settings,
  type SettingsPatch,
  SettingsPatchSchema,
  VeloceError,
} from "@veloce/core";
import { atomicWriteFile } from "./fs.js";

export class SettingsStore {
  /** The settings file, or null when they're kept in memory only. */
  readonly file: string | null;
  #settings: Settings;
  readonly #listeners = new Set<(settings: Settings) => void>();
  readonly #log: (message: string) => void;
  /** The write in progress, if any; `#dirty` asks for another one after it. */
  #writing: Promise<void> | null = null;
  #dirty = false;

  private constructor(file: string | null, settings: Settings, log: (message: string) => void) {
    this.file = file;
    this.#settings = settings;
    this.#log = log;
  }

  /** Loads the settings file (or starts from the defaults). `null`: memory only. */
  static async open(
    file: string | null,
    log: (message: string) => void = () => {},
  ): Promise<SettingsStore> {
    if (file === null) return new SettingsStore(null, DEFAULT_SETTINGS, log);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log(`Couldn't read the settings file ${file}, using the defaults: ${String(error)}`);
      }
      return new SettingsStore(file, DEFAULT_SETTINGS, log);
    }
    try {
      return new SettingsStore(file, parseSettings(JSON.parse(text)), log);
    } catch {
      const aside = `${file}.broken`;
      await copyFile(file, aside).catch(() => {});
      log(`The settings file ${file} isn't valid JSON: using the defaults (a copy is in ${aside})`);
      return new SettingsStore(file, DEFAULT_SETTINGS, log);
    }
  }

  get settings(): Settings {
    return this.#settings;
  }

  /**
   * Changes some settings, saves them and tells every subscriber. Throws a VeloceError
   * (`INVALID`) naming the bad field when the patch isn't valid; nothing changes then.
   */
  update(patch: unknown): Settings {
    const parsed = SettingsPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new VeloceError("INVALID", `Invalid settings: ${formatIssues(parsed.error.issues)}`);
    }
    const next = applySettingsPatch(this.#settings, parsed.data as SettingsPatch);
    if (JSON.stringify(next) === JSON.stringify(this.#settings)) return this.#settings;
    this.#settings = next;
    this.#save();
    for (const listener of this.#listeners) listener(next);
    return next;
  }

  /** Called with the new settings after each change. Returns an unsubscribe function. */
  subscribe(listener: (settings: Settings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Resolves once every change so far is on disk. */
  async flush(): Promise<void> {
    while (this.#writing) await this.#writing;
  }

  #save(): void {
    if (this.file === null) return;
    if (this.#writing) {
      this.#dirty = true; // written together once the current write is done
      return;
    }
    const file = this.file;
    this.#writing = (async () => {
      try {
        await mkdir(dirname(file), { recursive: true });
        const text = `${JSON.stringify(this.#settings, null, 2)}\n`;
        await atomicWriteFile(file, new TextEncoder().encode(text));
      } catch (error) {
        this.#log(`Couldn't save the settings to ${file}: ${String(error)}`);
      } finally {
        this.#writing = null;
        if (this.#dirty) {
          this.#dirty = false;
          this.#save();
        }
      }
    })();
  }
}
