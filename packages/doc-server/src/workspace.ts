/**
 * Workspace: a folder of .veloce files the server manages.
 *
 * - Decks are listed cheaply (manifest + document only) and opened on demand.
 * - Every change is autosaved after a short pause (debounced), atomically.
 * - One deck is "active": what the user is looking at, and what agents work on by default.
 *
 * Asset bytes nothing can use any more (a cancelled drop, an upload never added) are swept
 * after each save and every few minutes, so they don't hold memory for the whole session (D65).
 *
 * Decks are identified by their deck ID. If a folder holds two files with the same ID (a copied
 * file), the copy gets a fresh ID when it's opened so the two never get mixed up.
 *
 * Deleting a deck moves its file to `.trash/` in the folder (D99), named `<ms>-<file>`; it
 * can be restored this session, and trashed files over 30 days old are removed on open.
 */
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type ApplyContext,
  createDeck,
  createId,
  DEFAULT_THEME,
  type Deck,
  type DeckListing,
  type DeckVersion,
  notFoundHint,
  type Theme,
  VeloceError,
  type VersionInfo,
} from "@veloce/core";
import { FILE_EXTENSION, inspectVeloce, readVeloce, writeVeloce } from "@veloce/format";
import { atomicWriteFile, slugify } from "./fs.js";
import { type DeckChange, type ImageOptimizer, OpenDeck, UPLOAD_GRACE_MS } from "./open-deck.js";

export interface WorkspaceOptions {
  /** Folder holding the .veloce files (created if missing). */
  dir: string;
  /** Plugin validation for every transaction (`registry.applyContext()`). */
  context?: ApplyContext;
  /** Pause after the last change before saving. Default 800 ms. `configure` changes it. */
  autosaveDelayMs?: number;
  /** Undo steps kept per origin in every open deck. Default 200. `configure` changes it. */
  undoSteps?: number;
  /** Recorded in saved files' manifests. */
  generator?: { name: string; version: string };
  /**
   * How often open decks drop asset bytes nothing uses, besides after each save, so an
   * orphan upload in a deck nobody edits is freed too. Default: the upload grace period.
   */
  sweepIntervalMs?: number;
  /** The clock (ms since the epoch) open decks use, for tests. */
  now?: () => number;
  /** Optimize imported images (D67). Default true. */
  optimizeImages?: boolean;
  /** What optimizes them (tests swap it). Default: a worker thread. */
  optimizer?: ImageOptimizer;
  log?: (message: string) => void;
}

export type WorkspaceEvent =
  | { type: "decks"; decks: DeckListing[]; activeDeckId: string | null }
  | { type: "change"; change: DeckChange }
  /** A deck's saved versions changed (D93): one saved or deleted. Newest first. */
  | { type: "versions"; deckId: string; versions: VersionInfo[] };

/** Where deleted decks go, inside the workspace folder (D99). */
export const TRASH_DIR = ".trash";
/** Trashed decks older than this are removed when the workspace opens. */
export const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const TRASHED_NAME = /^(\d+)-(.+)$/;

interface FileEntry {
  file: string;
  title: string;
  slideCount: number;
  modifiedAt: Date;
}

export class Workspace {
  readonly dir: string;
  readonly #options: WorkspaceOptions;
  readonly #files = new Map<string, FileEntry>();
  readonly #open = new Map<string, OpenDeck>();
  readonly #loading = new Map<string, Promise<OpenDeck>>();
  readonly #listeners = new Set<(event: WorkspaceEvent) => void>();
  readonly #saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #saving = new Map<string, Promise<void>>();
  readonly #sweepTimer: ReturnType<typeof setInterval>;
  #active: string | null = null;
  #closed = false;
  /** Decks deleted this session → their file in the trash and their name before (D99). */
  readonly #trashed = new Map<
    string,
    { trashFile: string; file: string; title: string; wasActive: boolean }
  >();
  /** What `configure` can change while running (the app settings, D91). */
  #autosaveDelayMs: number;
  #undoSteps: number;

  private constructor(options: WorkspaceOptions) {
    this.dir = options.dir;
    this.#options = options;
    this.#autosaveDelayMs = options.autosaveDelayMs ?? 800;
    this.#undoSteps = options.undoSteps ?? 200;
    this.#sweepTimer = setInterval(() => {
      for (const open of this.#open.values()) open.sweepAssets();
    }, options.sweepIntervalMs ?? UPLOAD_GRACE_MS);
    this.#sweepTimer.unref?.(); // never keeps the process alive on its own
  }

  /** Open (or create) a workspace folder and index the decks in it. */
  static async open(options: WorkspaceOptions): Promise<Workspace> {
    const workspace = new Workspace(options);
    await mkdir(options.dir, { recursive: true });
    await workspace.#emptyOldTrash();
    await workspace.#scan();
    return workspace;
  }

  /**
   * Changes the autosave pause and the undo depth while running (D91): the next save waits
   * the new pause, and every open deck keeps the new number of undo steps from its next one.
   */
  configure(changes: { autosaveDelayMs?: number; undoSteps?: number }): void {
    if (changes.autosaveDelayMs !== undefined) this.#autosaveDelayMs = changes.autosaveDelayMs;
    if (changes.undoSteps !== undefined) this.#undoSteps = changes.undoSteps;
  }

  get activeDeckId(): string | null {
    return this.#active;
  }

  list(): DeckListing[] {
    const listings: DeckListing[] = [];
    for (const [id, entry] of this.#files) {
      const open = this.#open.get(id);
      listings.push({
        id,
        title: open?.deck.meta.title ?? entry.title,
        slideCount: open?.deck.slides.length ?? entry.slideCount,
        file: entry.file,
        modifiedAt: (open?.modifiedAt ?? entry.modifiedAt).toISOString(),
      });
    }
    return listings.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
  }

  has(deckId: string): boolean {
    return this.#files.has(deckId);
  }

  /** Get an open deck, loading it from disk if needed. */
  async get(deckId: string): Promise<OpenDeck> {
    const open = this.#open.get(deckId);
    if (open) return open;
    const loading = this.#loading.get(deckId);
    if (loading) return loading;
    const entry = this.#files.get(deckId);
    if (!entry) {
      throw new VeloceError("NOT_FOUND", `No deck with ID "${deckId}"`, {
        hint: notFoundHint(deckId, [...this.#files.keys()], "deck"),
      });
    }
    const promise = this.#load(deckId, entry).finally(() => this.#loading.delete(deckId));
    this.#loading.set(deckId, promise);
    return promise;
  }

  /** Create a new deck file and make it the active deck. */
  async create(options: { title: string; theme?: Theme }): Promise<OpenDeck> {
    const deck = createDeck({ title: options.title, theme: options.theme ?? DEFAULT_THEME });
    const file = await this.#freeFileName(slugify(options.title));
    const open = this.#adopt(deck, join(this.dir, file), new Map(), new Date());
    this.#files.set(deck.id, {
      file,
      title: deck.meta.title,
      slideCount: 0,
      modifiedAt: open.modifiedAt,
    });
    await this.#save(open);
    this.setActive(deck.id);
    return open;
  }

  /**
   * Saves a deck as it is now under a name (D93), and writes the file at once: a safety net
   * shouldn't wait for the autosave pause.
   */
  async saveVersion(deckId: string, name: string): Promise<VersionInfo> {
    const open = await this.get(deckId);
    const info = open.saveVersion(name);
    await this.#versionsChanged(open);
    return info;
  }

  async deleteVersion(deckId: string, versionId: string): Promise<void> {
    const open = await this.get(deckId);
    open.deleteVersion(versionId);
    await this.#versionsChanged(open);
  }

  async #versionsChanged(open: OpenDeck): Promise<void> {
    clearTimeout(this.#saveTimers.get(open.id)); // this save covers pending edits too
    this.#saveTimers.delete(open.id);
    const event: WorkspaceEvent = {
      type: "versions",
      deckId: open.id,
      versions: open.savedVersions(),
    };
    for (const listener of this.#listeners) listener(event);
    await this.#save(open);
  }

  /**
   * Moves a deck to the trash (D99): its pending edits are saved first, so a restore brings
   * back exactly what was there. If it was the active deck, the most recent other one is.
   */
  async delete(deckId: string): Promise<{ title: string }> {
    const entry = this.#files.get(deckId);
    if (!entry) {
      throw new VeloceError("NOT_FOUND", `No deck with ID "${deckId}"`, {
        hint: notFoundHint(deckId, [...this.#files.keys()], "deck"),
      });
    }
    await this.#loading.get(deckId)?.catch(() => undefined);
    const open = this.#open.get(deckId);
    clearTimeout(this.#saveTimers.get(deckId));
    this.#saveTimers.delete(deckId);
    if (open) await this.#save(open);
    else await this.#saving.get(deckId);
    const title = open?.deck.meta.title ?? entry.title;
    // Gone from the workspace before the file moves: nothing can schedule a save of it now.
    this.#open.delete(deckId);
    this.#files.delete(deckId);
    const trashFile = `${this.#now()}-${entry.file}`;
    await mkdir(join(this.dir, TRASH_DIR), { recursive: true });
    try {
      await rename(join(this.dir, entry.file), join(this.dir, TRASH_DIR, trashFile));
    } catch (error) {
      this.#files.set(deckId, entry); // still where it was: keep listing it
      if (open) this.#open.set(deckId, open);
      throw error;
    }
    const wasActive = this.#active === deckId;
    this.#trashed.set(deckId, { trashFile, file: entry.file, title, wasActive });
    if (wasActive) this.#active = this.list()[0]?.id ?? null;
    this.#emitDecks();
    return { title };
  }

  /** True if this deck was moved to the trash this session (and not restored). */
  trashed(deckId: string): boolean {
    return this.#trashed.has(deckId);
  }

  /**
   * Brings back a deck deleted this session, under its old file name if it's free. It's the
   * active deck again if it was when deleted (or if there's none): Undo after trashing
   * another deck from Manage decks doesn't move anyone's view.
   */
  async restore(deckId: string): Promise<void> {
    const trashed = this.#trashed.get(deckId);
    if (!trashed) {
      throw new VeloceError("NOT_FOUND", `Deck "${deckId}" isn't in the trash`);
    }
    const existing = new Set(await readdir(this.dir));
    const file = existing.has(trashed.file)
      ? await this.#freeFileName(trashed.file.slice(0, -FILE_EXTENSION.length))
      : trashed.file;
    const path = join(this.dir, file);
    await rename(join(this.dir, TRASH_DIR, trashed.trashFile), path);
    this.#trashed.delete(deckId);
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    const { manifest, slideCount } = inspectVeloce(bytes);
    this.#files.set(deckId, { file, title: manifest.title, slideCount, modifiedAt: info.mtime });
    if (trashed.wasActive || this.#active === null) this.#active = deckId;
    this.#emitDecks();
  }

  /** Mark a deck as the one being worked on (editors follow it; agents default to it). */
  setActive(deckId: string): void {
    if (!this.#files.has(deckId)) throw new VeloceError("NOT_FOUND", `No deck with ID "${deckId}"`);
    if (this.#active === deckId) return;
    this.#active = deckId;
    this.#emitDecks();
  }

  subscribe(listener: (event: WorkspaceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Save every deck with pending changes now. */
  async flush(): Promise<void> {
    const pending = [...this.#saveTimers.keys()];
    for (const id of pending) {
      clearTimeout(this.#saveTimers.get(id));
      this.#saveTimers.delete(id);
      const open = this.#open.get(id);
      if (open) void this.#save(open);
    }
    await Promise.all(this.#saving.values());
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.flush();
    this.#closed = true;
    clearInterval(this.#sweepTimer);
    this.#listeners.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────

  async #scan(): Promise<void> {
    const names = (await readdir(this.dir)).filter((n) => n.endsWith(FILE_EXTENSION)).sort();
    for (const file of names) {
      const path = join(this.dir, file);
      try {
        const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
        const { manifest, deckId, slideCount } = inspectVeloce(bytes);
        let id = deckId;
        if (this.#files.has(id)) {
          // A copy of another deck: give it its own identity.
          const result = await readVeloce(bytes, this.#readOptions());
          const copy: Deck = { ...result.deck, id: createId("dk") };
          id = copy.id;
          this.#adopt(copy, path, result.assets, new Date(manifest.createdAt), result.versions);
          this.#log(`${file} is a copy of another deck; gave it a new ID`);
        }
        this.#files.set(id, { file, title: manifest.title, slideCount, modifiedAt: info.mtime });
        const open = this.#open.get(id);
        if (open) await this.#save(open);
      } catch (error) {
        this.#log(`Skipped ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.#active = this.list()[0]?.id ?? null;
  }

  async #load(deckId: string, entry: FileEntry): Promise<OpenDeck> {
    const path = join(this.dir, entry.file);
    const result = await readVeloce(await readFile(path), this.#readOptions());
    for (const warning of result.warnings) this.#log(`${entry.file}: ${warning}`);
    if (result.deck.id !== deckId) {
      throw new VeloceError(
        "CONFLICT",
        `${entry.file} changed on disk (it now holds another deck)`,
      );
    }
    return this.#adopt(
      result.deck,
      path,
      result.assets,
      new Date(result.manifest.createdAt),
      result.versions,
    );
  }

  #adopt(
    deck: Deck,
    path: string,
    assets: ReadonlyMap<string, Uint8Array>,
    createdAt: Date,
    versions: readonly DeckVersion[] = [],
  ): OpenDeck {
    const { context, now, optimizeImages, optimizer } = this.#options;
    const open = new OpenDeck({
      deck,
      path,
      assets,
      createdAt,
      ...(context && { context }),
      ...(now && { now }),
      ...(optimizeImages !== undefined && { optimizeImages }),
      ...(optimizer && { optimizer }),
      historyLimit: () => this.#undoSteps,
      versions,
    });
    open.subscribe((change) => {
      this.#scheduleSave(open);
      for (const listener of this.#listeners) listener({ type: "change", change });
      // Title or slide count changes show up in deck lists.
      const entry = this.#files.get(open.id);
      if (
        entry &&
        (entry.title !== change.deck.meta.title || entry.slideCount !== change.deck.slides.length)
      ) {
        entry.title = change.deck.meta.title;
        entry.slideCount = change.deck.slides.length;
        this.#emitDecks();
      }
    });
    this.#open.set(deck.id, open);
    return open;
  }

  #scheduleSave(open: OpenDeck): void {
    if (this.#closed) return;
    clearTimeout(this.#saveTimers.get(open.id));
    this.#saveTimers.set(
      open.id,
      setTimeout(() => {
        this.#saveTimers.delete(open.id);
        void this.#save(open);
      }, this.#autosaveDelayMs),
    );
  }

  /** Saves of one deck run one after another, never interleaved. */
  #save(open: OpenDeck): Promise<void> {
    const previous = this.#saving.get(open.id) ?? Promise.resolve();
    const next = previous.then(async () => {
      // Deleted (D99): writing now would put the file back.
      if (this.#open.get(open.id) !== open) return;
      try {
        const bytes = await writeVeloce(open.bundle(), {
          createdAt: open.createdAt,
          ...(this.#options.generator && { generator: this.#options.generator }),
        });
        await atomicWriteFile(open.path, bytes);
        const entry = this.#files.get(open.id);
        if (entry) entry.modifiedAt = open.modifiedAt;
      } catch (error) {
        this.#log(
          `Saving ${basename(open.path)} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // The file never holds unused assets (`bundle`); this frees their memory too.
      open.sweepAssets();
    });
    this.#saving.set(open.id, next);
    void next.finally(() => {
      if (this.#saving.get(open.id) === next) this.#saving.delete(open.id);
    });
    return next;
  }

  /** Removes trashed decks older than TRASH_KEEP_MS (by the time in their name). */
  async #emptyOldTrash(): Promise<void> {
    const trash = join(this.dir, TRASH_DIR);
    let names: string[];
    try {
      names = await readdir(trash);
    } catch {
      return; // no trash yet
    }
    for (const name of names) {
      const at = Number(TRASHED_NAME.exec(name)?.[1]);
      if (!at || this.#now() - at < TRASH_KEEP_MS) continue;
      await rm(join(trash, name), { force: true });
      this.#log(`Emptied ${name} from the trash (deleted over 30 days ago)`);
    }
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  async #freeFileName(slug: string): Promise<string> {
    const taken = new Set([...this.#files.values()].map((e) => e.file));
    const existing = new Set(await readdir(this.dir));
    for (let n = 1; ; n++) {
      const file = `${slug}${n === 1 ? "" : `-${n}`}${FILE_EXTENSION}`;
      if (!taken.has(file) && !existing.has(file)) return file;
    }
  }

  #readOptions() {
    const context = this.#options.context;
    return context ? { context } : {};
  }

  #emitDecks(): void {
    const event: WorkspaceEvent = { type: "decks", decks: this.list(), activeDeckId: this.#active };
    for (const listener of this.#listeners) listener(event);
  }

  #log(message: string): void {
    (this.#options.log ?? ((m: string) => console.warn(`[veloce] ${m}`)))(message);
  }
}
