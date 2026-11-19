/**
 * The node tree: what a slide is made of.
 *
 * Two kinds of nodes:
 * - **frame**: a container that lays out its children (auto-layout stack, grid, or absolute).
 * - **element**: a leaf drawn by a plugin (`type: "text" | "shape" | "image" | "acme.sparkles"…`).
 *   Core doesn't know element props; the plugin registry validates them.
 *
 * Layout is stored in the document (golden rule #4): the AI says "a row of three cards" and the
 * engine computes pixels, so edits reflow instead of overlapping.
 */
import { z } from "zod";
import { PaintSchema, ShadowValueSchema, StrokeSchema } from "./paint.js";
import { IdSchema, PointSchema, RadiusSchema, SizingSchema, SpaceSchema } from "./primitives.js";

// ── Layout ─────────────────────────────────────────────────────────────────────────

export const PaddingSchema = z.union([
  SpaceSchema,
  z.strictObject({ x: SpaceSchema.optional(), y: SpaceSchema.optional() }),
  z.strictObject({
    top: SpaceSchema.optional(),
    right: SpaceSchema.optional(),
    bottom: SpaceSchema.optional(),
    left: SpaceSchema.optional(),
  }),
]);
export type Padding = z.infer<typeof PaddingSchema>;

const AlignSchema = z.enum(["start", "center", "end", "stretch"]);
const JustifySchema = z.enum([
  "start",
  "center",
  "end",
  "space-between",
  "space-around",
  "space-evenly",
]);

/** Flexbox-like: children in a row or column. */
export const StackLayoutSchema = z.strictObject({
  mode: z.literal("stack"),
  /** Default: `"column"`. */
  direction: z.enum(["row", "column"]).optional(),
  gap: SpaceSchema.optional(),
  padding: PaddingSchema.optional(),
  /** Cross-axis alignment. Default: `"stretch"`. */
  align: AlignSchema.optional(),
  /** Main-axis distribution. Default: `"start"`. */
  justify: JustifySchema.optional(),
  wrap: z.boolean().optional(),
});

/** Equal-width columns; rows are added as needed. */
export const GridLayoutSchema = z.strictObject({
  mode: z.literal("grid"),
  columns: z.number().int().min(1).max(24),
  gap: SpaceSchema.optional(),
  /** Vertical gap between rows. Default: same as `gap`. */
  rowGap: SpaceSchema.optional(),
  padding: PaddingSchema.optional(),
  /** Vertical alignment of items within their cell. Default: `"stretch"`. */
  align: AlignSchema.optional(),
});

/** Children are placed with `position: { x, y }` relative to the frame's top-left. */
export const AbsoluteLayoutSchema = z.strictObject({
  mode: z.literal("absolute"),
  padding: PaddingSchema.optional(),
});

export const LayoutSchema = z.discriminatedUnion("mode", [
  StackLayoutSchema,
  GridLayoutSchema,
  AbsoluteLayoutSchema,
]);
export type Layout = z.infer<typeof LayoutSchema>;

export const FrameStyleSchema = z.strictObject({
  fill: PaintSchema.optional(),
  stroke: StrokeSchema.optional(),
  radius: RadiusSchema.optional(),
  shadow: ShadowValueSchema.optional(),
  /** Hide content that overflows the frame. Default: false. */
  clip: z.boolean().optional(),
});
export type FrameStyle = z.infer<typeof FrameStyleSchema>;

// ── Nodes ───────────────────────────────────────────────────────────────────────────

/** Fields every node has. Omitted optional fields mean "use the default". */
const nodeCommon = {
  id: IdSchema,
  /** Human-friendly label (layers panel, AI summaries). */
  name: z.string().max(200).optional(),
  hidden: z.boolean().optional(),
  /** Locked nodes can't be selected on the canvas (they can still be edited by ops). */
  locked: z.boolean().optional(),
  /** 0–1. Default: 1. */
  opacity: z.number().min(0).max(1).optional(),
  /** Degrees, clockwise. Default: 0. */
  rotation: z.number().min(-360).max(360).optional(),
  /** Default: `"hug"` (plugins may declare their own default, e.g. text fills width). */
  width: SizingSchema.optional(),
  height: SizingSchema.optional(),
  /**
   * Where the layer sits in its frame, from the frame's content box (inside its padding).
   * Used when the parent frame's layout is `absolute`, or when this layer is
   * `positioning: "free"`; ignored otherwise (see `isFreeLayer`).
   */
  position: PointSchema.optional(),
  /**
   * `"free"` takes the layer out of its stack/grid flow (Figma's "ignore auto layout"): it
   * sits at its own `position` on top of the flow, which closes up as if it weren't there.
   * Default: `"auto"` (placed by the parent's layout). No effect in `absolute` frames, whose
   * children are always free.
   */
  positioning: z.enum(["auto", "free"]).optional(),
};

/** Element types: built-ins are bare (`text`), third-party ones are namespaced (`acme.sparkles`). */
export const ELEMENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
export const ElementTypeSchema = z.string().max(100).regex(ELEMENT_TYPE_PATTERN, {
  error: 'Element types are lowercase, e.g. "text" or "acme.sparkles"',
});

export const ElementNodeSchema = z.strictObject({
  ...nodeCommon,
  kind: z.literal("element"),
  type: ElementTypeSchema,
  /** Validated by the plugin that owns `type`. Never contains `null` (null = delete in patches). */
  props: z.record(z.string(), z.unknown()),
});
export type ElementNode = z.infer<typeof ElementNodeSchema>;

const frameFields = {
  ...nodeCommon,
  kind: z.literal("frame"),
  layout: LayoutSchema,
  style: FrameStyleSchema.optional(),
};

/** A frame's own fields without its subtree (validate edits without re-walking children). */
export const FrameFieldsSchema = z.strictObject(frameFields);
export type FrameFields = z.infer<typeof FrameFieldsSchema>;

// The tree is recursive (frame → children → node → frame). TypeScript can't infer through that
// cycle, so the recursive types are declared by hand here, at the one place the cycle closes.
export type FrameNode = FrameFields & { children: Node[] };
export type Node = FrameNode | ElementNode;

export const FrameNodeSchema = z.strictObject({
  ...frameFields,
  get children(): z.ZodArray<z.ZodType<Node>> {
    return z.array(NodeSchema).max(1000);
  },
});

export const NodeSchema: z.ZodType<Node> = z.discriminatedUnion("kind", [
  FrameNodeSchema,
  ElementNodeSchema,
]);

/**
 * Whether a layer is placed by its own `position` rather than by its parent's layout: every
 * child of an `absolute` frame, and `positioning: "free"` children of stacks and grids.
 * `parent` is the parent frame's layout, or `null` for a slide's root (which always fills the
 * stage). The one rule the renderer, the editor, lint and MCP all share.
 */
export function isFreeLayer(node: Pick<Node, "positioning">, parent: Layout | null): boolean {
  if (parent === null) return false;
  return parent.mode === "absolute" || node.positioning === "free";
}

/** Deepest allowed nesting (root = depth 0). Guards renderers and recursion against abuse. */
export const MAX_DEPTH = 32;
