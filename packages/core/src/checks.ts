/**
 * Semantic checks shared by op application and whole-deck validation: the rules a schema
 * alone can't express (unique IDs, existing assets, plugin-validated props, max depth).
 */
import { collectAssetRefs } from "./assets.js";
import { VeloceError } from "./errors.js";
import type { EffectRef } from "./schema/animation.js";
import type { Deck } from "./schema/deck.js";
import { MAX_DEPTH, type Node } from "./schema/node.js";
import { walkNodes } from "./tree.js";

/** Result of asking the plugin registry whether an element is valid. */
export type ElementCheck =
  | { ok: true }
  | { ok: false; reason: "unknown-type" | "invalid-props"; message: string };

export type ElementValidator = (type: string, props: Record<string, unknown>) => ElementCheck;

/**
 * Result of asking the plugin registry whether an animation's effect can play on its
 * target (D117): the effect exists, its params are valid, and it suits that kind of layer.
 */
export type EffectCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "unknown-effect" | "invalid-params" | "wrong-target";
      message: string;
      hint?: string;
    };

export type EffectValidator = (effect: EffectRef, target: Node) => EffectCheck;

/** Hooks that make core plugin-aware without depending on any plugin code. */
export interface ApplyContext {
  /** Usually `registry.validateElement` from `@veloce/plugin-api`. Omitted → props aren't checked. */
  validateElement?: ElementValidator;
  /** Usually `registry.validateEffect`. Omitted → effects aren't checked. */
  validateEffect?: EffectValidator;
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

/**
 * Every element in the subtree passes its plugin's checks. `at` is where `node` sits in the op
 * (`"node"`, `"slide.root"`), so the error's path leads to the bad element even when its ID was
 * generated and the caller has never seen it.
 */
export function assertElementsValid(node: Node, ctx: ApplyContext, at: string): void {
  const validate = ctx.validateElement;
  if (!validate) return;
  const visit = (n: Node, path: string): void => {
    if (n.kind === "frame") {
      n.children.forEach((child, i) => {
        visit(child, `${path}.children[${i}]`);
      });
      return;
    }
    const check = validate(n.type, n.props);
    if (!check.ok) {
      throw new VeloceError(
        check.reason === "unknown-type" ? "NOT_FOUND" : "INVALID",
        `Element "${n.id}" (${n.type}): ${check.message}`,
        { path: `${path}.${check.reason === "unknown-type" ? "type" : "props"}` },
      );
    }
  };
  visit(node, at);
}

/** `depthOfNode` = depth the subtree's top node will sit at (root = 0). */
export function assertDepth(depthOfNode: number, height: number): void {
  if (depthOfNode + height > MAX_DEPTH) {
    throw new VeloceError("FORBIDDEN", `Nesting is too deep (max ${MAX_DEPTH} levels)`, {
      hint: "Flatten the structure: use a grid or stack layout instead of nesting frames.",
    });
  }
}
