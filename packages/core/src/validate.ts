/**
 * Whole-deck validation, used when a deck comes from outside (a file, the network).
 *
 * Ops validate incrementally; this checks everything at once and reports every problem
 * instead of stopping at the first one. A missing plugin is only a warning: the deck still
 * opens and the renderer shows the element's fallback.
 */
import { collectAssetRefs } from "./assets.js";
import type { ApplyContext } from "./checks.js";
import { componentProblem } from "./components.js";
import { type ErrorCode, formatIssues, formatPath } from "./errors.js";
import { type Deck, DeckSchema, FORMAT_VERSION } from "./schema/deck.js";
import { MAX_DEPTH, type Node } from "./schema/node.js";
import { walkNodes } from "./tree.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  code: ErrorCode;
  message: string;
  path?: string;
}

export type DeckValidation =
  | { ok: true; deck: Deck; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

const MAX_REPORTED = 50;

export function validateDeck(value: unknown, ctx: ApplyContext = {}): DeckValidation {
  const parsed = DeckSchema.safeParse(value);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, MAX_REPORTED).map(
      (issue): ValidationIssue => ({
        severity: "error",
        code: "INVALID",
        message: formatIssues([issue]),
        path: formatPath(issue.path),
      }),
    );
    return { ok: false, errors, warnings: [] };
  }

  const deck = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const error = (code: ErrorCode, message: string, path?: string) =>
    errors.push({ severity: "error", code, message, ...(path && { path }) });

  if (deck.formatVersion !== FORMAT_VERSION) {
    error(
      "INVALID",
      `Format version ${deck.formatVersion} isn't the current version (${FORMAT_VERSION}). Load files through @veloce/format, which migrates them.`,
      "formatVersion",
    );
  }

  /** Plugin checks: an unknown type is a warning (the renderer shows a fallback). */
  const checkElement = (node: Node, prefix = "") => {
    if (node.kind !== "element" || !ctx.validateElement) return;
    const check = ctx.validateElement(node.type, node.props);
    if (check.ok) return;
    const issue: ValidationIssue = {
      severity: check.reason === "unknown-type" ? "warning" : "error",
      code: check.reason === "unknown-type" ? "NOT_FOUND" : "INVALID",
      message: `${prefix}Element "${node.id}" (${node.type}): ${check.message}`,
    };
    (issue.severity === "warning" ? warnings : errors).push(issue);
  };

  const seen = new Set<string>();
  const checkId = (id: string, path: string) => {
    if (seen.has(id)) error("CONFLICT", `Duplicate ID "${id}"`, path);
    seen.add(id);
  };

  for (const [s, slide] of deck.slides.entries()) {
    checkId(slide.id, `slides[${s}].id`);
    for (const ref of collectAssetRefs(slide.background)) {
      if (!Object.hasOwn(deck.assets, ref)) {
        error(
          "NOT_FOUND",
          `Slide "${slide.id}" uses missing asset ${ref}`,
          `slides[${s}].background`,
        );
      }
    }
    for (const { node, depth } of walkNodes(slide.root)) {
      checkId(node.id, `slides[${s}]`);
      if (depth > MAX_DEPTH)
        error("FORBIDDEN", `Node "${node.id}" is nested deeper than ${MAX_DEPTH} levels`);
      for (const ref of collectAssetRefs(node.kind === "frame" ? node.style : node.props)) {
        if (!Object.hasOwn(deck.assets, ref)) {
          error("NOT_FOUND", `Node "${node.id}" uses missing asset ${ref}`, `slides[${s}]`);
        }
      }
      checkElement(node);
    }
  }

  // Components (D94): sound templates whose assets exist. Their IDs are their own (a copy
  // gets fresh ones), so they don't count against the slides'.
  for (const [name, component] of Object.entries(deck.components ?? {})) {
    const at = `components.${name}`;
    const problem = componentProblem(component);
    if (problem) {
      error(problem.code, `Component "${name}": ${problem.message}`, at);
      continue;
    }
    for (const ref of collectAssetRefs(component)) {
      if (!Object.hasOwn(deck.assets, ref)) {
        error("NOT_FOUND", `Component "${name}" uses missing asset ${ref}`, at);
      }
    }
    for (const { node } of walkNodes(component.node)) checkElement(node, `Component "${name}": `);
  }

  if (errors.length) return { ok: false, errors: errors.slice(0, MAX_REPORTED), warnings };
  return { ok: true, deck, warnings };
}
