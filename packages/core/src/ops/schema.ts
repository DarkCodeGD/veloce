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
import { ComponentNameSchema, ComponentSchema } from "../schema/component.js";
import { AssetInfoSchema, SlideSchema } from "../schema/deck.js";
import { NodeSchema } from "../schema/node.js";
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
export const NodeInsertOp = z.strictObject({
  op: z.literal("node.insert"),
  parentId: IdSchema,
  node: NodeSchema,
  index: IndexSchema,
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
export const DeckUpdateMetaOp = z.strictObject({
  op: z.literal("deck.updateMeta"),
  set: MergePatchSchema,
});
export const DeckSetThemeOp = z.strictObject({
  op: z.literal("deck.setTheme"),
  theme: ThemeSchema,
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

export const OpSchema = z.discriminatedUnion("op", [
  SlideInsertOp,
  SlideRemoveOp,
  SlideMoveOp,
  SlideUpdateOp,
  NodeInsertOp,
  NodeRemoveOp,
  NodeMoveOp,
  NodeUpdateOp,
  DeckUpdateMetaOp,
  DeckSetThemeOp,
  AssetAddOp,
  AssetRemoveOp,
  ComponentSaveOp,
  ComponentRemoveOp,
]);
export type Op = z.infer<typeof OpSchema>;
export type OpType = Op["op"];
