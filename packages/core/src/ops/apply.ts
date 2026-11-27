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
import {
  getPreset,
  inlinePatch,
  presetNotFoundHint,
  presetProblem,
  presetUses,
} from "../presets.js";
import { type Animation, AnimationSchema } from "../schema/animation.js";
import { MAX_COMPONENTS } from "../schema/component.js";
import { type Deck, DeckMetaSchema, type Slide, SlideFieldsSchema } from "../schema/deck.js";
import { ElementNodeSchema, FrameFieldsSchema, type FrameNode, type Node } from "../schema/node.js";
import { MAX_PRESETS } from "../schema/preset.js";
import { notFoundHint } from "../suggest.js";
import {
  type AnimationLocation,
  animationIds,
  animationProblem,
  animationsTargeting,
  findAnimation,
} from "../timeline.js";
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
    case "animation.insert":
      return animationInsert(deck, op, ctx);
    case "animation.remove":
      return animationRemove(deck, op);
    case "animation.move":
      return animationMove(deck, op);
    case "animation.update":
      return animationUpdate(deck, op, ctx);
    case "deck.updateMeta":
      return deckUpdateMeta(deck, op);
    case "deck.setTheme":
      return {
        deck: { ...deck, theme: op.theme },
        inverse: { op: "deck.setTheme", theme: deck.theme },
      };
    case "deck.setFooter":
      return deckSetFooter(deck, op);
    case "deck.setMotionLevel": {
      const { motionLevel: before, ...rest } = deck;
      return {
        deck: op.level ? { ...rest, motionLevel: op.level } : rest,
        inverse: { op: "deck.setMotionLevel", level: before ?? null },
      };
    }
    case "asset.add":
      return assetAdd(deck, op);
    case "asset.remove":
      return assetRemove(deck, op);
    case "component.save":
      return componentSave(deck, op, ctx);
    case "component.remove":
      return componentRemove(deck, op);
    case "preset.save":
      return presetSave(deck, op, ctx);
    case "preset.remove":
      return presetRemove(deck, op);
  }
}

// ── Slides ───────────────────────────────────────────────────────────────────────────

function slideInsert(deck: Deck, op: OpOf<"slide.insert">, ctx: ApplyContext): OpResult {
  const { slide } = op;
  const index = resolveIndex(op.index, deck.slides.length, "the deck's slides");
  assertNewIds(collectIds(deck), [
    slide.id,
    ...subtreeIds(slide.root),
    ...(slide.animations ?? []).map((a) => a.id),
  ]);
  assertDepth(0, subtreeHeight(slide.root));
  assertAssetsExist(deck, slide, slide.id);
  assertElementsValid(slide.root, ctx, "slide.root");
  for (const [i, animation] of (slide.animations ?? []).entries()) {
    assertAnimationFits(deck, slide, animation, ctx, `slide.animations[${i}]`);
  }
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
  const target = resolveIndex(op.index, deck.slides.length - 1, "the deck's slides", true);
  const slides = deck.slides.toSpliced(index, 1).toSpliced(target, 0, slide);
  return { deck: { ...deck, slides }, inverse: { op: "slide.move", id: op.id, index } };
}

function slideUpdate(deck: Deck, op: OpOf<"slide.update">): OpResult {
  const { slide, index } = requireSlide(deck, op.id);
  const { root, animations, ...fields } = slide;
  forbidKeys(op.set, {
    id: "IDs can't change. Insert a new slide and remove this one instead.",
    root: `Edit the slide's content with node ops on its root frame "${root.id}".`,
    animations:
      "Edit animations one at a time with animation.insert, animation.update, animation.move and animation.remove.",
  });
  const next = parseOrThrow(SlideFieldsSchema, mergePatch(fields, op.set), ["set"]);
  assertAssetsExist(deck, next.background, slide.id);
  return {
    deck: replaceSlide(deck, index, withAnimations({ ...next, root }, animations ?? [])),
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
  let next = insertChild(deck, parent, index, op.node);
  if (op.animations?.length) {
    // Put back the animations that removing this node took with it, where they were.
    assertNewIds(
      collectIds(deck),
      op.animations.map((p) => p.animation.id),
    );
    const slide = next.slides[parent.slideIndex] as Slide;
    const list = [...(slide.animations ?? [])];
    for (const [i, { index: at, animation }] of op.animations.entries()) {
      assertAnimationFits(deck, slide, animation, ctx, `animations[${i}].animation`);
      list.splice(resolveIndex(at, list.length, `slide "${slide.id}"'s animations`), 0, animation);
    }
    next = replaceSlide(next, parent.slideIndex, withAnimations(slide, list));
  }
  return { deck: next, inverse: { op: "node.remove", id: op.node.id } };
}

function nodeRemove(deck: Deck, op: OpOf<"node.remove">): OpResult {
  const loc = requireNode(deck, op.id);
  const parent = requireNonRoot(
    loc,
    "removed",
    "Remove the slide with slide.remove, or remove the root's children.",
  );
  // Its animations (and its children's) go with it, in the same op (D101 §2.3).
  const removed = animationsTargeting(loc.slide, new Set(subtreeIds(loc.node)));
  let next = removeChild(deck, loc);
  if (removed.length > 0) {
    const gone = new Set(removed.map((r) => r.animation));
    const slide = next.slides[loc.slideIndex] as Slide;
    const rest = (slide.animations ?? []).filter((a) => !gone.has(a));
    next = replaceSlide(next, loc.slideIndex, withAnimations(slide, rest));
  }
  return {
    deck: next,
    inverse: {
      op: "node.insert",
      parentId: parent.id,
      node: loc.node,
      index: loc.index,
      ...(removed.length > 0 && { animations: removed }),
    },
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
  const destination = findNode(deck, op.parentId);
  if (destination && destination.slide.id !== loc.slide.id) {
    const animated = animationsTargeting(loc.slide, new Set(subtreeIds(loc.node)));
    if (animated.length > 0) {
      throw new VeloceError(
        "FORBIDDEN",
        `Can't move "${op.id}" to another slide: ${quoteList(animated.map((a) => a.animation.id))} on slide "${loc.slide.id}" animate it`,
        {
          hint: "Animations stay on their slide. Remove them first (animation.remove), or insert a copy of the layer on the other slide.",
        },
      );
    }
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

// ── Animations (D110) ─────────────────────────────────────────────────────────────────

function animationInsert(deck: Deck, op: OpOf<"animation.insert">, ctx: ApplyContext): OpResult {
  const { slide, index: slideIndex } = requireSlide(deck, op.slideId);
  const list = slide.animations ?? [];
  const index = resolveIndex(op.index, list.length, `slide "${slide.id}"'s animations`);
  assertNewIds(collectIds(deck), [op.animation.id]);
  assertAnimationFits(deck, slide, op.animation, ctx, "animation");
  return {
    deck: replaceSlide(
      deck,
      slideIndex,
      withAnimations(slide, list.toSpliced(index, 0, op.animation)),
    ),
    inverse: { op: "animation.remove", id: op.animation.id },
  };
}

function animationRemove(deck: Deck, op: OpOf<"animation.remove">): OpResult {
  const { slide, slideIndex, index, animation } = requireAnimation(deck, op.id);
  const list = (slide.animations ?? []).toSpliced(index, 1);
  return {
    deck: replaceSlide(deck, slideIndex, withAnimations(slide, list)),
    inverse: { op: "animation.insert", slideId: slide.id, animation, index },
  };
}

function animationMove(deck: Deck, op: OpOf<"animation.move">): OpResult {
  const { slide, slideIndex, index, animation } = requireAnimation(deck, op.id);
  const list = slide.animations ?? [];
  const target = resolveIndex(op.index, list.length - 1, `slide "${slide.id}"'s animations`, true);
  const moved = list.toSpliced(index, 1).toSpliced(target, 0, animation);
  return {
    deck: replaceSlide(deck, slideIndex, withAnimations(slide, moved)),
    inverse: { op: "animation.move", id: op.id, index },
  };
}

function animationUpdate(deck: Deck, op: OpOf<"animation.update">, ctx: ApplyContext): OpResult {
  const { slide, slideIndex, index, animation } = requireAnimation(deck, op.id);
  forbidKeys(op.set, {
    id: "IDs can't change. Insert a new animation and remove this one instead.",
  });
  const next = parseOrThrow(AnimationSchema, mergePatch(animation, op.set), ["set"]);
  // An effect from a plugin this install lacks may stay while other fields change.
  const keepsEffect = next.effect?.name === animation.effect?.name;
  assertAnimationFits(deck, slide, next, ctx, "set", keepsEffect);
  const list = (slide.animations ?? []).toSpliced(index, 1, next);
  return {
    deck: replaceSlide(deck, slideIndex, withAnimations(slide, list)),
    inverse: { op: "animation.update", id: op.id, set: inversePatch(next, animation) },
  };
}

/** The slide with this animation list; no list at all when it's empty (fields are omitted). */
function withAnimations(slide: Slide, animations: readonly Animation[]): Slide {
  const { animations: _old, ...rest } = slide;
  return animations.length > 0 ? { ...rest, animations: [...animations] } : rest;
}

function assertAnimationFits(
  deck: Deck,
  slide: Slide,
  animation: Animation,
  ctx: ApplyContext,
  at: string,
  allowMissing = false,
) {
  const problem = animationProblem(slide, animation, ctx, deck.presets);
  if (problem && !(allowMissing && problem.missing)) {
    throw new VeloceError(problem.code, problem.message, {
      path: `${at}.${problem.path}`,
      ...(problem.hint && { hint: problem.hint }),
    });
  }
}

function requireAnimation(deck: Deck, id: string): AnimationLocation {
  const found = findAnimation(deck, id);
  if (found) return found;
  const node = findNode(deck, id);
  throw new VeloceError("NOT_FOUND", `Animation "${id}" not found`, {
    hint: node
      ? `"${id}" is a node on slide "${node.slide.id}". Its animations are the ones whose target is "${id}".`
      : notFoundHint(id, animationIds(deck), "animation"),
  });
}

// ── Deck & assets ─────────────────────────────────────────────────────────────────────

function deckUpdateMeta(deck: Deck, op: OpOf<"deck.updateMeta">): OpResult {
  const meta = parseOrThrow(DeckMetaSchema, mergePatch(deck.meta, op.set), ["set"]);
  return {
    deck: { ...deck, meta },
    inverse: { op: "deck.updateMeta", set: inversePatch(meta, deck.meta) },
  };
}

function deckSetFooter(deck: Deck, op: OpOf<"deck.setFooter">): OpResult {
  const { footer: before, ...rest } = deck;
  return {
    deck: op.footer ? { ...rest, footer: op.footer } : rest,
    inverse: { op: "deck.setFooter", footer: before ?? null },
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
  assertAssetsExist(deck, component, `component "${name}"`);
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

// ── Presets (D119) ────────────────────────────────────────────────────────────────────

function presetSave(deck: Deck, op: OpOf<"preset.save">, ctx: ApplyContext): OpResult {
  const { name, preset } = op;
  const old = getPreset(deck, name);
  // A preset shadows an installed effect of the same name in its deck, so a new one can't
  // take one's name (an old one keeps it: the file means what it meant when it was saved).
  if (!old && ctx.hasEffect?.(name)) {
    throw new VeloceError("CONFLICT", `"${name}" is already an installed effect`, {
      hint: `Pick another name, e.g. "my-${name}". Built-in and plugin effects keep theirs.`,
      path: "name",
    });
  }
  const all = deck.presets ?? {};
  if (!old && Object.keys(all).length >= MAX_PRESETS) {
    throw new VeloceError("FORBIDDEN", `This deck already has ${MAX_PRESETS} presets`, {
      hint: "Remove presets nobody uses (preset.remove) before saving another.",
    });
  }
  const problem = presetProblem(preset, ctx, all);
  // An effect from a plugin this install lacks may stay while the rest changes (like D117 §3).
  const keepsEffect = problem?.missing && old?.effect?.name === preset.effect?.name;
  if (problem && !keepsEffect) {
    throw new VeloceError(problem.code, `Preset "${name}": ${problem.message}`, {
      path: `preset.${problem.path}`,
      ...(problem.hint && { hint: problem.hint }),
    });
  }
  // Every animation that plays it must still suit its layer (a typewriter only on text).
  const presets = { ...all, [name]: preset };
  for (const { slide, animation } of presetUses(deck, name)) {
    const misfit = animationProblem(slide, animation, ctx, presets);
    if (misfit && !misfit.missing) {
      throw new VeloceError(misfit.code, misfit.message, {
        path: "preset",
        hint: `Animation "${animation.id}" on slide "${slide.id}" plays "${name}". Save the change under a new name instead, or change that animation first.`,
      });
    }
  }
  return {
    deck: { ...deck, presets },
    inverse: old ? { op: "preset.save", name, preset: old } : { op: "preset.remove", name },
  };
}

function presetRemove(deck: Deck, op: OpOf<"preset.remove">): OpResult {
  const preset = getPreset(deck, op.name);
  if (!preset) {
    throw new VeloceError("NOT_FOUND", `No preset "${op.name}" in this deck`, {
      hint: presetNotFoundHint(deck, op.name),
      path: "name",
    });
  }
  const uses = presetUses(deck, op.name);
  if (uses.length > 0) {
    const first = uses[0]?.animation as Animation;
    throw new VeloceError(
      "FORBIDDEN",
      `Preset "${op.name}" is still played by ${quoteList(uses.map((u) => u.animation.id))}`,
      {
        hint: `Give each its own copy first, in the same transaction: e.g. { "op": "animation.update", "id": "${first.id}", "set": ${JSON.stringify(inlinePatch(first, deck.presets))} }. Or remove those animations.`,
      },
    );
  }
  const { [op.name]: _removed, ...rest } = deck.presets ?? {};
  // No presets left: the field goes too (optional fields are omitted, not empty).
  const { presets: _all, ...without } = deck;
  return {
    deck: Object.keys(rest).length > 0 ? { ...deck, presets: rest } : without,
    inverse: { op: "preset.save", name: op.name, preset },
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
  const animation = slide ? null : findAnimation(deck, id);
  throw new VeloceError("NOT_FOUND", `Node "${id}" not found`, {
    hint: slide
      ? `"${id}" is a slide. Its root frame is "${slide.slide.root.id}".`
      : animation
        ? `"${id}" is an animation on slide "${animation.slide.id}" (of "${animation.animation.target}"). Edit it with animation.update.`
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

/**
 * `undefined` → append. Otherwise must be within 0…max. A move needs its index (there's no
 * "append" to omit it for), so its hint names the last place instead.
 */
function resolveIndex(index: number | undefined, max: number, what: string, move = false): number {
  if (index === undefined) return max;
  if (index > max) {
    throw new VeloceError("INVALID", `Index ${index} is out of range for ${what} (0–${max})`, {
      hint: move ? `Use ${max} to move it to the end.` : "Omit the index to append at the end.",
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
