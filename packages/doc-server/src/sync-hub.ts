/**
 * SyncHub: speaks the sync protocol (see `@veloce/core` sync.ts) with any number of clients.
 *
 * Transport-agnostic: the server wires each WebSocket (or, in Electron, an IPC channel) to
 * `connect(send)` and feeds incoming text to `receive()`. Editor clients always act as origin
 * `"user"`: the origin comes from the connection, never from the message.
 */
import {
  ClientMessageSchema,
  type ErrorInfo,
  formatIssues,
  type Origin,
  type ServerMessage,
  SYNC_PROTOCOL_VERSION,
  type TransactionResult,
  VeloceError,
} from "@veloce/core";
import type { DeckLinter } from "./lint.js";
import type { Workspace } from "./workspace.js";

export interface SyncConnection {
  /** Feed one incoming text message. */
  receive(raw: string): void;
  close(): void;
}

export interface ConnectOptions {
  /** Origin for this client's transactions. Default `"user"`. */
  origin?: Origin;
}

export interface SyncHubOptions {
  /** Sends each client its open deck's lint, kept current (D73). Without it: no lint. */
  linter?: DeckLinter;
}

export class SyncHub {
  readonly #workspace: Workspace;
  readonly #linter: DeckLinter | undefined;

  constructor(workspace: Workspace, options: SyncHubOptions = {}) {
    this.#workspace = workspace;
    this.#linter = options.linter;
  }

  connect(send: (message: ServerMessage) => void, options: ConnectOptions = {}): SyncConnection {
    const workspace = this.#workspace;
    const linter = this.#linter;
    const origin = options.origin ?? "user";
    let deckId: string | null = null;
    let closed = false;
    /** Stops following the open deck's lint. */
    let stopLint: (() => void) | undefined;
    const safeSend = (message: ServerMessage) => {
      if (!closed) send(message);
    };

    const unsubscribe = workspace.subscribe((event) => {
      if (event.type === "decks") {
        safeSend({ type: "decks", decks: event.decks, activeDeckId: event.activeDeckId });
      } else if (event.change.deckId === deckId) {
        const {
          deckId: id,
          version,
          origin: from,
          label,
          ops,
          at,
          reverts,
          restores,
        } = event.change;
        safeSend({
          type: "change",
          deckId: id,
          version,
          origin: from,
          label,
          ops,
          at,
          ...(reverts && { reverts }),
          ...(restores && { restores }),
        });
      }
    });

    safeSend({
      type: "welcome",
      protocol: SYNC_PROTOCOL_VERSION,
      decks: workspace.list(),
      activeDeckId: workspace.activeDeckId,
    });

    const respond = (requestId: string, result: TransactionResult | null, version: number) => {
      if (result === null) {
        safeSend({
          type: "result",
          requestId,
          ok: false,
          error: { code: "NOT_FOUND", message: "Nothing to undo or redo" },
        });
      } else if (result.ok) {
        safeSend({ type: "result", requestId, ok: true, version });
      } else {
        safeSend({ type: "result", requestId, ok: false, error: result.error });
      }
    };

    const handle = async (raw: string): Promise<void> => {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        safeSend({ type: "error", message: "Messages must be JSON" });
        return;
      }
      const parsed = ClientMessageSchema.safeParse(json);
      if (!parsed.success) {
        safeSend({
          type: "error",
          message: `Invalid message: ${formatIssues(parsed.error.issues)}`,
        });
        return;
      }
      const message = parsed.data;
      try {
        const deck = await workspace.get(message.deckId);
        if (closed) return;
        switch (message.type) {
          case "open":
            // Take the snapshot and start following in the same tick: no change can slip between.
            deckId = deck.id;
            workspace.setActive(deck.id);
            safeSend({
              type: "snapshot",
              deckId: deck.id,
              version: deck.version,
              deck: deck.deck,
              history: deck.history,
            });
            stopLint?.();
            stopLint = linter?.watch(deck, (report) =>
              safeSend({ type: "lint", deckId: deck.id, ...report }),
            );
            return;
          case "transaction": {
            const result = deck.apply({ origin, label: message.label, ops: message.ops });
            respond(message.requestId, result, deck.version);
            return;
          }
          case "revert": {
            const result = deck.revert(message.versions, origin);
            respond(message.requestId, result, deck.version);
            return;
          }
          case "undo":
          case "redo": {
            const result = message.type === "undo" ? deck.undo(origin) : deck.redo(origin);
            respond(message.requestId, result, deck.version);
            return;
          }
        }
      } catch (error) {
        const info: ErrorInfo =
          error instanceof VeloceError
            ? error.toJSON()
            : { code: "INVALID", message: String(error) };
        if ("requestId" in message)
          safeSend({ type: "result", requestId: message.requestId, ok: false, error: info });
        else safeSend({ type: "error", message: info.message });
      }
    };

    // Messages are handled strictly in arrival order, even though opening a deck is async.
    let queue = Promise.resolve();
    return {
      receive(raw) {
        queue = queue.then(() => handle(raw));
      },
      close() {
        closed = true;
        stopLint?.();
        unsubscribe();
      },
    };
  }
}
