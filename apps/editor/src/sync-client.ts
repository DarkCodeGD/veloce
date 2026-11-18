/**
 * SyncClient: the editor's connection to the doc-server.
 *
 * Holds a replica of the open deck: a snapshot, then each change applied with core's pure
 * `applyChange` (exactly what the server did), so unchanged slides keep their identity and the
 * renderer skips them. Any gap or failure triggers a fresh snapshot. Reconnects with backoff.
 */
import {
  applyChange,
  type Deck,
  type DeckListing,
  type Origin,
  type ServerMessage,
} from "@veloce/core";

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
}

const INITIAL: SyncState = {
  status: "connecting",
  decks: [],
  activeDeckId: null,
  deckId: null,
  deck: null,
  version: 0,
  lastChange: null,
};

export class SyncClient {
  readonly #url: string;
  #state: SyncState = INITIAL;
  readonly #listeners = new Set<() => void>();
  #socket: WebSocket | null = null;
  #retry = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

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
        this.#set({ deckId: message.deckId, deck: message.deck, version: message.version });
        return;
      case "change": {
        if (message.deckId !== state.deckId || !state.deck) return;
        const next = applyChange({ deck: state.deck, version: state.version }, message);
        if (!next) {
          this.open(message.deckId); // out of sync: get a fresh snapshot
          return;
        }
        const before = new Set(state.deck.slides);
        this.#set({
          deck: next.deck,
          version: next.version,
          lastChange: {
            origin: message.origin,
            label: message.label,
            slideIds: next.deck.slides.filter((s) => !before.has(s)).map((s) => s.id),
            at: Date.now(),
          },
        });
        return;
      }
      case "result":
      case "error":
        if (message.type === "error") console.warn(`[veloce] ${message.message}`);
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
