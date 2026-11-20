/**
 * SyncClient: the editor's connection to the doc-server.
 *
 * Holds a replica of the open deck: a snapshot, then each change applied with core's pure
 * `applyChange` (exactly what the server did), so unchanged slides keep their identity and the
 * renderer skips them. Any gap or failure triggers a fresh snapshot. Reconnects with backoff.
 *
 * Writes (`transact`, `undo`, `redo`) are requests: the server applies them (stamping the
 * `user` origin) and broadcasts the change like any other. No optimistic local edits: the server
 * owns the document, and a localhost round trip is ~1 ms. Interactions such as dragging preview
 * locally and commit one transaction at the end.
 */
import {
  appendHistory,
  applyChange,
  type Deck,
  type DeckListing,
  type ErrorInfo,
  type HistoryEntry,
  type LintReport,
  type Op,
  type Origin,
  randomId,
  type ServerMessage,
} from "@veloce/core";

/** A rejected write: the server's reason, ready to show to the user. */
export class SyncError extends Error {
  constructor(readonly info: Pick<ErrorInfo, "message"> & Partial<ErrorInfo>) {
    super(info.message);
  }
}

export type ConnectionStatus = "connecting" | "online" | "offline";

export interface LastChange {
  origin: Origin;
  label: string;
  /** Slides added or modified by this change. */
  slideIds: string[];
  at: number;
}

export interface SyncState {
  status: ConnectionStatus;
  decks: DeckListing[];
  activeDeckId: string | null;
  deckId: string | null;
  deck: Deck | null;
  version: number;
  lastChange: LastChange | null;
  /** The open deck's recent changes, oldest first (the history panel). */
  history: HistoryEntry[];
  /**
   * The open deck's lint, as the server last checked it (D73). Its `version` trails the
   * deck's while a re-check is running; null until the first check arrives.
   */
  lint: LintReport | null;
}

/** Matches the server's limit (doc-server HISTORY_LIMIT). */
const HISTORY_LIMIT = 500;

const INITIAL: SyncState = {
  status: "connecting",
  decks: [],
  activeDeckId: null,
  deckId: null,
  deck: null,
  version: 0,
  lastChange: null,
  history: [],
  lint: null,
};

export class SyncClient {
  readonly #url: string;
  #state: SyncState = INITIAL;
  readonly #listeners = new Set<() => void>();
  #socket: WebSocket | null = null;
  #retry = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;
  readonly #pending = new Map<string, { resolve(): void; reject(error: SyncError): void }>();

  constructor(url: string) {
    this.#url = url;
    this.#connect();
  }

  /** For React's useSyncExternalStore. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getState = (): SyncState => this.#state;

  /** Show another deck (also makes it the active deck for agents). */
  open(deckId: string): void {
    this.#send({ type: "open", deckId });
  }

  /** Apply ops to the open deck as one undoable step. Rejects with the server's reason. */
  transact(label: string, ops: Op[]): Promise<void> {
    const deckId = this.#state.deckId;
    if (!deckId) return Promise.reject(new SyncError({ message: "No deck is open" }));
    return this.#request((requestId) => ({ type: "transaction", requestId, deckId, label, ops }));
  }

  /** Undo your last change (never an agent's). Resolves false when there's nothing to undo. */
  undo(): Promise<boolean> {
    return this.#history("undo");
  }

  redo(): Promise<boolean> {
    return this.#history("redo");
  }

  /**
   * Revert agents' changes (by history version) as one change of your own, so your undo
   * brings them back. Rejects with the server's reason (too old, already reverted…).
   */
  revert(versions: number[]): Promise<void> {
    const deckId = this.#state.deckId;
    if (!deckId) return Promise.reject(new SyncError({ message: "No deck is open" }));
    return this.#request((requestId) => ({ type: "revert", requestId, deckId, versions }));
  }

  async #history(type: "undo" | "redo"): Promise<boolean> {
    const deckId = this.#state.deckId;
    if (!deckId) return false;
    try {
      await this.#request((requestId) => ({ type, requestId, deckId }));
      return true;
    } catch (error) {
      if (error instanceof SyncError && error.info.code === "NOT_FOUND") return false;
      throw error;
    }
  }

  #request(build: (requestId: string) => unknown): Promise<void> {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new SyncError({ message: "Not connected to the Veloce server" }));
    }
    const requestId = randomId(16);
    return new Promise<void>((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#send(build(requestId));
    });
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#retryTimer);
    this.#socket?.close();
  }

  #connect(): void {
    this.#set({ status: "connecting" });
    const socket = new WebSocket(this.#url);
    this.#socket = socket;
    socket.onopen = () => {
      this.#retry = 0;
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        this.#onMessage(JSON.parse(event.data) as ServerMessage);
      } catch (error) {
        console.error("Bad message from server", error);
      }
    };
    socket.onclose = () => {
      if (this.#socket !== socket || this.#disposed) return;
      for (const { reject } of this.#pending.values()) {
        reject(new SyncError({ message: "Lost the connection to the Veloce server" }));
      }
      this.#pending.clear();
      this.#set({ status: "offline" });
      const delay = Math.min(5000, 500 * 2 ** this.#retry++);
      this.#retryTimer = setTimeout(() => this.#connect(), delay);
    };
  }

  #onMessage(message: ServerMessage): void {
    const state = this.#state;
    switch (message.type) {
      case "welcome": {
        this.#set({ status: "online", decks: message.decks, activeDeckId: message.activeDeckId });
        const target = state.deckId ?? message.activeDeckId ?? message.decks[0]?.id;
        if (target) this.open(target);
        return;
      }
      case "decks":
        this.#set({ decks: message.decks, activeDeckId: message.activeDeckId });
        // Follow the active deck (e.g. an agent just created or opened one).
        if (message.activeDeckId && message.activeDeckId !== state.deckId)
          this.open(message.activeDeckId);
        return;
      case "snapshot":
        this.#set({
          deckId: message.deckId,
          deck: message.deck,
          version: message.version,
          history: message.history ?? [], // older servers don't send it
          // Another deck's issues don't apply; a resync of this one keeps them until re-checked.
          ...(message.deckId !== state.deckId && { lint: null }),
        });
        return;
      case "lint": {
        if (message.deckId !== state.deckId) return;
        const { version, issues, visual } = message;
        this.#set({ lint: { version, issues, visual } });
        return;
      }
      case "change": {
        if (message.deckId !== state.deckId || !state.deck) return;
        const next = applyChange({ deck: state.deck, version: state.version }, message);
        if (!next) {
          this.open(message.deckId); // out of sync: get a fresh snapshot
          return;
        }
        const before = new Set(state.deck.slides);
        const after = new Set(next.deck.slides.map((s) => s.id));
        const removedSlideIds = state.deck.slides.filter((s) => !after.has(s.id)).map((s) => s.id);
        const entry: HistoryEntry = {
          version: next.version,
          origin: message.origin,
          label: message.label,
          slideIds: next.deck.slides.filter((s) => !before.has(s)).map((s) => s.id),
          ...(removedSlideIds.length && { removedSlideIds }),
          at: message.at ?? Date.now(),
          ...(message.reverts && { reverts: message.reverts }),
          ...(message.restores && { restores: message.restores }),
        };
        this.#set({
          deck: next.deck,
          version: next.version,
          lastChange: entry,
          // Marks the changes a revert (or its undo) took back or brought back.
          history: appendHistory(state.history, entry, HISTORY_LIMIT),
        });
        return;
      }
      case "result": {
        const pending = this.#pending.get(message.requestId);
        this.#pending.delete(message.requestId);
        if (message.ok) pending?.resolve();
        else pending?.reject(new SyncError(message.error));
        return;
      }
      case "error":
        console.warn(`[veloce] ${message.message}`);
        return;
    }
  }

  #send(message: unknown): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  #set(patch: Partial<SyncState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
}
