/**
 * Errors that are meant to be read and acted on, by a human or by an AI agent.
 *
 * Every error carries a machine-readable `code`, a plain-language `message`, and
 * where possible a `hint` that says how to fix the call (valid IDs, nearest matches…).
 */
import type { z } from "zod";

export type ErrorCode =
  /** Input doesn't match the schema. */
  | "INVALID"
  /** A referenced slide/node/asset doesn't exist. */
  | "NOT_FOUND"
  /** Something with that ID already exists. */
  | "CONFLICT"
  /** Valid input, but the operation isn't allowed (remove root, move into own child…). */
  | "FORBIDDEN";

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  hint?: string;
  /** Dotted path to the offending value, e.g. `ops[2].node.width`. */
  path?: string;
}

export class VeloceError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly path?: string;

  constructor(code: ErrorCode, message: string, options: { hint?: string; path?: string } = {}) {
    super(message);
    this.name = "VeloceError";
    this.code = code;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.path !== undefined) this.path = options.path;
  }

  toJSON(): ErrorInfo {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint !== undefined && { hint: this.hint }),
      ...(this.path !== undefined && { path: this.path }),
    };
  }
}

/** `["ops", 2, "node", "width"]` → `"ops[2].node.width"`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out ? `.${String(key)}` : String(key);
  }
  return out;
}

type Issue = z.core.$ZodIssue;

/**
 * Zod reports a failed union as one vague "Invalid input" issue holding each branch's
 * issues. If one branch got further into the value (its issues have longer paths), that
 * branch is what the caller meant, so we report its issues instead.
 */
function bestIssues(issue: Issue): Issue[] {
  if (issue.code !== "invalid_union" || issue.errors.length === 0) return [issue];
  const depth = (issues: Issue[]) => Math.max(...issues.map((i) => i.path.length));
  const ranked = issue.errors
    .filter((branch) => branch.length > 0)
    .map((branch) => ({ branch, depth: depth(branch) }))
    .sort((a, b) => b.depth - a.depth || a.branch.length - b.branch.length);
  const best = ranked[0];
  // No branch got past the top-level type check → the union's own message is the clearest.
  if (!best || best.depth === 0) return [issue];
  return best.branch
    .flatMap(bestIssues)
    .map((inner) => ({ ...inner, path: [...issue.path, ...inner.path] }));
}

/** Readable one-line summary of Zod issues, capped so an agent's context isn't flooded. */
export function formatIssues(
  issues: readonly Issue[],
  basePath: readonly PropertyKey[] = [],
  max = 5,
): string {
  const flat = issues.flatMap(bestIssues);
  const lines = flat.slice(0, max).map((issue) => {
    const where = formatPath([...basePath, ...issue.path]);
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  if (flat.length > max) lines.push(`(+${flat.length - max} more)`);
  return lines.join("; ");
}

/** Parse with a schema or throw an INVALID VeloceError with a readable message. */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  basePath: readonly PropertyKey[] = [],
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const path = formatPath([...basePath, ...(result.error.issues[0]?.path ?? [])]);
  throw new VeloceError("INVALID", formatIssues(result.error.issues, basePath), {
    ...(path && { path }),
  });
}
