/**
 * The MCP tools. Few, high-leverage and batch-friendly:
 * - `upsert_slide` builds a whole slide per call; `apply_ops` batches any edits atomically.
 * - Every edit returns lint for the slides it changed, so problems surface immediately.
 * - Errors say what was wrong and how to fix the call.
 *
 * Agents act through the same transactions as humans (golden rule #1), with origin
 * `agent:<client name>`, so their changes have their own undo history.
 */
import {
  type AgentOrigin,
  BUILTIN_THEMES,
  type Deck,
  findBuiltinTheme,
  findSlide,
  formatIssues,
  lintDeck,
  type Node,
  notFoundHint,
  type Op,
  type SlideMeasurement,
  type Theme,
  ThemeSchema,
  VeloceError,
  walkNodes,
} from "@veloce/core";
import type { OpenDeck, RenderService, Workspace } from "@veloce/doc-server";
import type { PluginRegistry } from "@veloce/plugin-api";
import { z } from "zod";
import { docTopics, getDocs, paletteLine } from "./docs.js";
import { normalizeOp, normalizeSlide, OpInputSchema, SlideInputSchema } from "./input.js";
import { boundsTable, deckSummary, formatLint, slideOutline } from "./summary.js";

export interface ToolContext {
  workspace: Workspace;
  registry: PluginRegistry;
  /** Headless renderer, or `null` when unavailable (then visual checks are skipped). */
  render: RenderService | null;
  /** Why `render` is null, shown to agents. */
  renderUnavailable?: string;
  origin: AgentOrigin;
  /** State of this MCP session (one agent connection). */
  session: AgentSession;
}

/**
 * What one agent connection has done. Agents may only rebuild slides they created in this
 * session: everything else (the user's slides, earlier sessions', other agents') is protected,
 * across server restarts too, because the set starts empty for every connection.
 */
export class AgentSession {
  readonly #created = new Set<string>();

  created(deckId: string, slideId: string): boolean {
    return this.#created.has(`${deckId}/${slideId}`);
  }

  markCreated(deckId: string, slideIds: Iterable<string>): void {
    for (const id of slideIds) this.#created.add(`${deckId}/${id}`);
  }
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** JSON Schema shown to agents when the generated one would be too big for their context. */
  displaySchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

const defineTool = <S extends z.ZodType>(tool: ToolDefinition<S>) =>
  tool as unknown as ToolDefinition;

// ── Helpers ─────────────────────────────────────────────────────────────────────────────

const text = (...parts: string[]): ToolResult => ({
  content: [{ type: "text", text: parts.filter(Boolean).join("\n\n") }],
});

/** Anything with a message (and maybe where/how to fix it): `ErrorInfo`, or ad hoc. */
export interface ErrorLike {
  message: string;
  hint?: string | undefined;
  path?: string | undefined;
}

export function errorResult(error: ErrorLike | string): ToolResult {
  const info: ErrorLike = typeof error === "string" ? { message: error } : error;
  const lines = [`Error: ${info.message}`];
  if (info.path) lines.push(`At: ${info.path}`);
  if (info.hint) lines.push(`How to fix: ${info.hint}`);
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}

class ToolError extends Error {
  constructor(readonly info: ErrorLike) {
    super(info.message);
  }
}

async function currentDeck(ctx: ToolContext): Promise<OpenDeck> {
  const id = ctx.workspace.activeDeckId;
  if (!id) {
    throw new VeloceError("NOT_FOUND", "No deck is open", {
      hint: "Create one with create_deck, or list_decks then open_deck.",
    });
  }
  return ctx.workspace.get(id);
}

function requireSlide(deck: Deck, slideId: string) {
  const found = findSlide(deck, slideId);
  if (!found) {
    throw new VeloceError("NOT_FOUND", `No slide with ID "${slideId}"`, {
      hint: notFoundHint(
        slideId,
        deck.slides.map((s) => s.id),
        "slide",
      ),
    });
  }
  return found;
}

/** Measure (if a renderer is available) and lint. Never fails: visual problems degrade to a note. */
async function lintReport(
  ctx: ToolContext,
  open: OpenDeck,
  slideIds?: readonly string[],
): Promise<string> {
  const deck = open.deck;
  let measurements: Map<string, SlideMeasurement> | undefined;
  let visual: string | true = ctx.renderUnavailable ?? "no renderer";
  if (ctx.render) {
    try {
      const measured = await ctx.render.measure(deck, {
        deckId: open.id,
        ...(slideIds && { slideIds }),
      });
      measurements = new Map(measured.map((m) => [m.slideId, m]));
      visual = true;
    } catch (error) {
      visual = `renderer failed (${error instanceof Error ? error.message : String(error)})`;
    }
  }
  const issues = lintDeck(deck, {
    ...(slideIds && { slideIds }),
    ...(measurements && { measurements }),
  });
  return formatLint(issues, visual);
}

/** Slides that are new or changed between two versions (core copies only what changes). */
function changedSlides(before: Deck, after: Deck): string[] {
  const old = new Set(before.slides);
  return after.slides.filter((s) => !old.has(s)).map((s) => s.id);
}

async function commit(
  ctx: ToolContext,
  open: OpenDeck,
  label: string,
  ops: unknown[],
): Promise<{ before: Deck; after: Deck }> {
  const before = open.deck;
  const result = open.apply({ origin: ctx.origin, label, ops });
  if (!result.ok) {
    const at = result.error.opIndex !== undefined ? `ops[${result.error.opIndex}]` : undefined;
    throw new ToolError({ ...result.error, ...(at && !result.error.path && { path: at }) });
  }
  const existed = new Set(before.slides.map((s) => s.id));
  ctx.session.markCreated(
    open.id,
    result.deck.slides.filter((s) => !existed.has(s.id)).map((s) => s.id),
  );
  return { before, after: result.deck };
}

// ── Tools ───────────────────────────────────────────────────────────────────────────────

const getDeckSummary = defineTool({
  name: "get_deck_summary",
  title: "Get deck summary",
  description:
    "Outline of the current deck: title, theme, and every slide with its node tree (IDs, element types, text snippets). Start here.",
  input: z.strictObject({}),
  annotations: { readOnlyHint: true },
  async run(_args, ctx) {
    return text(deckSummary((await currentDeck(ctx)).deck));
  },
});

const getSlide = defineTool({
  name: "get_slide",
  title: "Get slide",
  description:
    "Full JSON of one slide (all props), plus where each node ended up after layout (x,y width×height in stage pixels).",
  input: z.strictObject({ slideId: z.string() }),
  annotations: { readOnlyHint: true },
  async run({ slideId }, ctx) {
    const open = await currentDeck(ctx);
    const { slide } = requireSlide(open.deck, slideId);
    const parts = [JSON.stringify(slide)];
    if (ctx.render) {
      try {
        const [m] = await ctx.render.measure(open.deck, { deckId: open.id, slideIds: [slideId] });
        if (m)
          parts.push(
            `Measured layout (stage ${m.stage.width}×${m.stage.height}):\n${boundsTable(m)}`,
          );
      } catch {
        // Layout info is a bonus; the slide JSON is what was asked for.
      }
    }
    return text(...parts);
  },
});

const upsertSlide = defineTool({
  name: "upsert_slide",
  title: "Create or replace a slide",
  description: [
    "Create a slide, or replace an existing one (same slide ID), in one call.",
    'Describe structure: nodes are elements { "type", "props" } or frames { "layout", "style", "children" }. The slide itself is a frame (default: a centered column).',
    "Omitted IDs are generated and returned; give stable IDs to nodes you may change later.",
    "Replacing rebuilds the whole slide: to fix or tweak an existing slide, use apply_ops (node.update by ID) instead.",
    "Returns the slide outline and lint issues to fix.",
    'Example: { "slide": { "children": [ { "type": "text", "props": { "content": "Hello", "style": "$text.display" } } ] } }',
  ].join(" "),
  input: z.strictObject({
    slide: SlideInputSchema,
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Position in the deck (0 = first). Default: keep position, or last for new slides.",
      ),
    overwrite: z
      .boolean()
      .optional()
      .describe(
        "Replace a slide the user (or another agent) edited last. Only when they asked for a redo.",
      ),
  }),
  async run({ slide: input, index, overwrite }, ctx) {
    const open = await currentDeck(ctx);
    const normalized = normalizeSlide(input);
    const existing = findSlide(open.deck, normalized.id);
    if (existing && !overwrite) {
      const editor = open.lastEditor(normalized.id);
      const who =
        editor && editor !== ctx.origin
          ? `was last edited by ${editor === "user" ? "the user" : editor}`
          : !ctx.session.created(open.id, normalized.id)
            ? "existed before this session (the user's work or an earlier session's)"
            : null;
      if (who) {
        throw new ToolError({
          message: `Slide ${normalized.id} ${who}; replacing it would discard that work.`,
          hint: "Change specific nodes with apply_ops (node.update / node.insert / node.remove by ID), or add a new slide with a new ID. Pass overwrite: true only if the user asked you to redo this slide.",
        });
      }
    }
    // Replacing keeps the slide's root frame ID, so references to the slide frame stay valid.
    const slide = existing
      ? { ...normalized, root: { ...normalized.root, id: existing.slide.root.id } }
      : normalized;
    const ops: Op[] = existing
      ? [
          { op: "slide.remove", id: slide.id },
          {
            op: "slide.insert",
            slide,
            index: Math.min(index ?? existing.index, open.deck.slides.length - 1),
          },
        ]
      : [
          {
            op: "slide.insert",
            slide,
            ...(index !== undefined && { index: Math.min(index, open.deck.slides.length) }),
          },
        ];
    const label = `${existing ? "Replace" : "Add"} slide ${slide.name ? `"${slide.name}"` : slide.id}`;
    const { after } = await commit(ctx, open, label, ops);
    ctx.session.markCreated(open.id, [slide.id]); // rebuilt by this session: its own now
    const position = after.slides.findIndex((s) => s.id === slide.id);
    const saved = after.slides[position];
    return text(
      `${label}: done.`,
      saved ? slideOutline(saved, position) : "",
      await lintReport(ctx, open, [slide.id]),
    );
  },
});

const OP_TYPES = [
  "slide.insert",
  "slide.remove",
  "slide.move",
  "slide.update",
  "node.insert",
  "node.remove",
  "node.move",
  "node.update",
  "deck.updateMeta",
] as const;

const applyOps = defineTool({
  name: "apply_ops",
  title: "Apply edits",
  description: [
    "Apply a batch of edits atomically (all or nothing) as one undoable step.",
    'Ops: slide.insert/remove/move/update, node.insert/remove/move/update, deck.updateMeta. node.update uses JSON Merge Patch: { "op": "node.update", "id": "title", "set": { "props": { "content": "New" } } } (null deletes a field).',
    'Full reference: get_docs("ops"). Returns lint issues for the slides that changed.',
  ].join(" "),
  input: z.strictObject({
    label: z.string().min(1).max(200),
    ops: z.array(OpInputSchema).min(1).max(1000),
  }),
  displaySchema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: 'Short description for the undo history, e.g. "Shorten bullet text".',
      },
      ops: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: { op: { type: "string", enum: OP_TYPES } },
          required: ["op"],
          additionalProperties: true,
        },
      },
    },
    required: ["label", "ops"],
    additionalProperties: false,
  },
  async run({ label, ops: inputs }, ctx) {
    const open = await currentDeck(ctx);
    const ops = inputs.map(normalizeOp);
    const { before, after } = await commit(ctx, open, label, ops);
    const created = ops.flatMap((op) => {
      const node = (op as { op: string; node?: Node }).node;
      return node ? [...walkNodes(node)].map((n) => n.node.id) : [];
    });
    const changed = changedSlides(before, after);
    return text(
      `Applied "${label}" (${ops.length} op${ops.length === 1 ? "" : "s"}).${created.length ? ` New node IDs: ${created.join(", ")}.` : ""}`,
      changed.length ? await lintReport(ctx, open, changed) : "",
    );
  },
});

const listElementTypes = defineTool({
  name: "list_element_types",
  title: "List element types",
  description:
    'Element types you can use (from installed plugins) with their props schemas. Usage guide per type: get_docs("element/<type>").',
  input: z.strictObject({}),
  annotations: { readOnlyHint: true },
  async run(_args, ctx) {
    const types = ctx.registry.describeAll().map((t) => {
      const { $schema: _, ...schema } = t.propsJsonSchema;
      return `## ${t.type}: ${t.description}\nprops schema: ${JSON.stringify(schema)}`;
    });
    return text(...types);
  },
});

const ThemeOverrides = z.strictObject({
  base: z.string().optional().describe("Built-in theme to start from. Default: the current theme."),
  name: z.string().min(1).max(100).optional(),
  colors: z.record(z.string(), z.string()).optional(),
  fonts: z.record(z.string(), z.string()).optional(),
  text: z.record(z.string(), z.unknown()).optional(),
  space: z.record(z.string(), z.number()).optional(),
  radius: z.record(z.string(), z.number()).optional(),
  shadow: z.record(z.string(), z.unknown()).optional(),
});

function resolveTheme(input: string | z.infer<typeof ThemeOverrides>, current: Theme): Theme {
  const builtin = (name: string) => {
    const theme = findBuiltinTheme(name);
    if (!theme) {
      throw new VeloceError("NOT_FOUND", `No built-in theme "${name}"`, {
        hint: `Built-in themes: ${Object.keys(BUILTIN_THEMES).join(", ")}.`,
      });
    }
    return theme;
  };
  if (typeof input === "string") return builtin(input);
  const { base: baseName, name, ...groups } = input;
  const base = baseName ? builtin(baseName) : current;
  const merged: Record<string, unknown> = {
    ...base,
    name: name ?? (baseName || !Object.keys(groups).length ? base.name : `${base.name} (custom)`),
  };
  for (const [group, values] of Object.entries(groups)) {
    merged[group] = { ...(base[group as keyof Theme] as object), ...values };
  }
  const parsed = ThemeSchema.safeParse(merged);
  if (!parsed.success) {
    throw new VeloceError(
      "INVALID",
      `Invalid theme: ${formatIssues(parsed.error.issues, ["theme"])}`,
      {
        hint: 'Colors are hex like "#4f46e5"; text styles need { font, size, weight, lineHeight }.',
      },
    );
  }
  return parsed.data;
}

const setTheme = defineTool({
  name: "set_theme",
  title: "Set theme",
  description: `Restyle the whole deck. Built-in themes: ${Object.entries(BUILTIN_THEMES)
    .map(([id, t]) => `"${id}" (${t.name})`)
    .join(
      ", ",
    )}. Or override tokens on a base theme, e.g. brand colors: { "theme": { "base": "light", "colors": { "primary": "#e11d48" } } }. Token reference: get_docs("theme").`,
  input: z.strictObject({ theme: z.union([z.string(), ThemeOverrides]) }),
  async run({ theme: input }, ctx) {
    const open = await currentDeck(ctx);
    const theme = resolveTheme(input, open.deck.theme);
    await commit(ctx, open, `Set theme "${theme.name}"`, [{ op: "deck.setTheme", theme }]);
    return text(`Theme is now "${theme.name}".`, paletteLine(theme), await lintReport(ctx, open));
  },
});

const lint = defineTool({
  name: "lint",
  title: "Lint deck",
  description:
    "Check slides for problems: text overflow, content off the slide, overlaps, low contrast, tiny text, empty slides, too much text, bad alt text. Each issue names the nodes and how to fix it.",
  input: z.strictObject({
    slideIds: z.array(z.string()).optional().describe("Default: all slides."),
  }),
  annotations: { readOnlyHint: true },
  async run({ slideIds }, ctx) {
    const open = await currentDeck(ctx);
    for (const id of slideIds ?? []) requireSlide(open.deck, id);
    return text(await lintReport(ctx, open, slideIds));
  },
});

const renderPreview = defineTool({
  name: "render_preview",
  title: "Render slide preview",
  description:
    "Screenshot of a slide as the audience will see it. Use it to check visual balance after lint is clean, especially for slides with images or custom layouts.",
  input: z.strictObject({
    slideId: z.string(),
    width: z
      .number()
      .int()
      .min(320)
      .max(1920)
      .optional()
      .describe("Image width in pixels. Default 960."),
  }),
  annotations: { readOnlyHint: true },
  async run({ slideId, width }, ctx) {
    const open = await currentDeck(ctx);
    requireSlide(open.deck, slideId);
    if (!ctx.render) {
      return errorResult({
        message: `Previews are unavailable: ${ctx.renderUnavailable ?? "no renderer"}`,
        hint: "Rely on lint instead, or ask the user to look at the editor.",
      });
    }
    const shot = await ctx.render.screenshot(open.deck, {
      deckId: open.id,
      slideId,
      width: width ?? 960,
    });
    return {
      content: [
        { type: "image", data: Buffer.from(shot.data).toString("base64"), mimeType: shot.mimeType },
        { type: "text", text: `Slide ${slideId} (deck version ${open.version}).` },
      ],
    };
  },
});

const undoAgentChanges = defineTool({
  name: "undo_agent_changes",
  title: "Undo my changes",
  description:
    "Undo your own most recent changes (never the user's), one step per tool call that changed the deck.",
  input: z.strictObject({
    steps: z.number().int().min(1).max(50).optional().describe("Default 1."),
  }),
  async run({ steps = 1 }, ctx) {
    const open = await currentDeck(ctx);
    const undone: string[] = [];
    for (let i = 0; i < steps; i++) {
      const result = open.undo(ctx.origin);
      if (result === null) break;
      if (!result.ok) return errorResult(result.error);
      undone.push(result.transaction.label.replace(/^Undo: /, ""));
    }
    if (!undone.length)
      return text(
        "Nothing to undo: you haven't changed this deck yet (or already undid everything).",
      );
    return text(
      `Undid ${undone.length} step${undone.length === 1 ? "" : "s"}: ${undone.map((l) => `"${l}"`).join(", ")}.`,
    );
  },
});

const getDocsTool = defineTool({
  name: "get_docs",
  title: "Get docs",
  description:
    'Reference docs. Topics: "layout" (frames, sizing, patterns), "design" (rules for good slides), "theme" (tokens), "ops" (apply_ops), "lint", "element/<type>" (e.g. "element/text").',
  input: z.strictObject({ topic: z.string() }),
  annotations: { readOnlyHint: true },
  async run({ topic }, ctx) {
    const id = ctx.workspace.activeDeckId;
    const deck = id ? (await ctx.workspace.get(id)).deck : null;
    const docs = getDocs(topic, ctx.registry, deck);
    if (docs === null) {
      return errorResult({
        message: `No docs topic "${topic}"`,
        hint: notFoundHint(topic, docTopics(ctx.registry), "topic"),
      });
    }
    return text(docs);
  },
});

const createDeck = defineTool({
  name: "create_deck",
  title: "Create deck",
  description: `Create a new deck and make it the current one (the user's editor switches to it). Themes: ${Object.keys(BUILTIN_THEMES).join(", ")}.`,
  input: z.strictObject({
    title: z.string().min(1).max(300),
    theme: z
      .string()
      .optional()
      .describe('Built-in theme ID. Default "light". Customize later with set_theme.'),
  }),
  async run({ title, theme }, ctx) {
    const resolved =
      theme === undefined ? undefined : resolveTheme(theme, BUILTIN_THEMES.light as Theme);
    const open = await ctx.workspace.create({ title, ...(resolved && { theme: resolved }) });
    return text(
      `Created deck "${title}" (id ${open.id}). It's now the current deck.`,
      deckSummary(open.deck),
      paletteLine(open.deck.theme),
    );
  },
});

const listDecks = defineTool({
  name: "list_decks",
  title: "List decks",
  description: "Decks in the workspace, most recently changed first. The current deck is marked.",
  input: z.strictObject({}),
  annotations: { readOnlyHint: true },
  async run(_args, ctx) {
    const decks = ctx.workspace.list();
    if (!decks.length) return text("No decks yet. Create one with create_deck.");
    const active = ctx.workspace.activeDeckId;
    return text(
      decks
        .map(
          (d) =>
            `- ${d.id}: "${d.title}" · ${d.slideCount} slides · ${d.file}${d.id === active ? " · CURRENT" : ""}`,
        )
        .join("\n"),
    );
  },
});

const openDeck = defineTool({
  name: "open_deck",
  title: "Open deck",
  description:
    "Make another deck the current one (the user's editor switches to it). Get IDs from list_decks.",
  input: z.strictObject({ deckId: z.string() }),
  async run({ deckId }, ctx) {
    const open = await ctx.workspace.get(deckId);
    ctx.workspace.setActive(open.id);
    return text(deckSummary(open.deck));
  },
});

export const TOOLS: readonly ToolDefinition[] = [
  getDeckSummary,
  getSlide,
  upsertSlide,
  applyOps,
  listElementTypes,
  setTheme,
  lint,
  renderPreview,
  undoAgentChanges,
  getDocsTool,
  createDeck,
  listDecks,
  openDeck,
];

/** JSON Schema for a tool's input, as listed to agents. */
export function toolInputSchema(tool: ToolDefinition): Record<string, unknown> {
  if (tool.displaySchema) return tool.displaySchema;
  const { $schema: _, ...schema } = z.toJSONSchema(tool.input, {
    io: "input",
    unrepresentable: "any",
    reused: "ref", // shared sub-schemas once, as $defs: keeps tool listings small
  }) as Record<string, unknown>;
  return schema;
}

/** Validate arguments and run a tool, turning every failure into an actionable error result. */
export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return errorResult({
      message: `Unknown tool "${name}"`,
      hint: notFoundHint(
        name,
        TOOLS.map((t) => t.name),
        "tool",
      ),
    });
  }
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    return errorResult({
      message: `Invalid arguments: ${formatIssues(parsed.error.issues)}`,
      hint:
        name === "apply_ops"
          ? 'Check each op against get_docs("ops").'
          : name === "upsert_slide"
            ? 'Nodes are { "type", "props" } elements or { "layout", "children" } frames; see get_docs("layout").'
            : "Check the arguments against this tool's input schema.",
    });
  }
  try {
    return await tool.run(parsed.data, ctx);
  } catch (error) {
    if (error instanceof ToolError) return errorResult(error.info);
    if (error instanceof VeloceError) return errorResult(error.toJSON());
    return errorResult({ message: error instanceof Error ? error.message : String(error) });
  }
}
