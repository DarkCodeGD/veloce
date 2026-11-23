/**
 * Applying a single op: validate → produce the next deck immutably → return the exact inverse.
 *
 * `applyOp` expects a schema-valid op (use `applyTransaction`, which validates input from the
 * outside world). It throws `VeloceError`s with hints written for whoever made the call,
 * human or agent, e.g. "Node "titel" not found. Did you mean "title"?".
 */
import { assetUsage } from "../assets.js";
import {
  type ApplyContext,
  assertAssetsExist,
  assertDepth,
  assertElementsValid,
  assertNewIds,
  subtreeIds,
} from "../checks.js";
import { caseClash, componentNotFound, componentProblem, getComponent } from "../components.js";
import { parseOrThrow, VeloceError } from "../errors.js";
import { diffPatch, type JsonObject, mergePatch } from "../json.js";
import { MAX_COMPONENTS } from "../schema/component.js";
import { type Deck, DeckMetaSchema, SlideFieldsSchema } from "../schema/deck.js";
import { ElementNodeSchema, FrameFieldsSchema, type FrameNode, type Node } from "../schema/node.js";
import { notFoundHint } from "../suggest.js";
import {
  collectIds,
  containsNode,
  findNode,
  findSlide,
  type NodeLocation,
  replaceSlide,
  type SlideLocation,
  subtreeHeight,
  updateAtPath,
  walkNodes,
} from "../tree.js";
import type { Op } from "./schema.js";

export interface OpResult {
  deck: Deck;
  /** Applying this to `deck` restores the deck the op was applied to. */
  inverse: Op;
}

type OpOf<T extends Op["op"]> = Extract<Op, { op: T }>;

export function applyOp(deck: Deck, op: Op, ctx: ApplyContext = {}): OpResult {
  switch (op.op) {
    case "slide.insert":
      return slideInsert(deck, op, ctx);
    case "slide.remove":
      return slideRemove(deck, op);
    case "slide.move":
      return slideMove(deck, op);
    case "slide.update":
      return slideUpdate(deck, op);
    case "node.insert":
      return nodeInsert(deck, op, ctx);
    case "node.remove":
      return nodeRemove(deck, op);
    case "node.move":
      return nodeMove(deck, op);
    case "node.update":
      return nodeUpdate(deck, op, ctx);
    case "deck.updateMeta":
      return deckUpdateMeta(deck, op);
    case "deck.setTheme":
      return {
        deck: { ...deck, theme: op.theme },
        inverse: { op: "deck.setTheme", theme: deck.theme },
      };
    case "asset.add":
      return assetAdd(deck, op);
    case "asset.remove":
      return assetRemove(deck, op);
    case "component.save":
      return componentSave(deck, op, ctx);
    case "component.remove":
      return componentRemove(deck, op);
  }
}

// ── Slides ───────────────────────────────────────────────────────────────────────────

function slideInsert(deck: Deck, op: OpOf<"slide.insert">, ctx: ApplyContext): OpResult {
  const { slide } = op;
  const index = resolveIndex(op.index, deck.slides.length, "the deck's slides");
  assertNewIds(collectIds(deck), [slide.id, ...subtreeIds(slide.root)]);
  assertDepth(0, subtreeHeight(slide.root));
  assertAssetsExist(deck, slide, slide.id);
  assertElementsValid(slide.root, ctx, "slide.root");
  return {
    deck: { ...deck, slides: deck.slides.toSpliced(index, 0, slide) },
    inverse: { op: "slide.remove", id: slide.id },
  };
}

function slideRemove(deck: Deck, op: OpOf<"slide.remove">): OpResult {
  const { slide, index } = requireSlide(deck, op.id);
  return {
    deck: { ...deck, slides: deck.slides.toSpliced(index, 1) },
    inverse: { op: "slide.insert", slide, index },
  };
}

function slideMove(deck: Deck, op: OpOf<"slide.move">): OpResult {
  const { slide, index } = requireSlide(deck, op.id);
  const target = resolveIndex(op.index, deck.slides.length - 1, "the deck's slides");
  const slides = deck.slides.toSpliced(index, 1).toSpliced(target, 0, slide);
  return { deck: { ...deck, slides }, inverse: { op: "slide.move", id: op.id, index } };
}

function slideUpdate(deck: Deck, op: OpOf<"slide.update">): OpResult {
  const { slide, index } = requireSlide(deck, op.id);
  const { root, ...fields } = slide;
  forbidKeys(op.set, {
    id: "IDs can't change. Insert a new slide and remove this one instead.",
    root: `Edit the slide's content with node ops on its root frame "${root.id}".`,
  });
  const next = parseOrThrow(SlideFieldsSchema, mergePatch(fields, op.set), ["set"]);
  assertAssetsExist(deck, next.background, slide.id);
  return {
    deck: replaceSlide(deck, index, { ...next, root }),
    inverse: { op: "slide.update", id: op.id, set: inversePatch(next, fields) },
  };
}

// ── Nodes ────────────────────────────────────────────────────────────────────────────

function nodeInsert(deck: Deck, op: OpOf<"node.insert">, ctx: ApplyContext): OpResult {
  const parent = requireFrame(deck, op.parentId);
  const index = resolveIndex(op.index, parent.node.children.length, `"${op.parentId}"'s children`);
  assertNewIds(collectIds(deck), subtreeIds(op.node));
  assertDepth(parent.path.length + 1, subtreeHeight(op.node));
  assertAssetsExist(deck, op.node, op.node.id);
  assertElementsValid(op.node, ctx, "node");
  return {
    deck: insertChild(deck, parent, index, op.node),
    inverse: { op: "node.remove", id: op.node.id },
  };
}

function nodeRemove(deck: Deck, op: OpOf<"node.remove">): OpResult {
  const loc = requireNode(deck, op.id);
  const parent = requireNonRoot(
    loc,
    "removed",
    "Remove the slide with slide.remove, or remove the root's children.",
  );
  return {
    deck: removeChild(deck, loc),
    inverse: { op: "node.insert", parentId: parent.id, node: loc.node, index: loc.index },
  };
}

function nodeMove(deck: Deck, op: OpOf<"node.move">): OpResult {
  const loc = requireNode(deck, op.id);
  const oldParent = requireNonRoot(loc, "moved", "Move its children instead.");
  requireFrame(deck, op.parentId);
  if (containsNode(loc.node, op.parentId)) {
    throw new VeloceError(
      "FORBIDDEN",
      `Can't move "${op.id}" into itself or one of its own children`,
    );
  }
  const without = removeChild(deck, loc);
  // Paths may have shifted after the removal, so look the target up again.
  const target = findNode(without, op.parentId) as NodeLocation & { node: FrameNode };
  const index = resolveIndex(op.index, target.node.children.length, `"${op.parentId}"'s children`);
  assertDepth(target.path.length + 1, subtreeHeight(loc.node));
  return {
    deck: insertChild(without, target, index, loc.node),
    inverse: { op: "node.move", id: op.id, parentId: oldParent.id, index: loc.index },
  };
}

function nodeUpdate(deck: Deck, op: OpOf<"node.update">, ctx: ApplyContext): OpResult {
  const loc = requireNode(deck, op.id);
  forbidKeys(op.set, {
    id: "IDs can't change. Insert a new node and remove this one instead.",
    kind: "A node can't switch between frame and element. Insert a new node instead.",
    type: "An element's type can't change. Remove it and insert a new element of the other type.",
    children: "Change children with node.insert, node.move and node.remove.",
  });

  let next: Node;
  let before: JsonObject;
  let after: JsonObject;
  if (loc.node.kind === "frame") {
    const { children, ...fields } = loc.node;
    const patched = parseOrThrow(FrameFieldsSchema, mergePatch(fields, op.set), ["set"]);
    assertAssetsExist(deck, patched.style, op.id);
    next = { ...patched, children };
    before = fields;
    after = patched;
  } else {
    const patched = parseOrThrow(ElementNodeSchema, mergePatch(loc.node, op.set), ["set"]);
    assertAssetsExist(deck, patched.props, op.id);
    assertElementsValid(patched, ctx, "set");
    next = patched;
    before = loc.node;
    after = patched;
  }

  const root = updateAtPath(loc.slide.root, loc.path, () => next);
  return {
    deck: replaceSlide(deck, loc.slideIndex, { ...loc.slide, root }),
    inverse: { op: "node.update", id: op.id, set: inversePatch(after, before) },
  };
}

// ── Deck & assets ─────────────────────────────────────────────────────────────────────

function deckUpdateMeta(deck: Deck, op: OpOf<"deck.updateMeta">): OpResult {
  const meta = parseOrThrow(DeckMetaSchema, mergePatch(deck.meta, op.set), ["set"]);
  return {
    deck: { ...deck, meta },
    inverse: { op: "deck.updateMeta", set: inversePatch(meta, deck.meta) },
  };
}

function assetAdd(deck: Deck, op: OpOf<"asset.add">): OpResult {
  // Same bytes → same ID → nothing to do. The inverse is the same no-op, so undo keeps the asset.
  if (Object.hasOwn(deck.assets, op.id)) return { deck, inverse: op };
  return {
    deck: { ...deck, assets: { ...deck.assets, [op.id]: op.asset } },
    inverse: { op: "asset.remove", id: op.id },
  };
}

function assetRemove(deck: Deck, op: OpOf<"asset.remove">): OpResult {
  const asset = deck.assets[op.id];
  if (!asset) {
    throw new VeloceError("NOT_FOUND", `Asset ${op.id} isn't in the deck`, {
      hint: notFoundHint(op.id, Object.keys(deck.assets), "asset"),
    });
  }
  const users = assetUsage(deck).get(op.id);
  if (users?.length) {
    throw new VeloceError("FORBIDDEN", `Asset ${op.id} is still used by ${quoteList(users)}`, {
      hint: "Remove or change those slides, nodes or components first.",
    });
  }
  const { [op.id]: _removed, ...assets } = deck.assets;
  return { deck: { ...deck, assets }, inverse: { op: "asset.add", id: op.id, asset } };
}

// ── Components (D94) ──────────────────────────────────────────────────────────────────

function componentSave(deck: Deck, op: OpOf<"component.save">, ctx: ApplyContext): OpResult {
  const { name, component } = op;
  const clash = caseClash(deck, name);
  if (clash) {
    throw new VeloceError("CONFLICT", `A component named "${clash}" already exists`, {
      hint: `Names differ by more than case. Save as "${clash}" to replace it, or pick another name.`,
      path: "name",
    });
  }
  const old = getComponent(deck, name);
  const all = deck.components ?? {};
  if (!old && Object.keys(all).length >= MAX_COMPONENTS) {
    throw new VeloceError("FORBIDDEN", `This deck already has ${MAX_COMPONENTS} components`, {
      hint: "Remove components nobody uses (component.remove) before saving another.",
    });
  }
  const problem = componentProblem(component);
  if (problem) throw problem;
  assertAssetsExist(deck, component.node, `component "${name}"`);
  assertElementsValid(component.node, ctx, "component.node");
  return {
    deck: { ...deck, components: { ...all, [name]: component } },
    inverse: old
      ? { op: "component.save", name, component: old }
      : { op: "component.remove", name },
  };
}

function componentRemove(deck: Deck, op: OpOf<"component.remove">): OpResult {
  const component = getComponent(deck, op.name);
  if (!component) throw componentNotFound(deck, op.name);
  const { [op.name]: _removed, ...rest } = deck.components ?? {};
  // No components left: the field goes too (optional fields are omitted, not empty).
  const { components: _all, ...without } = deck;
  return {
    deck: Object.keys(rest).length > 0 ? { ...deck, components: rest } : without,
    inverse: { op: "component.save", name: op.name, component },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────

function requireSlide(deck: Deck, id: string): SlideLocation {
  const found = findSlide(deck, id);
  if (found) return found;
  const node = findNode(deck, id);
  throw new VeloceError("NOT_FOUND", `Slide "${id}" not found`, {
    hint: node
      ? `"${id}" is a node on slide "${node.slide.id}", not a slide.`
      : notFoundHint(
          id,
          deck.slides.map((s) => s.id),
          "slide",
        ),
  });
}

function requireNode(deck: Deck, id: string): NodeLocation {
  const found = findNode(deck, id);
  if (found) return found;
  const slide = findSlide(deck, id);
  throw new VeloceError("NOT_FOUND", `Node "${id}" not found`, {
    hint: slide
      ? `"${id}" is a slide. Its root frame is "${slide.slide.root.id}".`
      : notFoundHint(id, nodeIds(deck), "node"),
  });
}

function requireFrame(deck: Deck, id: string): NodeLocation & { node: FrameNode } {
  const loc = requireNode(deck, id);
  if (loc.node.kind !== "frame") {
    throw new VeloceError(
      "FORBIDDEN",
      `"${id}" is a ${loc.node.type} element and can't contain children`,
      {
        hint: `Only frames have children. Use its parent frame "${loc.parent?.id}" instead.`,
      },
    );
  }
  return loc as NodeLocation & { node: FrameNode };
}

function requireNonRoot(loc: NodeLocation, verb: string, hint: string): FrameNode {
  if (loc.parent) return loc.parent;
  throw new VeloceError(
    "FORBIDDEN",
    `"${loc.node.id}" is the root frame of slide "${loc.slide.id}" and can't be ${verb}`,
    { hint },
  );
}

function insertChild(deck: Deck, parent: NodeLocation, index: number, node: Node): Deck {
  const root = updateAtPath(parent.slide.root, parent.path, (frame) => {
    const f = frame as FrameNode;
    return { ...f, children: f.children.toSpliced(index, 0, node) };
  });
  return replaceSlide(deck, parent.slideIndex, { ...parent.slide, root });
}

function removeChild(deck: Deck, loc: NodeLocation): Deck {
  const root = updateAtPath(loc.slide.root, loc.path.slice(0, -1), (frame) => {
    const f = frame as FrameNode;
    return { ...f, children: f.children.toSpliced(loc.index, 1) };
  });
  return replaceSlide(deck, loc.slideIndex, { ...loc.slide, root });
}

/** `undefined` → append. Otherwise must be within 0…max. */
function resolveIndex(index: number | undefined, max: number, what: string): number {
  if (index === undefined) return max;
  if (index > max) {
    throw new VeloceError("INVALID", `Index ${index} is out of range for ${what} (0–${max})`, {
      hint: "Omit the index to append at the end.",
    });
  }
  return index;
}

function forbidKeys(patch: JsonObject, rules: Record<string, string>): void {
  for (const [key, hint] of Object.entries(rules)) {
    if (Object.hasOwn(patch, key)) {
      throw new VeloceError("FORBIDDEN", `"${key}" can't be changed with an update`, {
        hint,
        path: `set.${key}`,
      });
    }
  }
}

/** Merge patch that turns `after` back into `before`. */
function inversePatch(after: JsonObject, before: JsonObject): JsonObject {
  return (diffPatch(after, before) as JsonObject | undefined) ?? {};
}

function nodeIds(deck: Deck): string[] {
  return deck.slides.flatMap((s) => [...walkNodes(s.root)].map(({ node }) => node.id));
}

function quoteList(items: readonly string[], max = 10): string {
  const shown = items
    .slice(0, max)
    .map((i) => `"${i}"`)
    .join(", ");
  return items.length > max ? `${shown} (+${items.length - max} more)` : shown;
}
