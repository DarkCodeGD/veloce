/**
 * OpenDeck: one live document. Wraps core's `DeckDocument` (validation, per-origin undo) and
 * adds what a server needs: asset bytes, change notifications and a version number.
 */
import {
  type ApplyContext,
  type Deck,
  DeckDocument,
  type Op,
  type Origin,
  sha256Hex,
  type TransactionResult,
} from "@veloce/core";
import type { DeckBundle } from "@veloce/format";

export interface DeckChange {
  deckId: string;
  version: number;
  origin: Origin;
  label: string;
  ops: Op[];
  deck: Deck;
}

export interface OpenDeckOptions {
  deck: Deck;
  assets?: ReadonlyMap<string, Uint8Array>;
  /** Absolute path of the .veloce file backing this deck. */
  path: string;
  context?: ApplyContext;
  /** When the file was first created (kept in the manifest across saves). */
  createdAt?: Date;
}

export class OpenDeck {
  readonly id: string;
  readonly path: string;
  readonly createdAt: Date;
  readonly #doc: DeckDocument;
  /** Bytes of every asset seen this session, including removed ones (undo may bring them back). */
  readonly #assets: Map<string, Uint8Array>;
  readonly #listeners = new Set<(change: DeckChange) => void>();
  #modifiedAt = new Date();
  /** Who changed each slide last (this session only), so agents don't clobber human work. */
  readonly #slideEditors = new Map<string, Origin>();
  /** The deck as of the last emitted change, to find which slides a change touched. */
  #emitted: Deck;

  constructor(options: OpenDeckOptions) {
    this.id = options.deck.id;
    this.path = options.path;
    this.createdAt = options.createdAt ?? new Date();
    this.#doc = new DeckDocument(options.deck, options.context ? { context: options.context } : {});
    this.#assets = new Map(options.assets);
    this.#emitted = this.#doc.deck;
  }

  /** The origin that last changed this slide since the deck was opened (undefined: nobody). */
  lastEditor(slideId: string): Origin | undefined {
    return this.#slideEditors.get(slideId);
  }

  get deck(): Deck {
    return this.#doc.deck;
  }

  get version(): number {
    return this.#doc.version;
  }

  get modifiedAt(): Date {
    return this.#modifiedAt;
  }

  /** Apply a transaction (`{ origin, label, ops }`, validated here). */
  apply(input: unknown): TransactionResult {
    const missing = this.#missingAssetUpload(input);
    if (missing) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `asset.add: the bytes for asset ${missing} haven't been uploaded to this deck`,
          hint: "Upload the file first; its SHA-256 is the asset ID.",
        },
      };
    }
    return this.#emit(this.#doc.apply(input));
  }

  undo(origin: Origin): TransactionResult | null {
    const result = this.#doc.undo(origin);
    return result && this.#emit(result);
  }

  redo(origin: Origin): TransactionResult | null {
    const result = this.#doc.redo(origin);
    return result && this.#emit(result);
  }

  canUndo(origin: Origin): boolean {
    return this.#doc.canUndo(origin);
  }

  undoLabels(origin: Origin): string[] {
    return this.#doc.undoLabels(origin);
  }

  /** Store asset bytes (content-addressed). Returns the asset ID to use in an `asset.add` op. */
  async storeAsset(bytes: Uint8Array): Promise<string> {
    const id = await sha256Hex(bytes);
    if (!this.#assets.has(id)) this.#assets.set(id, bytes);
    return id;
  }

  assetBytes(id: string): Uint8Array | undefined {
    return this.#assets.get(id);
  }

  /** Everything needed to save the deck (only the assets it currently uses). */
  bundle(): DeckBundle {
    const deck = this.deck;
    const assets = new Map<string, Uint8Array>();
    for (const id of Object.keys(deck.assets)) {
      const bytes = this.#assets.get(id);
      if (bytes) assets.set(id, bytes);
    }
    return { deck, assets };
  }

  subscribe(listener: (change: DeckChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(result: TransactionResult): TransactionResult {
    if (!result.ok) return result;
    this.#modifiedAt = new Date();
    const { origin, label, ops } = result.transaction;
    // Structural sharing: a slide object is new exactly when this change touched it.
    const before = new Map(this.#emitted.slides.map((s) => [s.id, s]));
    for (const slide of result.deck.slides) {
      if (before.get(slide.id) !== slide) this.#slideEditors.set(slide.id, origin);
      before.delete(slide.id);
    }
    for (const removed of before.keys()) this.#slideEditors.delete(removed);
    this.#emitted = result.deck;
    const change: DeckChange = {
      deckId: this.id,
      version: this.version,
      origin,
      label,
      ops,
      deck: result.deck,
    };
    for (const listener of this.#listeners) listener(change);
    return result;
  }

  /** Cheap pre-check on raw input: `asset.add` needs the bytes on the server first. */
  #missingAssetUpload(input: unknown): string | null {
    const ops = (input as { ops?: unknown } | null)?.ops;
    if (!Array.isArray(ops)) return null;
    for (const op of ops) {
      const { op: kind, id } = (op ?? {}) as { op?: unknown; id?: unknown };
      if (kind === "asset.add" && typeof id === "string" && !this.#assets.has(id)) return id;
    }
    return null;
  }
}
