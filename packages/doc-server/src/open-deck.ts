/**
 * OpenDeck: one live document. Wraps core's `DeckDocument` (validation, per-origin undo) and
 * adds what a server needs: asset bytes, change notifications and a version number.
 */
import {
  type ApplyContext,
  type AssetInfo,
  type Deck,
  DeckDocument,
  type HistoryEntry,
  type Op,
  type Origin,
  sha256Hex,
  type TransactionResult,
} from "@veloce/core";
import type { DeckBundle } from "@veloce/format";
import { inspectAsset } from "./asset-import.js";

/** An imported file: its asset ID and what the server found it to be. */
export type ImportResult =
  | { ok: true; id: string; info: AssetInfo }
  | { ok: false; message: string };

export interface DeckChange {
  deckId: string;
  version: number;
  origin: Origin;
  label: string;
  ops: Op[];
  deck: Deck;
  /** Slides this change added or modified. */
  slideIds: string[];
  /** When it was applied (ms since the epoch). */
  at: number;
}

/** How many changes the history keeps per open deck (older ones drop off). */
export const HISTORY_LIMIT = 500;

/**
 * How long an upload waits for its `asset.add` before a sweep may drop it. The editor and
 * agents send the add right after the upload returns; this only has to outlast a slow
 * client, not a person deciding (D65).
 */
export const UPLOAD_GRACE_MS = 10 * 60_000;

export interface OpenDeckOptions {
  deck: Deck;
  assets?: ReadonlyMap<string, Uint8Array>;
  /** Absolute path of the .veloce file backing this deck. */
  path: string;
  context?: ApplyContext;
  /** When the file was first created (kept in the manifest across saves). */
  createdAt?: Date;
  /** The clock (ms since the epoch), for tests. */
  now?: () => number;
}

export class OpenDeck {
  readonly id: string;
  readonly path: string;
  readonly createdAt: Date;
  readonly #doc: DeckDocument;
  /** Bytes of every asset seen this session, including removed ones (undo may bring them back). */
  readonly #assets: Map<string, Uint8Array>;
  /** What `importAsset` found each file to be: `asset.add` must agree (the server decides). */
  readonly #inspected = new Map<string, AssetInfo>();
  /** When each asset's bytes last arrived (upload or store), for the sweep's grace period. */
  readonly #arrived = new Map<string, number>();
  readonly #now: () => number;
  readonly #listeners = new Set<(change: DeckChange) => void>();
  #modifiedAt = new Date();
  /** Who changed each slide last (this session only), so agents don't clobber human work. */
  readonly #slideEditors = new Map<string, Origin>();
  /** The deck as of the last emitted change, to find which slides a change touched. */
  #emitted: Deck;
  /** Recent changes for the history panel, oldest first (this session only, not saved). */
  readonly #history: HistoryEntry[] = [];

  constructor(options: OpenDeckOptions) {
    this.id = options.deck.id;
    this.path = options.path;
    this.createdAt = options.createdAt ?? new Date();
    this.#doc = new DeckDocument(options.deck, options.context ? { context: options.context } : {});
    this.#assets = new Map(options.assets);
    this.#now = options.now ?? Date.now;
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
    const refused = this.#checkAssetAdds(input);
    if (refused) return { ok: false, error: refused };
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

  /** Recent changes, oldest first (at most HISTORY_LIMIT, since the deck was opened). */
  get history(): HistoryEntry[] {
    return [...this.#history];
  }

  canUndo(origin: Origin): boolean {
    return this.#doc.canUndo(origin);
  }

  undoLabels(origin: Origin): string[] {
    return this.#doc.undoLabels(origin);
  }

  /**
   * Import a file (an upload from the editor, or an agent's `add_asset`): the server works
   * out what it is from the bytes, stores them (content-addressed) and returns the ID and info
   * to put in an `asset.add` op. Nothing changes in the document until that op is applied.
   */
  async importAsset(bytes: Uint8Array, fileName?: string): Promise<ImportResult> {
    const inspected = inspectAsset(bytes, fileName);
    if (!inspected.ok) return inspected;
    const id = await this.storeAsset(bytes);
    this.#inspected.set(id, inspected.info);
    return { ok: true, id, info: inspected.info };
  }

  /** Store trusted asset bytes as they are (content-addressed); returns the asset ID. */
  async storeAsset(bytes: Uint8Array): Promise<string> {
    const id = await sha256Hex(bytes);
    if (!this.#assets.has(id)) this.#assets.set(id, bytes);
    // Restart the grace period even for known bytes: an orphan uploaded again is about to be
    // added, and must not be swept in between.
    this.#arrived.set(id, this.#now());
    return id;
  }

  /**
   * Drop asset bytes nothing can use any more (D65): not in the deck, not restorable by any
   * origin's undo or redo, and not a recent upload still waiting for its `asset.add`. That's
   * a cancelled drop, a failed paste, an agent's upload it never added, or an asset removed
   * so long ago its undo step has fallen off the history. Saving never writes these (see
   * `bundle`); this frees the memory they'd hold for the rest of the session. Returns the
   * IDs dropped.
   */
  sweepAssets(): string[] {
    const keep = this.#doc.restorableAssetIds();
    for (const id of Object.keys(this.deck.assets)) keep.add(id);
    const cutoff = this.#now() - UPLOAD_GRACE_MS;
    const dropped: string[] = [];
    for (const id of this.#assets.keys()) {
      if (keep.has(id) || (this.#arrived.get(id) ?? Number.NEGATIVE_INFINITY) > cutoff) continue;
      this.#assets.delete(id);
      this.#inspected.delete(id);
      this.#arrived.delete(id);
      dropped.push(id);
    }
    return dropped;
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
    const slideIds: string[] = [];
    for (const slide of result.deck.slides) {
      if (before.get(slide.id) !== slide) {
        this.#slideEditors.set(slide.id, origin);
        slideIds.push(slide.id);
      }
      before.delete(slide.id);
    }
    for (const removed of before.keys()) this.#slideEditors.delete(removed);
    this.#emitted = result.deck;
    const at = this.#modifiedAt.getTime();
    this.#history.push({ version: this.version, origin, label, slideIds, at });
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
    const change: DeckChange = {
      deckId: this.id,
      version: this.version,
      origin,
      label,
      ops,
      deck: result.deck,
      slideIds,
      at,
    };
    for (const listener of this.#listeners) listener(change);
    return result;
  }

  /**
   * Cheap pre-check on raw input: `asset.add` needs the bytes on the server first, and for an
   * imported file, its type and size must be what the server found (a client can't register
   * a PNG as a font, or an SVG as a PNG).
   */
  #checkAssetAdds(input: unknown) {
    const ops = (input as { ops?: unknown } | null)?.ops;
    if (!Array.isArray(ops)) return null;
    for (const op of ops) {
      const { op: kind, id, asset } = (op ?? {}) as { op?: unknown; id?: unknown; asset?: unknown };
      if (kind !== "asset.add" || typeof id !== "string") continue;
      if (!this.#assets.has(id)) {
        return {
          code: "NOT_FOUND" as const,
          message: `asset.add: the bytes for asset ${id} haven't been uploaded to this deck`,
          hint: "Upload the file first; its SHA-256 is the asset ID. Uploads not added within 10 minutes are cleaned up, so upload it again.",
        };
      }
      const known = this.#inspected.get(id);
      const claimed = (asset ?? {}) as Partial<AssetInfo>;
      if (known && (claimed.mime !== known.mime || claimed.bytes !== known.bytes)) {
        return {
          code: "INVALID" as const,
          message: `asset.add: asset ${id} is ${known.mime} (${known.bytes} bytes), not ${String(claimed.mime)} (${String(claimed.bytes)} bytes)`,
          hint: "Use the asset info the upload returned.",
        };
      }
    }
    return null;
  }
}
