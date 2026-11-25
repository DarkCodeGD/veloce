/**
 * Ops: the only way a deck changes (golden rule #1: humans and AI use the same ops).
 *
 * Ops are plain JSON so they can travel over WebSocket, come from an AI agent, be logged
 * and be replayed. Every op has an exact inverse, computed when it's applied.
 *
 * Updates (`*.update`, `deck.updateMeta`) take a JSON Merge Patch in `set`:
 * nested objects merge, arrays/values replace, `null` deletes a field.
 */
import { z } from "zod";
import { AnimationSchema } from "../schema/animation.js";
import { ComponentNameSchema, ComponentSchema } from "../schema/component.js";
import { AssetInfoSchema, FooterSchema, SlideSchema } from "../schema/deck.js";
import { MotionLevelSchema } from "../schema/motion.js";
import { NodeSchema } from "../schema/node.js";
import { PresetNameSchema, PresetSchema } from "../schema/preset.js";
import { AssetIdSchema, IdSchema } from "../schema/primitives.js";
import { ThemeSchema } from "../schema/theme.js";

/** Insert position; omitted = append at the end. */
const IndexSchema = z.number().int().min(0).optional();
const MergePatchSchema = z.record(z.string(), z.unknown());

export const SlideInsertOp = z.strictObject({
  op: z.literal("slide.insert"),
  slide: SlideSchema,
  index: IndexSchema,
});
export const SlideRemoveOp = z.strictObject({ op: z.literal("slide.remove"), id: IdSchema });
export const SlideMoveOp = z.strictObject({
  op: z.literal("slide.move"),
  id: IdSchema,
  index: z.number().int().min(0),
});
/** Patch a slide's own fields (name, background, notes, hidden). Not its node tree. */
export const SlideUpdateOp = z.strictObject({
  op: z.literal("slide.update"),
  id: IdSchema,
  set: MergePatchSchema,
});
/** An animation at a position in its slide's list (D110). */
const PlacedAnimationSchema = z.strictObject({
  index: z.number().int().min(0),
  animation: AnimationSchema,
});

export const NodeInsertOp = z.strictObject({
  op: z.literal("node.insert"),
  parentId: IdSchema,
  node: NodeSchema,
  index: IndexSchema,
  /**
   * Animations of the inserted layers to put back, at their positions in the slide's list
   * (ascending). It's how undoing `node.remove` restores the animations that removing the
   * node took with it (D101 §2.3).
   */
  animations: z.array(PlacedAnimationSchema).optional(),
});
export const NodeRemoveOp = z.strictObject({ op: z.literal("node.remove"), id: IdSchema });
/** Move a node to another frame (or another position in the same frame), on any slide. */
export const NodeMoveOp = z.strictObject({
  op: z.literal("node.move"),
  id: IdSchema,
  parentId: IdSchema,
  /** Position among the new parent's children after the node is taken out. Omitted = last. */
  index: IndexSchema,
});
/** Patch a node's fields (and an element's `props`). Not `id`, `kind`, `type` or `children`. */
export const NodeUpdateOp = z.strictObject({
  op: z.literal("node.update"),
  id: IdSchema,
  set: MergePatchSchema,
});
// ── Animations (D110): one at a time, by ID, never the slide's list as a whole ─────────

export const AnimationInsertOp = z.strictObject({
  op: z.literal("animation.insert"),
  slideId: IdSchema,
  animation: AnimationSchema,
  /** Position in the slide's play order. Omitted = last. */
  index: IndexSchema,
});
export const AnimationRemoveOp = z.strictObject({
  op: z.literal("animation.remove"),
  id: IdSchema,
});
/** Move an animation within its slide's play order. */
export const AnimationMoveOp = z.strictObject({
  op: z.literal("animation.move"),
  id: IdSchema,
  index: z.number().int().min(0),
});
/** Patch an animation's fields (`tracks` merge by property). Not its `id`. */
export const AnimationUpdateOp = z.strictObject({
  op: z.literal("animation.update"),
  id: IdSchema,
  set: MergePatchSchema,
});

export const DeckUpdateMetaOp = z.strictObject({
  op: z.literal("deck.updateMeta"),
  set: MergePatchSchema,
});
export const DeckSetThemeOp = z.strictObject({
  op: z.literal("deck.setTheme"),
  theme: ThemeSchema,
});
/** Set the deck's footer (D97), or remove it with `null`. Replaces the whole footer. */
export const DeckSetFooterOp = z.strictObject({
  op: z.literal("deck.setFooter"),
  footer: FooterSchema.nullable(),
});
/** Set the deck's motion level (D111), or go back to the default with `null`. */
export const DeckSetMotionLevelOp = z.strictObject({
  op: z.literal("deck.setMotionLevel"),
  level: MotionLevelSchema.nullable(),
});
/** Register an asset's metadata. Idempotent: adding an existing asset is a no-op. */
export const AssetAddOp = z.strictObject({
  op: z.literal("asset.add"),
  id: AssetIdSchema,
  asset: AssetInfoSchema,
});
/** Unregister an asset. Refused while anything still references it. */
export const AssetRemoveOp = z.strictObject({ op: z.literal("asset.remove"), id: AssetIdSchema });

/**
 * Save a component under `name` (D94), or replace the one saved there. Copies already on
 * slides don't change: they were never linked to it.
 */
export const ComponentSaveOp = z.strictObject({
  op: z.literal("component.save"),
  name: ComponentNameSchema,
  component: ComponentSchema,
});
/** Forget a component. Its copies on slides stay. */
export const ComponentRemoveOp = z.strictObject({
  op: z.literal("component.remove"),
  name: ComponentNameSchema,
});

/**
 * Save an animation preset under `name` (D119), or replace the one saved there. Animations
 * that play it by name change with it: each must still suit its layer.
 */
export const PresetSaveOp = z.strictObject({
  op: z.literal("preset.save"),
  name: PresetNameSchema,
  preset: PresetSchema,
});
/**
 * Forget a preset. Refused while animations play it: give them their own copy first
 * (`inlinePresetOps`, one `animation.update` each), or remove them.
 */
export const PresetRemoveOp = z.strictObject({
  op: z.literal("preset.remove"),
  name: PresetNameSchema,
});

export const OpSchema = z.discriminatedUnion("op", [
  SlideInsertOp,
  SlideRemoveOp,
  SlideMoveOp,
  SlideUpdateOp,
  NodeInsertOp,
  NodeRemoveOp,
  NodeMoveOp,
  NodeUpdateOp,
  AnimationInsertOp,
  AnimationRemoveOp,
  AnimationMoveOp,
  AnimationUpdateOp,
  DeckUpdateMetaOp,
  DeckSetThemeOp,
  DeckSetFooterOp,
  DeckSetMotionLevelOp,
  AssetAddOp,
  AssetRemoveOp,
  ComponentSaveOp,
  ComponentRemoveOp,
  PresetSaveOp,
  PresetRemoveOp,
]);
export type Op = z.infer<typeof OpSchema>;
export type OpType = Op["op"];
