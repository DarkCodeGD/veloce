/**
 * Semantic checks shared by op application and whole-deck validation: the rules a schema
 * alone can't express (unique IDs, existing assets, plugin-validated props, max depth).
 */
import { collectAssetRefs } from "./assets.js";
import { VeloceError } from "./errors.js";
import type { Deck } from "./schema/deck.js";
import { MAX_DEPTH, type Node } from "./schema/node.js";
import { walkNodes } from "./tree.js";

/** Result of asking the plugin registry whether an element is valid. */
export type ElementCheck =
  | { ok: true }
  | { ok: false; reason: "unknown-type" | "invalid-props"; message: string };

export type ElementValidator = (type: string, props: Record<string, unknown>) => ElementCheck;

/** Hooks that make core plugin-aware without depending on any plugin code. */
export interface ApplyContext {
  /** Usually `registry.validateElement` from `@veloce/plugin-api`. Omitted → props aren't checked. */
  validateElement?: ElementValidator;
}

export function subtreeIds(node: Node): string[] {
  return [...walkNodes(node)].map(({ node: n }) => n.id);
}

/** New IDs must not exist yet and must not repeat among themselves. */
export function assertNewIds(existing: ReadonlySet<string>, ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (existing.has(id) || seen.has(id)) {
      throw new VeloceError("CONFLICT", `ID "${id}" is already used in this deck`, {
        hint: "IDs must be unique across all slides and nodes. Pick another ID or omit it to generate one.",
      });
    }
    seen.add(id);
  }
}

export function assertAssetsExist(deck: Deck, value: unknown, ownerId: string): void {
  for (const id of collectAssetRefs(value)) {
    if (!Object.hasOwn(deck.assets, id)) {
      throw new VeloceError(
        "NOT_FOUND",
        `"${ownerId}" references asset ${id}, which isn't in the deck`,
        {
          hint: "Register the asset with an asset.add op (earlier in the same transaction is fine).",
        },
      );
    }
  }
}

export function assertElementsValid(node: Node, ctx: ApplyContext): void {
  if (!ctx.validateElement) return;
  for (const { node: n } of walkNodes(node)) {
    if (n.kind !== "element") continue;
    const check = ctx.validateElement(n.type, n.props);
    if (!check.ok) {
      throw new VeloceError(
        check.reason === "unknown-type" ? "NOT_FOUND" : "INVALID",
        `Element "${n.id}" (${n.type}): ${check.message}`,
      );
    }
  }
}

/** `depthOfNode` = depth the subtree's top node will sit at (root = 0). */
export function assertDepth(depthOfNode: number, height: number): void {
  if (depthOfNode + height > MAX_DEPTH) {
    throw new VeloceError("FORBIDDEN", `Nesting is too deep (max ${MAX_DEPTH} levels)`, {
      hint: "Flatten the structure: use a grid or stack layout instead of nesting frames.",
    });
  }
}
