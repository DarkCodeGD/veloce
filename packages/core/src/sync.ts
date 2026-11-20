/**
 * The sync protocol between the doc-server and its clients (editor tabs, the render worker).
 *
 * The server owns every document (golden rule #2). Clients subscribe to a deck, receive a
 * snapshot, then receive each committed change as the ops that produced it, tagged with a
 * version. Applying those ops with core's pure `applyTransaction` reproduces the server's deck
 * exactly, and untouched slides keep their object identity, so renderers can skip them.
 * If a client ever sees a version gap, it asks for a fresh snapshot.
 *
 * Clients never choose their origin: the server stamps it (`user` for editor tabs), so a
 * browser tab can't pose as an agent (or vice versa) in the per-origin undo history.
 */
import { z } from "zod";
import type { ErrorInfo } from "./errors.js";
import type { LintIssue } from "./lint.js";
import type { Op } from "./ops/schema.js";
import { OpSchema } from "./ops/schema.js";
import type { Deck } from "./schema/deck.js";
import { IdSchema } from "./schema/primitives.js";
import { applyTransaction, type Origin } from "./transaction.js";

export const SYNC_PROTOCOL_VERSION = 1;

/** A deck the server knows about (open or on disk). */
export interface DeckListing {
  id: string;
  title: string;
  slideCount: number;
  /** File name inside the workspace, e.g. `"pitch-deck.veloce"`. */
  file?: string;
  /** ISO timestamp of the last change. */
  modifiedAt?: string;
}

// ── Client → server (validated: the server never trusts client input) ─────────────────────

const RequestIdSchema = z.string().min(1).max(64);

export const ClientMessageSchema = z.discriminatedUnion("type", [
  /** Subscribe to a deck (and make it the active deck). The server replies with a snapshot. */
  z.strictObject({ type: z.literal("open"), deckId: IdSchema }),
  /** Propose a change. The server assigns the origin and replies with a `result`. */
  z.strictObject({
    type: z.literal("transaction"),
    requestId: RequestIdSchema,
    deckId: IdSchema,
    label: z.string().min(1).max(200),
    ops: z.array(OpSchema).min(1).max(10_000),
  }),
  z.strictObject({ type: z.literal("undo"), requestId: RequestIdSchema, deckId: IdSchema }),
  z.strictObject({ type: z.literal("redo"), requestId: RequestIdSchema, deckId: IdSchema }),
  /**
   * Take back agents' changes (by history version) as one change of the client's own, so
   * the client's undo brings them back. Only agents' changes: your own go through undo.
   */
  z.strictObject({
    type: z.literal("revert"),
    requestId: RequestIdSchema,
    deckId: IdSchema,
    versions: z.array(z.number().int().min(1)).min(1).max(500),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ── Server → client ───────────────────────────────────────────────────────────────────

export type ServerMessage =
  | {
      type: "welcome";
      protocol: typeof SYNC_PROTOCOL_VERSION;
      decks: DeckListing[];
      /** The deck the user/agent is working on (the editor shows it). */
      activeDeckId: string | null;
    }
  /** The deck list or the active deck changed (e.g. an agent created or opened a deck). */
  | { type: "decks"; decks: DeckListing[]; activeDeckId: string | null }
  | {
      type: "snapshot";
      deckId: string;
      version: number;
      deck: Deck;
      /** Recent changes, oldest first (this server session only), for the history panel. */
      history: HistoryEntry[];
    }
  | ({
      type: "change";
      deckId: string;
      version: number;
      origin: Origin;
      label: string;
      ops: Op[];
      /** When the server applied it (ms since the epoch). */
      at: number;
    } & RevertMarks)
  /**
   * The open deck's lint (D73): the issues agents get, re-checked shortly after each change.
   * `version` is the deck version it describes (older than the replica's while re-checking).
   */
  | ({ type: "lint"; deckId: string } & LintReport)
  | { type: "result"; requestId: string; ok: true; version: number }
  | { type: "result"; requestId: string; ok: false; error: ErrorInfo }
  /** A protocol-level problem (malformed message, unknown deck). */
  | { type: "error"; message: string };

export type ChangeMessage = Extract<ServerMessage, { type: "change" }>;

/** A deck's lint at one version. */
export interface LintReport {
  version: number;
  issues: LintIssue[];
  /** `true` when visual checks (overflow, contrast, overlaps…) ran; otherwise why not. */
  visual: true | string;
}

/** What a change did to earlier changes, through a revert (or undoing / redoing one). */
export interface RevertMarks {
  /** Versions of the changes this one reverted (they no longer show in the deck). */
  reverts?: number[];
  /** Versions of reverted changes this one brought back (the revert was undone). */
  restores?: number[];
}

/** One committed change, as the history panel lists it. */
export interface HistoryEntry extends RevertMarks {
  version: number;
  origin: Origin;
  label: string;
  /** Slides this change added or modified (removed slides aren't listed). */
  slideIds: string[];
  /** Slides this change removed. */
  removedSlideIds?: string[];
  /** Nodes this change removed from slides that are still there (server-side only). */
  removedNodeIds?: string[];
  /** When the server applied it (ms since the epoch). */
  at: number;
  /** A later change reverted this one (and that revert hasn't been undone). */
  reverted?: boolean;
}

/**
 * History after `entry` arrived: `entry` added at the end, and the changes it reverts or
 * restores marked. Keeps at most `limit` entries (the oldest drop off). Pure.
 */
export function appendHistory(
  history: readonly HistoryEntry[],
  entry: HistoryEntry,
  limit: number,
): HistoryEntry[] {
  const reverts = new Set(entry.reverts);
  const restores = new Set(entry.restores);
  const marked =
    reverts.size || restores.size
      ? history.map((e) =>
          reverts.has(e.version)
            ? { ...e, reverted: true }
            : restores.has(e.version)
              ? { ...e, reverted: false }
              : e,
        )
      : [...history];
  marked.push(entry);
  return marked.slice(-limit);
}

export interface LocalReplica {
  deck: Deck;
  version: number;
}

/**
 * Apply a server `change` to a client's copy. Returns the new replica, or `null` if the change
 * doesn't follow on from the local version (or fails to apply), meaning: request a snapshot.
 */
export function applyChange(local: LocalReplica, change: ChangeMessage): LocalReplica | null {
  if (change.version !== local.version + 1) return null;
  const result = applyTransaction(local.deck, {
    origin: change.origin,
    label: change.label,
    ops: change.ops,
  });
  return result.ok ? { deck: result.deck, version: change.version } : null;
}
