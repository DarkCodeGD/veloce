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
  findSlide,
  formatIssues,
  formatPath,
  IdSchema,
  importSvg,
  instantiateComponent,
  instantiateSlide,
  LayoutSchema,
  MAX_SVG_LENGTH,
  MatchKeySchema,
  MotionLevelSchema,
  type Node,
  OpSchema,
  PaintSchema,
  PointSchema,
  SectionNameSchema,
  SizingSchema,
  type Slide,
  SlideSchema,
  TransitionSchema,
  VeloceError,
  walkNodes,
} from "@veloce/core";
import { z } from "zod";
import {
  AnimationInputSchema,
  animationIdMaker,
  normalizeAnimation,
  type StepPaths,
  StepsInputSchema,
  stepsToAnimations,
} from "./motion.js";

const nodeCommon = {
  id: IdSchema.optional().describe("Optional; generated if omitted. Unique across the deck."),
  name: z.string().max(200).optional(),
  matchKey: MatchKeySchema.optional().describe(
    'Morph: layers with the same matchKey on two slides are the same thing, and the morph transition moves one into the other (e.g. "logo", "hero-title"). One per slide. Layers without one pair by name and type.',
  ),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  depth: z
    .number()
    .min(-10_000)
    .max(10_000)
    .optional()
    .describe(
      "2.5D: stage pixels towards the viewer (negative: away). Shows only inside a frame with a `perspective`; layer order still decides what's in front.",
    ),
  width: SizingSchema.optional().describe(
    'Pixels, "fill" (take free space) or "hug" (fit content).',
  ),
  height: SizingSchema.optional().describe('Pixels, "fill" or "hug".'),
  position: PointSchema.optional().describe(
    'From the frame\'s outer edges: its padding doesn\'t apply (on a slide, { "x": 96, "y": 64 } sits inside the usual margin). Used inside "absolute" frames, or with positioning: "free".',
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
    'Element type, e.g. "text", "shape", "line", "vector", "image" (see list_element_types).',
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

/**
 * An SVG file's text, imported as vector layers (D127 §4): never inlined. Sized by
 * `width`/`height` in pixels (it keeps its proportions); the rest of the root's fields apply.
 */
export const SvgInputSchema = z.strictObject({
  svg: z
    .string()
    .max(MAX_SVG_LENGTH)
    .describe(
      "An SVG file's text, imported as vector layers (paths, shapes, colors, gradients). Scripts, text, images and links are left out; the result says what. width or height in pixels sizes it, keeping its proportions. currentColor becomes $color.text.",
    ),
  // Placing a drawing needs few fields; the rest can be set with node.update afterwards.
  id: nodeCommon.id,
  name: nodeCommon.name,
  matchKey: nodeCommon.matchKey,
  width: nodeCommon.width,
  height: nodeCommon.height,
  position: nodeCommon.position,
  positioning: nodeCommon.positioning,
});
export type SvgInput = z.infer<typeof SvgInputSchema>;

export type NodeInput = z.infer<typeof ElementInputSchema> | FrameInput | UseInput | SvgInput;
export interface FrameInput extends Omit<z.infer<typeof FrameFieldsInput>, "children"> {
  children: NodeInput[];
}

const PerspectiveInput = z
  .number()
  .min(100)
  .max(100_000)
  .optional()
  .describe(
    "2.5D: the viewer's distance for this frame's own children (their `depth`, and 3D turns), in stage pixels. 800 is strong, 2000 gentle. Default: flat.",
  );

const FrameFieldsInput = z.strictObject({
  ...nodeCommon,
  kind: z.literal("frame").optional(),
  layout: LayoutSchema.optional().describe('Default: { "mode": "stack" } (a vertical stack).'),
  style: FrameStyleSchema.optional(),
  perspective: PerspectiveInput,
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
  SvgInputSchema,
]);

export const SlideInputSchema = z.strictObject({
  id: IdSchema.optional().describe(
    "Existing slide ID to replace it, a new ID, or omit to generate.",
  ),
  name: z.string().max(200).optional(),
  background: PaintSchema.optional().describe('Default "$color.background".'),
  notes: z.string().max(50_000).optional().describe("Speaker notes."),
  hidden: z.boolean().optional(),
  section: SectionNameSchema.optional().describe(
    'Starts a named section at this slide (e.g. "Results"): it runs until the next slide with a section.',
  ),
  hideFooter: z
    .boolean()
    .optional()
    .describe("Leaves the deck's footer off this slide (title and section header slides)."),
  transition: TransitionSchema.optional().describe(
    'How this slide arrives: { "type": "fade" | "push" | "zoom" | "morph" | "none", "duration"?, "easing"?, "direction"? (push only) }. Omit it to use the theme\'s signature transition. "morph" glides layers with the same matchKey from the slide before. See get_docs("transitions").',
  ),
  layout: LayoutSchema.optional().describe(
    'Layout of the slide\'s root frame. Default: a column centered top-to-bottom, with "$space.xl" padding and "$space.md" gap. Children stretch across; add align: "center" to center hug-width content.',
  ),
  style: FrameStyleSchema.optional().describe("Style of the slide's root frame."),
  perspective: PerspectiveInput,
  motionLevel: MotionLevelSchema.optional().describe(
    "This slide's own motion level, over the deck's: calm | subtle | lively | intense | absurd.",
  ),
  // Listed light (the full step schema would double this tool's listing), checked in full
  // with StepsInputSchema when the slide is normalized.
  steps: z
    .array(z.array(z.record(z.string(), z.unknown())))
    .optional()
    .describe(
      'Its animations, in one call: steps[0] plays as the slide appears, each later step is one click, e.g. [[{ "target": "title", "effect": "fade-in" }], [{ "target": "chart", "effect": "scale-in" }]]. Replaces the slide\'s animations; omit to keep those of layers still on it. Or animate later with set_animations. get_docs("animation").',
    ),
  use: ComponentNameSchema.optional().describe(
    'A slide layout to start from, e.g. "Title and content" (see list_components). Its params go in `with`, and `children` fill its slot; leave out layout and style.',
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
const SHORTHAND_OPS = new Set(["slide.insert", "node.insert", "animation.insert"]);

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
  z.strictObject({
    op: z.literal("animation.insert"),
    slideId: IdSchema,
    // A superset of core's animation: id optional, an effect by name alone.
    animation: AnimationInputSchema,
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
  /** Slides inserted earlier in this batch → their root frame's ID (a slide ID as parentId). */
  slideRoots?: Map<string, string>;
  /**
   * Filled when a slide's `steps` become its animations: where each stored animation came
   * from in the input (`slide.steps[1][0]`), so an error points at what the agent wrote.
   */
  stepPaths?: Map<string, StepPaths>;
  /** Filled by SVG imports: what each one left out, for the tool's result (D127 §4). */
  notes?: string[];
}

/**
 * Field runs may leave out `text` (D97): agents write `{ "field": "slideNumber" }`, and core
 * keeps what a field last showed in `text`, so it's filled in as "" here. Only objects in a
 * `runs` list count, so another plugin's own `field` key is left alone. Returns the same
 * value when there's nothing to fill.
 */
export function withFieldText<T>(value: T, key?: string): T {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      let next = withFieldText(item);
      if (
        key === "runs" &&
        next &&
        typeof next === "object" &&
        typeof (next as { field?: unknown }).field === "string" &&
        !("text" in next)
      ) {
        next = { ...next, text: "" };
      }
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? items : value) as T;
  }
  if (!value || typeof value !== "object") return value;
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(value)) {
    const next = withFieldText(v, k);
    if (next !== v) {
      out ??= { ...(value as Record<string, unknown>) };
      out[k] = next;
    }
  }
  return (out ?? value) as T;
}

export function normalizeNode(input: NodeInput, ctx: NormalizeContext = {}, at = "node"): Node {
  if ("use" in input) return expandUse(input, ctx, at);
  if ("svg" in input) return expandSvg(input, ctx, at);
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

/** An `svg` node: the file imported as vector layers, the root's own fields laid over it. */
function expandSvg(input: SvgInput, ctx: NormalizeContext, at: string): Node {
  const { svg, id, ...fields } = input;
  const size = (v: unknown) => (typeof v === "number" ? v : undefined);
  const width = size(fields.width);
  const height = size(fields.height);
  const result = importSvg(svg, {
    ...(width !== undefined && { width }),
    ...(height !== undefined && { height }),
    ...(fields.name !== undefined && { name: fields.name }),
  });
  if (!result.ok) {
    const left = result.leftOut.length ? ` Left out: ${result.leftOut.join("; ")}.` : "";
    throw new VeloceError("INVALID", `${result.message}${left}`, {
      hint: 'Send a plain SVG (paths and basic shapes, no DOCTYPE), or draw it as a vector with path data: get_docs("element/vector").',
      path: `${at}.svg`,
    });
  }
  const node = result.node;
  for (const { node: inner } of walkNodes(node)) ctx.generated?.add(inner.id);
  if (id !== undefined) {
    ctx.generated?.delete(node.id);
    node.id = id;
  }
  if (result.leftOut.length > 0) {
    ctx.notes?.push(`SVG at ${at}: left out ${result.leftOut.join("; ")}.`);
  }
  // A size in pixels was the import's; "fill" or "hug" sit on the root as asked.
  const { width: w, height: h, ...rest } = fields;
  return {
    ...node,
    ...rest,
    ...(typeof w === "string" && { width: w }),
    ...(typeof h === "string" && { height: h }),
  } as Node;
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

export function normalizeSlide(raw: SlideInput, ctx: NormalizeContext = {}, at = "slide"): Slide {
  const { steps, perspective, ...rest } = withFieldText(raw);
  const slide = normalizeSlideContent(rest, ctx, at);
  const root = perspective === undefined ? slide.root : { ...slide.root, perspective };
  if (steps === undefined) return { ...slide, root };
  // Its animations, from steps (D126): readable IDs, clear of the slide's own node IDs.
  ctx.taken ??= ctx.deck ? collectIds(ctx.deck) : new Set();
  const taken = new Set(ctx.taken);
  for (const { node } of walkNodes(root)) taken.add(node.id);
  const newId = animationIdMaker(ctx.deck ?? EMPTY_DECK, slide.id, [], taken);
  const parsed = StepsInputSchema.safeParse(steps);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new VeloceError("INVALID", formatIssues(parsed.error.issues, [`${at}.steps`]), {
      path: `${at}.steps${formatPath(issue?.path ?? []).replace(/^(?=[^[])/, ".")}`,
      hint: 'Each step is a list of { "target", "effect" } (or "tracks"); see get_docs("animation").',
    });
  }
  const { animations, paths } = stepsToAnimations(parsed.data, newId, `${at}.steps`);
  ctx.stepPaths?.set(slide.id, paths);
  for (const animation of animations) ctx.taken.add(animation.id);
  const { animations: _old, ...fields } = slide;
  return { ...fields, root, ...(animations.length > 0 && { animations }) };
}

/** `animationIdMaker` with no deck: the IDs to avoid are given. */
const EMPTY_DECK = { slides: [] } as unknown as Deck;

function normalizeSlideContent(
  raw: Omit<SlideInput, "steps" | "perspective">,
  ctx: NormalizeContext,
  at: string,
): Slide {
  const { id, layout, style, children, use, with: values, ...fields } = raw;
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
    // Free layers (a corner label, a sticker) sit on the slide, measured from its edges, as
    // a floating shape does in PowerPoint; the rest fill the slot. So a layout without a slot
    // takes them too.
    const given = nodes(children);
    const free = given?.filter((n) => n.positioning === "free") ?? [];
    const flow = given?.filter((n) => n.positioning !== "free");
    const slide = instantiateSlide(use, component, slideId, {
      with: values,
      taken: ctx.taken,
      validateElement: ctx.validateElement,
      at,
      children: flow?.length || !free.length ? flow : undefined,
    });
    const root = free.length
      ? { ...slide.root, children: [...slide.root.children, ...free] }
      : slide.root;
    return { ...slide, root, ...fields };
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

export function normalizeOp(raw: OpInput, ctx: NormalizeContext = {}, at = "ops[0]"): unknown {
  const input = withFieldText(raw);
  ctx.slideRoots ??= new Map();
  if (input.op === "slide.insert" && "slide" in input) {
    const slide =
      "root" in input.slide
        ? (input.slide as Slide)
        : normalizeSlide(input.slide as SlideInput, ctx, `${at}.slide`);
    ctx.slideRoots.set(slide.id, slide.root.id);
    return { ...input, slide };
  }
  if (input.op === "node.insert") {
    return {
      ...input,
      parentId: parentFrameId(input.parentId, ctx),
      node: normalizeNode(input.node as NodeInput, ctx, `${at}.node`),
    };
  }
  if (input.op === "node.move") return { ...input, parentId: parentFrameId(input.parentId, ctx) };
  // An effect by name in a patch, as in an insert: a new effect starts without the old
  // one's settings (they belong to the old effect), as the editor's Effect picker does.
  if (input.op === "animation.update" && typeof input.set.effect === "string") {
    return { ...input, set: { ...input.set, effect: { name: input.set.effect, params: null } } };
  }
  if (input.op === "animation.insert" && "animation" in input) {
    ctx.taken ??= ctx.deck ? collectIds(ctx.deck) : new Set();
    const newId = animationIdMaker(ctx.deck ?? EMPTY_DECK, input.slideId, [], ctx.taken);
    const animation = normalizeAnimation(input.animation, newId, `${at}.animation`);
    ctx.taken.add(animation.id);
    // Errors shouldn't name an ID the agent never saw (results still list it).
    if (input.animation.id === undefined) ctx.generated?.add(animation.id);
    return { ...input, animation };
  }
  return input;
}

/**
 * A slide's ID as a parent means its root frame: the root's ID is generated, and a slide
 * inserted in the same batch has a root the agent can't know yet.
 */
function parentFrameId(id: string, ctx: NormalizeContext): string {
  const inserted = ctx.slideRoots?.get(id);
  if (inserted) return inserted;
  return (ctx.deck && findSlide(ctx.deck, id)?.slide.root.id) ?? id;
}
