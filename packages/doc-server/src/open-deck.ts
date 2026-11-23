/**
 * OpenDeck: one live document. Wraps core's `DeckDocument` (validation, per-origin undo) and
 * adds what a server needs: asset bytes, change notifications and a version number.
 */
import {
  type ApplyContext,
  type AssetInfo,
  type Deck,
  DeckDocument,
  type DeckVersion,
  type HistoryEntry,
  isAgentOrigin,
  MAX_VERSIONS,
  type Node,
  newVersionId,
  type Op,
  type Origin,
  type RevertMarks,
  restoreOps,
  type Slide,
  sha256Hex,
  TextContentSchema,
  type TransactionResult,
  toPlainText,
  VeloceError,
  type VersionInfo,
  VersionNameSchema,
  versionInfo,
  walkNodes,
} from "@veloce/core";
import type { DeckBundle } from "@veloce/format";
import {
  MAX_EDGE,
  type Method,
  MIN_BYTES,
  type OptimizeResult,
  optimizeInWorker,
} from "@veloce/images";
import { inspectAsset } from "./asset-import.js";

/** How an image was made smaller on import (D67). */
export interface Optimization {
  /** The file as it arrived: still stored, so the user can keep it instead (D65 grace). */
  original: { id: string; info: AssetInfo };
  method: Method;
  /** The quality the search settled on (lossy WebP). */
  quality?: number;
  /** True if it was scaled down to MAX_EDGE on its long side. */
  resized: boolean;
}

/** An imported file: its asset ID and what the server found it to be. */
export type ImportResult =
  | { ok: true; id: string; info: AssetInfo; optimization?: Optimization }
  | { ok: false; message: string };

export interface ImportOptions {
  /** Optimize an image (D67). Default: the deck's `optimizeImages` setting (on). */
  optimize?: boolean;
}

/** Optimizes one image file; never throws (`optimizeInWorker` by default). */
export type ImageOptimizer = (
  bytes: Uint8Array,
  size: { width?: number; height?: number },
) => Promise<OptimizeResult>;

const OPTIMIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Worth sending to the optimizer: a photo format, and big in bytes or in pixels. */
function worthOptimizing(info: AssetInfo): boolean {
  if (!OPTIMIZABLE.has(info.mime)) return false;
  const oversized = Math.max(info.width ?? 0, info.height ?? 0) > MAX_EDGE;
  return oversized || info.bytes >= MIN_BYTES;
}

/** "photo.jpg" → "photo.webp" (the name follows the format). */
function renamed(name: string | undefined, extension: string): string | undefined {
  if (!name) return undefined;
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}

export interface DeckChange extends RevertMarks {
  deckId: string;
  version: number;
  origin: Origin;
  label: string;
  ops: Op[];
  deck: Deck;
  /** Slides this change added or modified. */
  slideIds: string[];
  /** Slides this change removed. */
  removedSlideIds: string[];
  /** When it was applied (ms since the epoch). */
  at: number;
}

/** A history entry plus the ops that take it back (server-side only: never sent). */
interface Recorded extends HistoryEntry {
  inverse: Op[];
}

/** Who removed a node, and where it was (for errors on IDs that are gone). */
export interface NodeRemoval {
  origin: Origin;
  slideId: string;
  /** Its whole slide went (not just the node). */
  withSlide: boolean;
  /** Its name or a text snippet, so an agent recognises it. */
  label?: string;
}

/** Removed nodes remembered (oldest forgotten first): bounds memory in long sessions. */
const MAX_REMOVED_NODES = 10_000;

/** A node's name, or a snippet of its text. */
function nodeSnippet(node: Node): string | undefined {
  if (node.name) return node.name;
  if (node.kind !== "element") return undefined;
  const content = TextContentSchema.safeParse(node.props.content);
  if (!content.success) return undefined;
  const text = toPlainText(content.data).replace(/\s+/g, " ").trim();
  return text ? (text.length > 40 ? `${text.slice(0, 39)}…` : text) : undefined;
}

const nodesOf = (slide: Slide) =>
  new Map([...walkNodes(slide.root)].map(({ node }) => [node.id, node]));

/** Revert labels stay readable in the history panel (transaction labels max out at 200). */
const MAX_LABEL = 120;
const clip = (label: string) =>
  label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;

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
  /** Optimize imported images (D67). Default true. */
  optimizeImages?: boolean;
  /** What optimizes them (tests swap it). Default: a worker thread. */
  optimizer?: ImageOptimizer;
  /** Undo steps kept per origin; a function follows a changed setting (D91). Default 200. */
  historyLimit?: number | (() => number);
  /** Versions saved in the file (D93), oldest first. Their assets must be in `assets`. */
  versions?: readonly DeckVersion[];
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
  readonly #optimizeImages: boolean;
  readonly #optimizer: ImageOptimizer;
  /**
   * What each uploaded original became (null: kept as it was), so the same file dropped
   * twice isn't optimized twice. Entries go when the sweep drops either file.
   */
  readonly #optimized = new Map<string, Extract<ImportResult, { ok: true }> | null>();
  readonly #listeners = new Set<(change: DeckChange) => void>();
  #modifiedAt = new Date();
  /** Who changed each slide last (this session only), so agents don't clobber human work. */
  readonly #slideEditors = new Map<string, Origin>();
  /** Who removed each slide that's gone (this session only), so agents don't bring it back. */
  readonly #slideRemovers = new Map<string, Origin>();
  /** Who removed each node that's gone (this session only), so agents hear why an ID failed. */
  readonly #nodeRemovers = new Map<string, NodeRemoval>();
  /**
   * Revert transactions, and the undos and redos that follow them, by transaction ID: which
   * changes they touch, and whether they revert them (true) or bring them back (false).
   * An undo of a revert reports the revert's ID as `reverses`, which is how it's found here.
   */
  readonly #reverts = new Map<string, { versions: number[]; reverting: boolean }>();
  /** The deck as of the last emitted change, to find which slides a change touched. */
  #emitted: Deck;
  /** Recent changes for the history panel, oldest first (this session only, not saved). */
  readonly #history: Recorded[] = [];
  /**
   * Saved versions (D93), oldest first. Each holds the deck object as it was: decks are
   * immutable and share untouched slides, so a version costs only what changed since.
   */
  readonly #versions: DeckVersion[];

  constructor(options: OpenDeckOptions) {
    this.id = options.deck.id;
    this.path = options.path;
    this.createdAt = options.createdAt ?? new Date();
    this.#doc = new DeckDocument(options.deck, {
      ...(options.context && { context: options.context }),
      ...(options.historyLimit !== undefined && { historyLimit: options.historyLimit }),
    });
    this.#assets = new Map(options.assets);
    this.#now = options.now ?? Date.now;
    this.#optimizeImages = options.optimizeImages ?? true;
    this.#optimizer = options.optimizer ?? optimizeInWorker;
    this.#emitted = this.#doc.deck;
    this.#versions = [...(options.versions ?? [])];
  }

  // ── Versions (D93) ──

  /** The saved versions, newest first. */
  savedVersions(): VersionInfo[] {
    return this.#versions.map(versionInfo).reverse();
  }

  savedVersion(id: string): DeckVersion | undefined {
    return this.#versions.find((v) => v.id === id);
  }

  /**
   * Saves the deck as it is now under a name. Not an op: nothing on the slides changes, so
   * there's nothing to undo (Delete version takes it away).
   */
  saveVersion(name: string): VersionInfo {
    const parsed = VersionNameSchema.safeParse(name);
    if (!parsed.success) {
      throw new VeloceError("INVALID", "A version needs a name of 1 to 100 characters");
    }
    if (this.#versions.length >= MAX_VERSIONS) {
      throw new VeloceError("CONFLICT", `This deck already has ${MAX_VERSIONS} versions`, {
        hint: "Delete an old version first (File → Versions).",
      });
    }
    const version: DeckVersion = {
      id: newVersionId(),
      name: parsed.data,
      savedAt: new Date(this.#now()).toISOString(),
      deck: this.deck,
    };
    this.#versions.push(version);
    return versionInfo(version);
  }

  deleteVersion(id: string): void {
    const at = this.#versions.findIndex((v) => v.id === id);
    if (at < 0) throw this.#noVersion(id);
    this.#versions.splice(at, 1);
  }

  /**
   * Turns the deck back into a saved version, as one change by `origin`: its undo brings
   * back what was there. The version itself stays.
   */
  restoreVersion(id: string, origin: Origin): TransactionResult {
    const version = this.savedVersion(id);
    if (!version) throw this.#noVersion(id);
    const ops = restoreOps(this.deck, version.deck);
    if (ops.length === 0) {
      return {
        ok: false,
        error: { code: "CONFLICT", message: `The deck already matches "${version.name}"` },
      };
    }
    return this.apply({ origin, label: clip(`Restore "${version.name}"`), ops });
  }

  #noVersion(id: string): VeloceError {
    return new VeloceError("NOT_FOUND", `No version ${id} in this deck`, {
      hint: "It may have been deleted in another tab. Open File → Versions again.",
    });
  }

  /** The origin that last changed this slide since the deck was opened (undefined: nobody). */
  lastEditor(slideId: string): Origin | undefined {
    return this.#slideEditors.get(slideId);
  }

  /** Who removed this slide since the deck was opened (undefined: it's there, or never was). */
  removedBy(slideId: string): Origin | undefined {
    return this.#slideRemovers.get(slideId);
  }

  /** Who removed this node since the deck was opened, and from where (undefined: not removed). */
  removedNode(nodeId: string): NodeRemoval | undefined {
    return this.#nodeRemovers.get(nodeId);
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
    return this.#history.map(({ inverse: _, ...entry }) => entry);
  }

  /**
   * Take back agents' changes (by history version) as one change by `origin`, so its undo
   * brings them back (golden rule #7: undo stays per origin; the revert is the user's own
   * step). The changes' stored inverses run newest first against the deck as it is now, so
   * later edits to other fields survive, like any undo. Fails without changing anything
   * when a change is too old, isn't an agent's, is already reverted, or can't be taken back
   * because the deck moved on (its slide was deleted, say).
   */
  revert(versions: readonly number[], origin: Origin): TransactionResult {
    const fail = (
      code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT",
      message: string,
      hint?: string,
    ): TransactionResult => ({ ok: false, error: { code, message, ...(hint && { hint }) } });
    const wanted = [...new Set(versions)].sort((a, b) => b - a); // newest first
    const byVersion = new Map(this.#history.map((r) => [r.version, r]));
    const records: Recorded[] = [];
    for (const version of wanted) {
      const record = byVersion.get(version);
      if (!record) {
        return fail(
          "NOT_FOUND",
          `Change ${version} is too old to revert`,
          `Only the last ${HISTORY_LIMIT} changes since the deck was opened can be reverted.`,
        );
      }
      if (!isAgentOrigin(record.origin)) {
        return fail(
          "FORBIDDEN",
          `"${record.label}" isn't an AI change`,
          "Undo your own changes with Ctrl+Z.",
        );
      }
      if (record.reverted) return fail("CONFLICT", `"${record.label}" is already reverted`);
      records.push(record);
    }
    const first = records[0];
    if (!first) return fail("NOT_FOUND", "Nothing to revert");
    const label =
      records.length === 1
        ? clip(`Revert "${first.label}"`)
        : `Revert ${records.length} AI changes`;
    const result = this.#doc.apply({ origin, label, ops: records.flatMap((r) => r.inverse) });
    if (!result.ok) {
      return {
        ok: false,
        error: {
          ...result.error,
          message: `Can't revert: ${result.error.message}`,
          hint: "The deck changed since (its slide or element was deleted, say), so it can't be taken back automatically. Edit it by hand instead.",
        },
      };
    }
    this.#reverts.set(result.transaction.id, { versions: wanted, reverting: true });
    return this.#emit(result);
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
   *
   * Big photos are optimized first (D67, in a worker thread: seconds of CPU never block
   * the server). The result is what's returned to add; the original is stored too, under
   * `optimization.original`, so the user can keep it instead. Whichever isn't added is
   * swept after the grace period, like any unused upload (D65).
   */
  async importAsset(
    bytes: Uint8Array,
    fileName?: string,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const inspected = inspectAsset(bytes, fileName);
    if (!inspected.ok) return inspected;
    const id = await this.storeAsset(bytes);
    this.#inspected.set(id, inspected.info);
    const plain = { ok: true as const, id, info: inspected.info };
    if (!(options.optimize ?? this.#optimizeImages) || !worthOptimizing(inspected.info)) {
      return plain;
    }

    const known = this.#optimized.get(id);
    if (known === null) return plain;
    if (known && this.#assets.has(known.id)) {
      await this.storeAsset(this.#assets.get(known.id) as Uint8Array); // restart its grace
      return known;
    }
    const { width, height } = inspected.info;
    const result = await this.#optimizer(bytes, {
      ...(width && { width }),
      ...(height && { height }),
    });
    if (!("optimized" in result)) {
      this.#optimized.set(id, null);
      return plain;
    }
    const o = result.optimized;
    const checked = inspectAsset(o.bytes, renamed(inspected.info.name, "webp"));
    if (!checked.ok) return plain; // never happens: our own WebP
    const optimizedId = await this.storeAsset(o.bytes);
    this.#inspected.set(optimizedId, checked.info);
    const imported = {
      ok: true as const,
      id: optimizedId,
      info: checked.info,
      optimization: {
        original: { id, info: inspected.info },
        method: o.method,
        ...(o.quality !== undefined && { quality: o.quality }),
        resized: o.resizedFrom !== undefined,
      },
    };
    this.#optimized.set(id, imported);
    return imported;
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
    // A restore adds back what a version used (D93).
    for (const { deck } of this.#versions) for (const id of Object.keys(deck.assets)) keep.add(id);
    // A revert may add back what a recent change removed.
    for (const { inverse } of this.#history) {
      for (const op of inverse) if (op.op === "asset.add") keep.add(op.id);
    }
    const cutoff = this.#now() - UPLOAD_GRACE_MS;
    const dropped: string[] = [];
    for (const id of this.#assets.keys()) {
      if (keep.has(id) || (this.#arrived.get(id) ?? Number.NEGATIVE_INFINITY) > cutoff) continue;
      this.#assets.delete(id);
      this.#inspected.delete(id);
      this.#arrived.delete(id);
      dropped.push(id);
    }
    if (dropped.length > 0) {
      const gone = new Set(dropped);
      for (const [originalId, result] of this.#optimized) {
        if (gone.has(originalId) || (result && gone.has(result.id))) {
          this.#optimized.delete(originalId);
        }
      }
    }
    return dropped;
  }

  assetBytes(id: string): Uint8Array | undefined {
    return this.#assets.get(id);
  }

  /**
   * What an asset is, if the deck or one of its versions registers it: a version's images
   * are served too, so it can be looked at (D93).
   */
  assetInfo(id: string): AssetInfo | undefined {
    if (Object.hasOwn(this.deck.assets, id)) return this.deck.assets[id];
    for (const { deck } of this.#versions) {
      if (Object.hasOwn(deck.assets, id)) return deck.assets[id];
    }
    return undefined;
  }

  /** Everything needed to save the deck: its versions, and only the assets these use. */
  bundle(): DeckBundle {
    const deck = this.deck;
    const assets = new Map<string, Uint8Array>();
    for (const d of [deck, ...this.#versions.map((v) => v.deck)]) {
      for (const id of Object.keys(d.assets)) {
        const bytes = this.#assets.get(id);
        if (bytes) assets.set(id, bytes);
      }
    }
    return { deck, assets, versions: [...this.#versions] };
  }

  subscribe(listener: (change: DeckChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(result: TransactionResult): TransactionResult {
    if (!result.ok) return result;
    this.#modifiedAt = new Date();
    const { id, origin, label, ops } = result.transaction;
    // Structural sharing: a slide object is new exactly when this change touched it.
    const before = new Map(this.#emitted.slides.map((s) => [s.id, s]));
    const slideIds: string[] = [];
    for (const slide of result.deck.slides) {
      if (before.get(slide.id) !== slide) {
        this.#slideEditors.set(slide.id, origin);
        this.#slideRemovers.delete(slide.id);
        slideIds.push(slide.id);
      }
      before.delete(slide.id);
    }
    const removedSlideIds = [...before.keys()];
    for (const removed of removedSlideIds) {
      this.#slideEditors.delete(removed);
      this.#slideRemovers.set(removed, origin);
    }
    const removedNodeIds = this.#trackNodes(result.deck, slideIds, removedSlideIds, origin);
    this.#emitted = result.deck;
    const marks = this.#revertMarks(id, result.reverses);
    const at = this.#modifiedAt.getTime();
    this.#history.push({
      version: this.version,
      origin,
      label,
      slideIds,
      ...(removedSlideIds.length && { removedSlideIds }),
      ...(removedNodeIds.length && { removedNodeIds }),
      at,
      ...marks,
      inverse: result.inverse,
    });
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
    const change: DeckChange = {
      deckId: this.id,
      version: this.version,
      origin,
      label,
      ops,
      deck: result.deck,
      slideIds,
      removedSlideIds,
      at,
      ...marks,
    };
    for (const listener of this.#listeners) listener(change);
    return result;
  }

  /**
   * Note the nodes that left the touched slides (and who removed them), and forget removals
   * that came back. Only touched slides are walked: untouched ones are the same objects.
   * Returns the removed nodes on slides that are still there (a removed slide says the rest).
   */
  #trackNodes(deck: Deck, touched: string[], removedSlides: string[], origin: Origin): string[] {
    const old = new Map(this.#emitted.slides.map((s) => [s.id, s]));
    const now = new Map(deck.slides.map((s) => [s.id, s]));
    // Everything on the touched slides now, first: a node moved between two of them isn't gone.
    const present = new Set<string>();
    for (const slideId of touched) {
      const slide = now.get(slideId);
      if (slide) for (const id of nodesOf(slide).keys()) present.add(id);
    }
    for (const id of present) this.#nodeRemovers.delete(id);
    const removed: string[] = [];
    for (const slideId of [...touched, ...removedSlides]) {
      const before = old.get(slideId);
      if (!before) continue;
      const withSlide = !now.has(slideId);
      for (const [id, node] of nodesOf(before)) {
        if (present.has(id)) continue;
        const label = nodeSnippet(node);
        this.#nodeRemovers.delete(id); // re-insert: newest last, so the oldest go first
        this.#nodeRemovers.set(id, { origin, slideId, withSlide, ...(label && { label }) });
        if (!withSlide) removed.push(id);
      }
    }
    while (this.#nodeRemovers.size > MAX_REMOVED_NODES) {
      const oldest = this.#nodeRemovers.keys().next().value as string;
      this.#nodeRemovers.delete(oldest);
    }
    return removed;
  }

  /**
   * Which earlier changes transaction `id` reverts or brings back, marking them in the
   * history. A revert is registered (by `revert`) before it's emitted; an undo or redo of
   * one says so through `reverses` and flips it.
   */
  #revertMarks(id: string, reverses: string | undefined): RevertMarks {
    let entry = this.#reverts.get(id);
    const flipped = reverses === undefined ? undefined : this.#reverts.get(reverses);
    if (!entry && flipped && reverses !== undefined) {
      this.#reverts.delete(reverses); // its stack entry was used up; this one takes over
      entry = { versions: flipped.versions, reverting: !flipped.reverting };
      this.#reverts.set(id, entry);
    }
    if (!entry) return {};
    const versions = new Set(entry.versions);
    for (const record of this.#history) {
      if (versions.has(record.version)) record.reverted = entry.reverting;
    }
    return entry.reverting ? { reverts: entry.versions } : { restores: entry.versions };
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
