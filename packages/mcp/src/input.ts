/**
 * Agent-friendly input: the shapes MCP tools accept, and their normalization into core nodes.
 *
 * Compared with core's strict schema, agents may:
 * - omit `kind` (a node with `children` is a frame; one with `type` is an element),
 * - omit `id` (one is generated and returned, so later calls can reference it),
 * - omit a frame's `layout` (a vertical stack) and an element's `props` (`{}`).
 *
 * Everything else is validated exactly like any other edit, by core and the plugin registry.
 */
import {
  AnchorSchema,
  createId,
  DEFAULT_SLIDE_LAYOUT,
  ElementTypeSchema,
  FrameStyleSchema,
  IdSchema,
  LayoutSchema,
  type Node,
  OpSchema,
  PaintSchema,
  PointSchema,
  SizingSchema,
  type Slide,
} from "@veloce/core";
import { z } from "zod";

const nodeCommon = {
  id: IdSchema.optional().describe("Optional; generated if omitted. Unique across the deck."),
  name: z.string().max(200).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  width: SizingSchema.optional().describe(
    'Pixels, "fill" (take free space) or "hug" (fit content).',
  ),
  height: SizingSchema.optional().describe('Pixels, "fill" or "hug".'),
  position: PointSchema.optional().describe(
    'From the frame\'s content box. Used inside "absolute" frames, or with positioning: "free".',
  ),
  anchor: AnchorSchema.optional().describe(
    'Which frame edges `position` is measured from (free layers): x "start" | "center" | "end", y the same. { x: "end" } + position.x 16 = 16px in from the right; "center" = offset from the middle. Default left/top. Pins badges to corners when sizes change.',
  ),
  positioning: z
    .enum(["auto", "free"])
    .optional()
    .describe(
      '"free": leave the stack/grid flow and sit at `position` on top of it (badges, stickers, overlays). Default "auto".',
    ),
};

export const ElementInputSchema = z.strictObject({
  ...nodeCommon,
  kind: z.literal("element").optional(),
  type: ElementTypeSchema.describe(
    'Element type, e.g. "text", "shape", "image" (see list_element_types).',
  ),
  props: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Validated by the element type's schema."),
});

export type NodeInput = z.infer<typeof ElementInputSchema> | FrameInput;
export interface FrameInput extends Omit<z.infer<typeof FrameFieldsInput>, "children"> {
  children: NodeInput[];
}

const FrameFieldsInput = z.strictObject({
  ...nodeCommon,
  kind: z.literal("frame").optional(),
  layout: LayoutSchema.optional().describe('Default: { "mode": "stack" } (a vertical stack).'),
  style: FrameStyleSchema.optional(),
});

export const FrameInputSchema = z.strictObject({
  ...FrameFieldsInput.shape,
  get children(): z.ZodArray<z.ZodType<NodeInput>> {
    return z.array(NodeInputSchema).max(1000);
  },
});

export const NodeInputSchema: z.ZodType<NodeInput> = z.union([
  FrameInputSchema,
  ElementInputSchema,
]);

export const SlideInputSchema = z.strictObject({
  id: IdSchema.optional().describe(
    "Existing slide ID to replace it, a new ID, or omit to generate.",
  ),
  name: z.string().max(200).optional(),
  background: PaintSchema.optional().describe('Default "$color.background".'),
  notes: z.string().max(50_000).optional().describe("Speaker notes."),
  hidden: z.boolean().optional(),
  layout: LayoutSchema.optional().describe(
    'Layout of the slide\'s root frame. Default: a centered column with "$space.xl" padding and "$space.md" gap.',
  ),
  style: FrameStyleSchema.optional().describe("Style of the slide's root frame."),
  children: z.array(NodeInputSchema).max(1000).describe("The slide's content."),
});
export type SlideInput = z.infer<typeof SlideInputSchema>;

/** Core ops, except inserts also accept the shorthand node/slide input above. */
export const OpInputSchema = z.union([
  z.strictObject({
    op: z.literal("slide.insert"),
    slide: SlideInputSchema,
    index: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    op: z.literal("node.insert"),
    parentId: IdSchema,
    node: NodeInputSchema,
    index: z.number().int().min(0).optional(),
  }),
  OpSchema,
]);
export type OpInput = z.infer<typeof OpInputSchema>;

// ── Normalization ───────────────────────────────────────────────────────────────────────

export function normalizeNode(input: NodeInput): Node {
  const { id, kind: _kind, ...rest } = input;
  if ("children" in input) {
    const frame = rest as Omit<FrameInput, "id" | "kind">;
    return {
      ...frame,
      id: id ?? createId("nd"),
      kind: "frame",
      layout: frame.layout ?? { mode: "stack" },
      children: frame.children.map(normalizeNode),
    };
  }
  const element = rest as Omit<z.infer<typeof ElementInputSchema>, "id" | "kind">;
  return { ...element, id: id ?? createId("nd"), kind: "element", props: element.props ?? {} };
}

export function normalizeSlide(input: SlideInput): Slide {
  const { id, layout, style, children, ...fields } = input;
  return {
    id: id ?? createId("sl"),
    ...fields,
    root: {
      id: createId("nd"),
      kind: "frame",
      layout: layout ?? DEFAULT_SLIDE_LAYOUT,
      ...(style && { style }),
      children: children.map(normalizeNode),
    },
  };
}

export function normalizeOp(input: OpInput): unknown {
  if (input.op === "slide.insert" && "slide" in input && !("root" in input.slide)) {
    return { ...input, slide: normalizeSlide(input.slide as SlideInput) };
  }
  if (input.op === "node.insert") {
    return { ...input, node: normalizeNode(input.node as NodeInput) };
  }
  return input;
}
