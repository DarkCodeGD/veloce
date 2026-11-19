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
 */
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type ApplyContext,
  createDeck,
  createId,
  DEFAULT_THEME,
  type Deck,
  type DeckListing,
  notFoundHint,
  type Theme,
  VeloceError,
} from "@veloce/core";
import { FILE_EXTENSION, inspectVeloce, readVeloce, writeVeloce } from "@veloce/format";
import { atomicWriteFile, slugify } from "./fs.js";
import { type DeckChange, type ImageOptimizer, OpenDeck, UPLOAD_GRACE_MS } from "./open-deck.js";

export interface WorkspaceOptions {
  /** Folder holding the .veloce files (created if missing). */
  dir: string;
  /** Plugin validation for every transaction (`registry.applyContext()`). */
  context?: ApplyContext;
  /** Pause after the last change before saving. Default 800 ms. */
  autosaveDelayMs?: number;
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
  | { type: "change"; change: DeckChange };

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

  private constructor(options: WorkspaceOptions) {
    this.dir = options.dir;
    this.#options = options;
    this.#sweepTimer = setInterval(() => {
      for (const open of this.#open.values()) open.sweepAssets();
    }, options.sweepIntervalMs ?? UPLOAD_GRACE_MS);
    this.#sweepTimer.unref?.(); // never keeps the process alive on its own
  }

  /** Open (or create) a workspace folder and index the decks in it. */
  static async open(options: WorkspaceOptions): Promise<Workspace> {
    const workspace = new Workspace(options);
    await mkdir(options.dir, { recursive: true });
    await workspace.#scan();
    return workspace;
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
          this.#adopt(copy, path, result.assets, new Date(manifest.createdAt));
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
    return this.#adopt(result.deck, path, result.assets, new Date(result.manifest.createdAt));
  }

  #adopt(
    deck: Deck,
    path: string,
    assets: ReadonlyMap<string, Uint8Array>,
    createdAt: Date,
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
      }, this.#options.autosaveDelayMs ?? 800),
    );
  }

  /** Saves of one deck run one after another, never interleaved. */
  #save(open: OpenDeck): Promise<void> {
    const previous = this.#saving.get(open.id) ?? Promise.resolve();
    const next = previous.then(async () => {
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
