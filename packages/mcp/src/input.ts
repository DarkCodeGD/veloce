/**
 * Agent-friendly input: the shapes MCP tools accept, and their normalization into core nodes.
 *
 * Compared with core's strict schema, agents may:
 * - omit `kind` (a node with `children` is a frame; one with `type` is an element),
 * - omit `id` (one is generated and returned, so later calls can reference it),
 * - omit a frame's `layout` (a vertical stack) and an element's `props` (`{}`),
 * - write `{ "use": "<component>", "with": { … } }` anywhere a node goes (D94), or as a
 *   whole slide with a slide layout (D95): it's expanded here into a plain copy, so core
 *   ops and the undo log only see plain nodes.
 *
 * Everything else is validated exactly like any other edit, by core and the plugin registry.
 */
import {
  AnchorSchema,
  ComponentNameSchema,
  collectIds,
  componentNotFound,
  createId,
  DEFAULT_SLIDE_LAYOUT,
  type Deck,
  ElementTypeSchema,
  type ElementValidator,
  FrameStyleSchema,
  findComponent,
  IdSchema,
  instantiateComponent,
  instantiateSlide,
  LayoutSchema,
  type Node,
  OpSchema,
  PaintSchema,
  PointSchema,
  SizingSchema,
  type Slide,
  SlideSchema,
  VeloceError,
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

const WithSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Param values by name; a param left out keeps the component's own value.");

/** A copy of a saved component (D94), with its params and the root's own fields. */
const UseFieldsInput = z.strictObject({
  use: ComponentNameSchema.describe("A component's name (see list_components)."),
  with: WithSchema,
  ...nodeCommon,
  id: IdSchema.optional().describe(
    'The copy\'s ID; its inner nodes get "<id>-<their ID in the component>". Generated if omitted.',
  ),
});
export interface UseInput extends z.infer<typeof UseFieldsInput> {
  children?: NodeInput[] | undefined;
}
export const UseInputSchema = z.strictObject({
  ...UseFieldsInput.shape,
  get children(): z.ZodOptional<z.ZodArray<z.ZodType<NodeInput>>> {
    return z
      .array(NodeInputSchema)
      .max(1000)
      .optional()
      .describe("For a component with a slot: what goes in it, in place of its placeholder.");
  },
});

export type NodeInput = z.infer<typeof ElementInputSchema> | FrameInput | UseInput;
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
  UseInputSchema,
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
    'Layout of the slide\'s root frame. Default: a column centered top-to-bottom, with "$space.xl" padding and "$space.md" gap. Children stretch across; add align: "center" to center hug-width content.',
  ),
  style: FrameStyleSchema.optional().describe("Style of the slide's root frame."),
  use: ComponentNameSchema.optional().describe(
    'A slide layout to start from (D95), e.g. "Title and content" (see list_components). Its params go in `with`, and `children` fill its slot; leave out layout and style.',
  ),
  with: WithSchema,
  children: z
    .array(NodeInputSchema)
    .max(1000)
    .optional()
    .describe("The slide's content (with `use`: what goes in the layout's slot)."),
});
export type SlideInput = z.infer<typeof SlideInputSchema>;

/** The ops whose node/slide may use the shorthand above. */
const SHORTHAND_OPS = new Set(["slide.insert", "node.insert"]);

/**
 * Core ops, except inserts also accept the shorthand node/slide input above. Keyed on `op`, so
 * a bad op is checked against one schema only: a plain union also tried core's strict
 * `node.insert`, and its "kind/id missing" errors hid the real mistake (D70).
 */
export const OpInputSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("slide.insert"),
    slide: z.union([SlideInputSchema, SlideSchema]),
    index: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    op: z.literal("node.insert"),
    parentId: IdSchema,
    // A superset of core's node: kind, id and layout are optional.
    node: NodeInputSchema,
    index: z.number().int().min(0).optional(),
  }),
  ...OpSchema.options.filter((option) => !SHORTHAND_OPS.has(option.shape.op.value)),
]);
export type OpInput = z.infer<typeof OpInputSchema>;

// ── Normalization ───────────────────────────────────────────────────────────────────────

/**
 * IDs made up during normalization. The agent never saw them, so errors shouldn't name them
 * (they point at the node's place in the input instead).
 */
export type GeneratedIds = Set<string>;

export interface NormalizeContext {
  generated?: GeneratedIds;
  /** The deck the input goes into: its components expand `use` nodes. */
  deck?: Deck;
  /** Checks the values params write into elements, so a bad one is blamed on its param. */
  validateElement?: ElementValidator;
  /** IDs in use (filled from `deck` on first need): copies' inner IDs avoid them. */
  taken?: Set<string>;
}

export function normalizeNode(input: NodeInput, ctx: NormalizeContext = {}, at = "node"): Node {
  if ("use" in input) return expandUse(input, ctx, at);
  const { id: given, kind: _kind, ...rest } = input;
  let id = given;
  if (id === undefined) {
    id = createId("nd");
    ctx.generated?.add(id);
  }
  if ("children" in input) {
    const frame = rest as Omit<FrameInput, "id" | "kind">;
    return {
      ...frame,
      id,
      kind: "frame",
      layout: frame.layout ?? { mode: "stack" },
      children: frame.children.map((child, i) => normalizeNode(child, ctx, `${at}.children[${i}]`)),
    };
  }
  const element = rest as Omit<z.infer<typeof ElementInputSchema>, "id" | "kind">;
  return { ...element, id, kind: "element", props: element.props ?? {} };
}

/** A `use` node: a plain copy of the component, the root's own fields laid over it. */
function expandUse(input: UseInput, ctx: NormalizeContext, at: string): Node {
  const { use, with: values, id, children, ...fields } = input;
  const deck = ctx.deck ?? { components: undefined };
  const component = findComponent(deck, use);
  if (!component) throw componentNotFound(deck, use, `${at}.use`);
  if (component.slide) {
    throw new VeloceError("INVALID", `"${use}" is a slide layout, not a component`, {
      hint: `Start a slide from it: upsert_slide { "slide": { "use": "${use}", "with": { … } } }.`,
      path: `${at}.use`,
    });
  }
  ctx.taken ??= ctx.deck ? collectIds(ctx.deck) : new Set();
  const copy = instantiateComponent(use, component, {
    with: values,
    id,
    taken: ctx.taken,
    validateElement: ctx.validateElement,
    at,
    children: children?.map((child, i) => normalizeNode(child, ctx, `${at}.children[${i}]`)),
  });
  return { ...copy, ...fields };
}

export function normalizeSlide(input: SlideInput, ctx: NormalizeContext = {}, at = "slide"): Slide {
  const { id, layout, style, children, use, with: values, ...fields } = input;
  const slideId = id ?? createId("sl");
  const nodes = (list: NodeInput[] | undefined) =>
    list?.map((child, i) => normalizeNode(child, ctx, `${at}.children[${i}]`));
  if (use !== undefined) {
    if (layout || style) {
      throw new VeloceError(
        "INVALID",
        "A slide from a layout takes the layout's layout and style",
        {
          hint: "Leave out `layout` and `style` (or leave out `use` and describe the slide yourself).",
          path: `${at}.${layout ? "layout" : "style"}`,
        },
      );
    }
    const deck = ctx.deck ?? { components: undefined };
    const component = findComponent(deck, use);
    if (!component) throw componentNotFound(deck, use, `${at}.use`);
    ctx.taken ??= ctx.deck ? collectIds(ctx.deck) : new Set();
    const slide = instantiateSlide(use, component, slideId, {
      with: values,
      taken: ctx.taken,
      validateElement: ctx.validateElement,
      at,
      children: nodes(children),
    });
    return { ...slide, ...fields };
  }
  if (values !== undefined) {
    throw new VeloceError("INVALID", "`with` needs `use`: params belong to a slide layout", {
      hint: 'Add "use": "<layout name>", or leave out `with`.',
      path: `${at}.with`,
    });
  }
  return {
    id: slideId,
    ...fields,
    root: {
      id: createId("nd"),
      kind: "frame",
      layout: layout ?? DEFAULT_SLIDE_LAYOUT,
      ...(style && { style }),
      children: nodes(children) ?? [],
    },
  };
}

export function normalizeOp(input: OpInput, ctx: NormalizeContext = {}, at = "ops[0]"): unknown {
  if (input.op === "slide.insert" && "slide" in input && !("root" in input.slide)) {
    return { ...input, slide: normalizeSlide(input.slide as SlideInput, ctx, `${at}.slide`) };
  }
  if (input.op === "node.insert") {
    return { ...input, node: normalizeNode(input.node as NodeInput, ctx, `${at}.node`) };
  }
  return input;
}
