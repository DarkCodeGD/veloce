/**
 * DeckDocument: a deck plus its edit history. Pure in-memory state; the doc-server adds
 * persistence, sync and versioned broadcast on top of it.
 *
 * Undo is per origin. Each participant (the user, each agent) has its own undo/redo stacks,
 * and undoing applies that participant's inverse ops as a new change on top of the current
 * deck. If someone else has since changed things so the inverse no longer applies (say the
 * agent deleted the node the user edited), the undo fails cleanly with a readable reason and
 * the entry is dropped. Inverse updates only touch the fields that change set, so other
 * participants' edits to other fields survive an undo.
 */
import type { ApplyContext } from "./checks.js";
import type { Op } from "./ops/schema.js";
import type { Deck } from "./schema/deck.js";
import { applyTransaction, type Origin, type TransactionResult } from "./transaction.js";

interface HistoryEntry {
  label: string;
  /** Ops that perform this entry's undo (on the undo stack) or redo (on the redo stack). */
  ops: Op[];
  /** ID of the transaction these ops take back (reported as `reverses` when they run). */
  reverses: string;
}

interface Stacks {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export interface DeckDocumentOptions {
  context?: ApplyContext;
  /**
   * Max undo steps kept per origin (oldest are dropped). Default 200. Bounds memory. A
   * function is read at each step, so a changed setting (D91) applies from the next one.
   */
  historyLimit?: number | (() => number);
}

export class DeckDocument {
  #deck: Deck;
  #version = 0;
  readonly #stacks = new Map<Origin, Stacks>();
  readonly #context: ApplyContext;
  readonly #historyLimit: () => number;

  /** `deck` must already be valid (from a builder, `validateDeck`, or `@veloce/format`). */
  constructor(deck: Deck, options: DeckDocumentOptions = {}) {
    this.#deck = deck;
    this.#context = options.context ?? {};
    const limit = options.historyLimit ?? 200;
    this.#historyLimit = typeof limit === "function" ? limit : () => limit;
  }

  get deck(): Deck {
    return this.#deck;
  }

  /** Increments on every successful change (including undo/redo). */
  get version(): number {
    return this.#version;
  }

  /** Apply a transaction. On success, it becomes one undo step for its origin. */
  apply(input: unknown, options: { recordHistory?: boolean } = {}): TransactionResult {
    const result = applyTransaction(this.#deck, input, this.#context);
    if (!result.ok) return result;
    this.#commit(result.deck);
    if (options.recordHistory !== false) {
      const stacks = this.#stacksFor(result.transaction.origin);
      this.#push(stacks.undo, {
        label: result.transaction.label,
        ops: result.inverse,
        reverses: result.transaction.id,
      });
      stacks.redo.length = 0; // a new change invalidates that origin's redo history
    }
    return result;
  }

  canUndo(origin: Origin): boolean {
    return (this.#stacks.get(origin)?.undo.length ?? 0) > 0;
  }

  canRedo(origin: Origin): boolean {
    return (this.#stacks.get(origin)?.redo.length ?? 0) > 0;
  }

  /**
   * Asset IDs some undo or redo step (any origin's) would add back: an undone `asset.remove`,
   * a redone `asset.add`. Their bytes must outlive their removal from the deck. An asset can
   * only come back through `asset.add` (node references must point at deck assets), so this
   * plus the deck's own assets is everything still needed.
   */
  restorableAssetIds(): Set<string> {
    const ids = new Set<string>();
    for (const { undo, redo } of this.#stacks.values()) {
      for (const entry of undo)
        for (const op of entry.ops) if (op.op === "asset.add") ids.add(op.id);
      for (const entry of redo)
        for (const op of entry.ops) if (op.op === "asset.add") ids.add(op.id);
    }
    return ids;
  }

  /** Labels of the undoable steps for `origin`, most recent last. */
  undoLabels(origin: Origin): string[] {
    return this.#stacks.get(origin)?.undo.map((e) => e.label) ?? [];
  }

  /** Undo `origin`'s last change. `null` when there's nothing to undo. */
  undo(origin: Origin): TransactionResult | null {
    return this.#travel(origin, "undo", "redo", "Undo");
  }

  /** Redo `origin`'s last undone change. `null` when there's nothing to redo. */
  redo(origin: Origin): TransactionResult | null {
    return this.#travel(origin, "redo", "undo", "Redo");
  }

  #travel(
    origin: Origin,
    from: keyof Stacks,
    to: keyof Stacks,
    verb: string,
  ): TransactionResult | null {
    const stacks = this.#stacks.get(origin);
    const entry = stacks?.[from].pop();
    if (!stacks || !entry) return null;
    const result = applyTransaction(
      this.#deck,
      { origin, label: `${verb}: ${entry.label}`, ops: entry.ops },
      this.#context,
    );
    if (!result.ok) {
      // The deck moved on in a way that conflicts with this step; it can't be replayed.
      return {
        ok: false,
        error: {
          ...result.error,
          message: `Can't ${verb.toLowerCase()} "${entry.label}": ${result.error.message}`,
          hint: "Someone else changed the same content since then, so this step was dropped.",
        },
      };
    }
    this.#commit(result.deck);
    // The inverse of an undo is exactly its redo (and vice versa), computed against the current deck.
    this.#push(stacks[to], {
      label: entry.label,
      ops: result.inverse,
      reverses: result.transaction.id,
    });
    return { ...result, reverses: entry.reverses };
  }

  #commit(deck: Deck): void {
    this.#deck = deck;
    this.#version++;
  }

  #stacksFor(origin: Origin): Stacks {
    let stacks = this.#stacks.get(origin);
    if (!stacks) {
      stacks = { undo: [], redo: [] };
      this.#stacks.set(origin, stacks);
    }
    return stacks;
  }

  #push(stack: HistoryEntry[], entry: HistoryEntry): void {
    stack.push(entry);
    const limit = Math.max(1, this.#historyLimit());
    if (stack.length > limit) stack.splice(0, stack.length - limit);
  }
}
