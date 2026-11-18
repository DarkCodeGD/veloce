/**
 * Transactions: an atomic batch of ops tagged with who made it.
 *
 * All ops apply or none do. `origin` says who made the change (`user`, `system`, `agent:<id>`).
 * It drives per-origin undo, so a human's Ctrl+Z never reverts the agent's work and
 * "undo what the AI just did" is a single step.
 */
import { z } from "zod";
import type { ApplyContext } from "./checks.js";
import { type ErrorInfo, formatIssues, formatPath, VeloceError } from "./errors.js";
import { createId } from "./ids.js";
import { applyOp } from "./ops/apply.js";
import { type Op, OpSchema, type OpType } from "./ops/schema.js";
import type { Deck } from "./schema/deck.js";
import { IdSchema } from "./schema/primitives.js";

export type AgentOrigin = `agent:${string}`;
export type Origin = "user" | "system" | AgentOrigin;

const AGENT_ORIGIN = /^agent:[A-Za-z0-9._-]{1,64}$/;

export function isAgentOrigin(origin: unknown): origin is AgentOrigin {
  return typeof origin === "string" && AGENT_ORIGIN.test(origin);
}

export const OriginSchema = z.custom<Origin>(
  (v) => v === "user" || v === "system" || isAgentOrigin(v),
  { error: 'Origin must be "user", "system" or "agent:<id>"' },
);

export const TransactionSchema = z.strictObject({
  /** Omitted → generated. */
  id: IdSchema.optional(),
  origin: OriginSchema,
  /** Short description shown in history/undo UI, e.g. "Add title slide". */
  label: z.string().min(1).max(200),
  ops: z.array(OpSchema).min(1).max(10_000),
});
export type TransactionInput = z.input<typeof TransactionSchema>;

export interface Transaction {
  id: string;
  origin: Origin;
  label: string;
  ops: Op[];
}

export interface TransactionError extends ErrorInfo {
  /** Which op failed, if the failure is tied to one. */
  opIndex?: number;
  op?: OpType;
}

export type TransactionResult =
  | {
      ok: true;
      deck: Deck;
      transaction: Transaction;
      /** Ops that undo the whole transaction, in the order to apply them. */
      inverse: Op[];
    }
  | { ok: false; error: TransactionError };

/**
 * Validate and apply a transaction. Pure: returns a new deck and never touches the input.
 * Expected failures (bad input, missing IDs…) come back as `{ ok: false }`; only bugs throw.
 */
export function applyTransaction(
  deck: Deck,
  input: unknown,
  ctx: ApplyContext = {},
): TransactionResult {
  const parsed = TransactionSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const first = issues[0]?.path ?? [];
    const opIndex = first[0] === "ops" && typeof first[1] === "number" ? first[1] : undefined;
    return {
      ok: false,
      error: {
        code: "INVALID",
        message: formatIssues(issues),
        path: formatPath(first),
        ...(opIndex !== undefined && { opIndex }),
      },
    };
  }

  const transaction: Transaction = { ...parsed.data, id: parsed.data.id ?? createId("tx") };
  let current = deck;
  const inverse: Op[] = [];
  for (const [i, op] of transaction.ops.entries()) {
    try {
      const result = applyOp(current, op, ctx);
      current = result.deck;
      inverse.push(result.inverse);
    } catch (error) {
      if (!(error instanceof VeloceError)) throw error;
      const info = error.toJSON();
      return {
        ok: false,
        error: {
          ...info,
          message: `ops[${i}] (${op.op}): ${info.message}`,
          path: info.path ? `ops[${i}].${info.path}` : `ops[${i}]`,
          opIndex: i,
          op: op.op,
        },
      };
    }
  }
  return { ok: true, deck: current, transaction, inverse: inverse.reverse() };
}
