/**
 * The MCP tools. Few, high-leverage and batch-friendly:
 * - `upsert_slide` builds a whole slide per call; `apply_ops` batches any edits atomically.
 * - Every edit returns lint for the slides it changed, so problems surface immediately.
 * - Errors say what was wrong and how to fix the call.
 *
 * Agents act through the same transactions as humans (golden rule #1), with origin
 * `agent:<client name>`, so their changes have their own undo history.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  type AgentOrigin,
  type AssetInfo,
  assetKind,
  BUILTIN_THEMES,
  type Component,
  ComponentNameSchema,
  type ComponentParam,
  collectIds,
  type Deck,
  deckSections,
  findBuiltinTheme,
  findNode,
  findSlide,
  fontStackFor,
  formatBytes,
  formatIssues,
  getComponent,
  type HistoryEntry,
  hasFieldRuns,
  IdSchema,
  MAX_ASSET_BYTES,
  type Node,
  notFoundHint,
  type Op,
  type Origin,
  ParamNameSchema,
  ParamTargetSchema,
  type Slide,
  sectionAt,
  slideLayouts,
  type Theme,
  ThemeSchema,
  VeloceError,
  walkNodes,
} from "@veloce/core";
import {
  lintWithRender,
  type OpenDeck,
  type Optimization,
  type RenderService,
  type Workspace,
} from "@veloce/doc-server";
import type { PluginRegistry } from "@veloce/plugin-api";
import { z } from "zod";
import { othersChanges } from "./changes.js";
import { docTopics, getDocs, paletteLine } from "./docs.js";
import {
  NodeInputSchema,
  normalizeNode,
  normalizeOp,
  normalizeSlide,
  OpInputSchema,
  SlideInputSchema,
  withFieldText,
} from "./input.js";
import { boundsTable, componentOutline, deckSummary, formatLint, slideOutline } from "./summary.js";

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
  /**
   * The deck this connection works on (D68): set by create_deck and open_deck, otherwise the
   * deck the editor showed at this session's first call. The user switching decks in the
   * editor, or another agent opening one, never moves it, so writes can't land in a deck
   * this agent never chose.
   */
  deckId: string | null = null;

  /** The deck version this session last caught up to, per deck. */
  readonly #seen = new Map<string, number>();
  /** `deckId@version` of every change this session made (its own never show in the digest). */
  readonly #mine = new Set<string>();

  created(deckId: string, slideId: string): boolean {
    return this.#created.has(`${deckId}/${slideId}`);
  }

  markCreated(deckId: string, slideIds: Iterable<string>): void {
    for (const id of slideIds) this.#created.add(`${deckId}/${id}`);
  }

  /** Record that this session made `version` of `deckId`. */
  markMine(deckId: string, version: number): void {
    this.#mine.add(`${deckId}@${version}`);
  }

  isMine(deckId: string, version: number): boolean {
    return this.#mine.has(`${deckId}@${version}`);
  }

  /**
   * Changes others made to `deckId` since this session last caught up (oldest first), and
   * whether some of them already fell off the bounded history. Moves the mark to `version`.
   * The first look at a deck reports nothing: the agent is about to read it anyway.
   */
  catchUp(
    deckId: string,
    version: number,
    history: readonly HistoryEntry[],
  ): { entries: HistoryEntry[]; missedEarlier: boolean } {
    const seen = this.#seen.get(deckId);
    this.#seen.set(deckId, version);
    // Unseen deck, or a version count that restarted (the deck was reloaded): nothing to diff.
    if (seen === undefined || seen > version) return { entries: [], missedEarlier: false };
    const entries = history.filter((e) => e.version > seen && !this.isMine(deckId, e.version));
    const oldest = history[0]?.version;
    return {
      entries,
      missedEarlier: version > seen && (oldest === undefined || oldest > seen + 1),
    };
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

/** This session's deck (D68), pinned on first use. */
async function currentDeck(ctx: ToolContext): Promise<OpenDeck> {
  const pinned = ctx.session.deckId;
  const id = pinned ?? ctx.workspace.activeDeckId;
  if (!id) {
    throw new VeloceError("NOT_FOUND", "No deck is open", {
      hint: "Create one with create_deck, or list_decks then open_deck.",
    });
  }
  if (pinned && !ctx.workspace.has(pinned)) {
    throw new VeloceError(
      "NOT_FOUND",
      ctx.workspace.trashed(pinned)
        ? `The user moved your current deck (${pinned}) to the trash: that's their decision, don't recreate it`
        : `Your current deck (${pinned}) isn't in the workspace anymore`,
      {
        hint: "list_decks, then open_deck the one to work on (or create_deck if the user asks for a new one).",
      },
    );
  }
  const open = await ctx.workspace.get(id);
  ctx.session.deckId = open.id;
  return open;
}

/** This session's deck if it has one yet (read-only uses: docs, listings, resources). */
export function sessionDeckId(ctx: Pick<ToolContext, "workspace" | "session">): string | null {
  return ctx.session.deckId ?? ctx.workspace.activeDeckId;
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

/**
 * Measure (if a renderer is available) and lint, the same way the editor's Issues panel does
 * (D73). Never fails: visual problems degrade to a note.
 */
async function lintReport(
  ctx: ToolContext,
  open: OpenDeck,
  slideIds?: readonly string[],
): Promise<string> {
  const { issues, visual } = await lintWithRender(open.deck, {
    deckId: open.id,
    render: ctx.render,
    ...(ctx.renderUnavailable && { unavailable: ctx.renderUnavailable }),
    ...(slideIds && { slideIds }),
  });
  return formatLint(issues, visual);
}

/** Slides that are new or changed between two versions (core copies only what changes). */
/**
 * Slides to lint after a change: the ones it changed, and the ones it moved into another
 * section without touching them (D97): a slide move or a section ending can leave another
 * slide's section field showing nothing or the wrong name, and only lint says so.
 */
function changedSlides(before: Deck, after: Deck): string[] {
  const old = new Set(before.slides);
  const sectionBefore = new Map(before.slides.map((s, i) => [s.id, sectionAt(before, i)]));
  return after.slides
    .filter(
      (s, i) =>
        !old.has(s) ||
        (sectionBefore.has(s.id) &&
          sectionBefore.get(s.id) !== sectionAt(after, i) &&
          hasFieldRuns(s.root)),
    )
    .map((s) => s.id);
}

/** Which section each slide is in, by the ID of the slide that starts it ("" for none). */
function sectionKeys(deck: Deck): Map<string, string> {
  const keys = new Map<string, string>();
  for (const { name, key, slideIds } of deckSections(deck)) {
    for (const id of slideIds) keys.set(id, name === null ? "" : key);
  }
  return keys;
}

/**
 * Slides a change moved into another section (D97), as `s7 is now in "Results"`: a raw
 * slide.move takes markers along, and ending a section regroups its slides, so the agent
 * should see where they went. A rename keeps every slide in its section: nothing to say.
 */
function sectionMoves(before: Deck, after: Deck): string[] {
  const was = sectionKeys(before);
  const now = sectionKeys(after);
  const moves: string[] = [];
  after.slides.forEach((slide, i) => {
    const from = was.get(slide.id);
    if (from === undefined || from === now.get(slide.id)) return;
    const name = sectionAt(after, i);
    moves.push(`${slide.id} is now in ${name === null ? "no section" : `"${name}"`}`);
  });
  return moves.length > 8 ? [...moves.slice(0, 8), `${moves.length - 8} more`] : moves;
}

/** How a failed commit's error should read for the tool that made the ops. */
interface CommitErrors {
  /** IDs the tool generated: the agent never saw them, so messages don't name them. */
  generated?: ReadonlySet<string>;
  /**
   * The agent sent a slide, not ops (upsert_slide): drop the "ops[0] (slide.insert)" prefix
   * and point paths into the slide it sent (`slide.children[1]`, not `ops[0].slide.root…`).
   */
  asSlide?: boolean;
  /** The agent sent a component (save_component): paths point into what it sent. */
  asComponent?: boolean;
}

/** The "How to fix" for arguments that don't match a tool's schema: the likeliest mix-up first. */
function invalidArgumentsHint(
  tool: string,
  message: string,
  issues: readonly { path: readonly PropertyKey[] }[],
): string {
  // `{ "type": "frame", "layout", "children" }`: read as an element with stray keys.
  if (/Unrecognized keys?: .*"(?:children|layout)"/.test(message)) {
    return 'A frame has no "type" (that\'s for elements): write { "layout": { … }, "children": [ … ] }, optionally with "kind": "frame". See get_docs("layout").';
  }
  if (tool === "apply_ops") {
    return issues.some((i) => i.path[2] === "footer")
      ? 'footer is { "date"?: true, "text"?: "…", "slideNumber"?: true }, or null to remove it (get_docs("sections")).'
      : 'Check each op against get_docs("ops").';
  }
  if (tool === "upsert_slide" && issues.some((i) => i.path.includes("children"))) {
    return 'Nodes are { "type", "props" } elements or { "layout", "children" } frames; see get_docs("layout").';
  }
  return "Fix the field named above; this tool's input schema describes each one.";
}

/** Rewrites a core error into the terms of what the agent actually sent. */
function presentError(
  error: ErrorLike,
  { generated, asSlide, asComponent }: CommitErrors,
): ErrorLike {
  let { message, path } = error;
  if (generated?.size) {
    message = message.replace(
      /Element "([^"]+)" \(([^)]+)\)/g,
      (whole, id: string, type: string) => (generated.has(id) ? `The ${type} element` : whole),
    );
  }
  if (asSlide) {
    message = message.replace(/^ops\[\d+\] \([a-z.]+\): /i, "");
    path = path?.replace(/^ops\[\d+\]\.slide(\.root)?/, "slide").replace(/^ops\[\d+\]$/, "");
  }
  if (asComponent) {
    message = message.replace(/^ops\[\d+\] \([a-z.]+\): /i, "");
    path = path?.replace(/^ops\[\d+\]\.(component\.)?/, "").replace(/^ops\[\d+\]$/, "");
  }
  return { ...error, message, path: path || undefined };
}

const removerName = (remover: Origin, self: Origin) =>
  remover === "user" ? "the user" : remover === self ? "an earlier change of yours" : remover;

/**
 * When an op fails on an ID that someone removed this session, say that instead of core's
 * "not found, did you mean…?" (D72): a nearest-match suggestion there points the agent at
 * other content, often the user's, and invites it to overwrite that.
 */
function removedTarget(open: OpenDeck, op: unknown, self: Origin): ErrorLike | null {
  const {
    op: kind,
    id,
    parentId,
  } = (op ?? {}) as { op?: string; id?: unknown; parentId?: unknown };
  const ids = [id, parentId].filter((v): v is string => typeof v === "string");
  for (const target of ids) {
    if (kind?.startsWith("slide.") && target === id) {
      const remover = open.removedBy(target);
      if (!remover || findSlide(open.deck, target)) continue;
      return {
        message: `Slide ${target} was removed by ${removerName(remover, self)}.`,
        hint: "Leave it out unless the user asks for it back. get_deck_summary shows the slides there are now.",
      };
    }
    const removal = open.removedNode(target);
    if (!removal || findNode(open.deck, target)) continue;
    const what = `Node "${target}"${removal.label ? ` ("${removal.label}")` : ""}`;
    const by = removerName(removal.origin, self);
    return removal.withSlide
      ? {
          message: `${what} was on slide ${removal.slideId}, which ${by} removed.`,
          hint: "Leave it out unless the user asks for that slide back. get_deck_summary shows the slides there are now.",
        }
      : {
          message: `${what} was deleted by ${by} (it was on slide ${removal.slideId}).`,
          hint: `Don't recreate it, or edit something else in its place, unless the user asks. get_slide("${removal.slideId}") shows what's there now.`,
        };
  }
  return null;
}

async function commit(
  ctx: ToolContext,
  open: OpenDeck,
  label: string,
  ops: unknown[],
  errors: CommitErrors = {},
): Promise<{ before: Deck; after: Deck }> {
  const before = open.deck;
  const result = open.apply({ origin: ctx.origin, label, ops });
  if (!result.ok) {
    const at = result.error.opIndex !== undefined ? `ops[${result.error.opIndex}]` : undefined;
    const raw = { ...result.error, ...(at && !result.error.path && { path: at }) };
    const failed = result.error.opIndex === undefined ? undefined : ops[result.error.opIndex];
    const gone = result.error.code === "NOT_FOUND" ? removedTarget(open, failed, ctx.origin) : null;
    throw new ToolError(
      gone ? { ...gone, ...(raw.path && { path: raw.path }) } : presentError(raw, errors),
    );
  }
  ctx.session.markMine(open.id, open.version);
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
    const open = await currentDeck(ctx);
    const elsewhere =
      ctx.workspace.activeDeckId !== open.id
        ? `The user's editor is showing another deck right now. Your changes still go to this one; open_deck("${open.id}") shows it to them.`
        : "";
    return text(deckSummary(open.deck), elsewhere);
  },
});

const getSlide = defineTool({
  name: "get_slide",
  title: "Get slide",
  description:
    "Full JSON of one slide (all props), plus where each node ended up after layout (x,y width×height in stage pixels; for a rotated node, the upright box it covers on screen).",
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
            `Measured layout (stage ${m.stage.width}×${m.stage.height}; rotated nodes show the upright box they cover, not their own size):\n${boundsTable(m)}`,
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
    'Describe structure: nodes are elements { "type", "props" } or frames { "layout", "style", "children" }. The slide itself is a frame (default: a column centered top-to-bottom; children stretch across, so add align: "center" to center hug-width content).',
    "Omitted IDs are generated and returned; give stable IDs to nodes you may change later.",
    'A node can also be a copy of a saved component: { "use": "<name>", "with": { <param>: <value> } } (see list_components).',
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
        "Replace a slide the user (or another agent) edited last, or bring back one they removed. Only when they asked for it.",
      ),
  }),
  async run({ slide: input, index, overwrite }, ctx) {
    const open = await currentDeck(ctx);
    const generated = new Set<string>();
    // Rebuilding a slide frees its IDs: copies in it get the same readable ones again
    // (s3-title), not generated ones because the old slide still had them.
    const taken = collectIds(open.deck);
    const replaced = input.id === undefined ? undefined : findSlide(open.deck, input.id)?.slide;
    if (replaced) for (const { node } of walkNodes(replaced.root)) taken.delete(node.id);
    const normalized = normalizeSlide(input, {
      generated,
      deck: open.deck,
      validateElement: ctx.registry.validateElement,
      taken,
    });
    const existing = findSlide(open.deck, normalized.id);
    const remover = open.removedBy(normalized.id);
    if (!existing && !overwrite && remover && remover !== ctx.origin) {
      throw new ToolError({
        message: `Slide ${normalized.id} was removed by ${remover === "user" ? "the user" : remover} (deleted, or your change reverted); adding it back would undo their decision.`,
        hint: "Leave it out, or ask the user. Pass overwrite: true only if they asked for it back. A slide with a new ID is fine if the user asked for new content.",
      });
    }
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
    const { after } = await commit(ctx, open, label, ops, { generated, asSlide: true });
    ctx.session.markCreated(open.id, [slide.id]); // rebuilt by this session: its own now
    const position = after.slides.findIndex((s) => s.id === slide.id);
    const saved = after.slides[position];
    return text(
      `${label}: done.`,
      saved ? slideOutline(saved, position, { footer: !!after.footer }) : "",
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
  "deck.setFooter",
] as const;

const applyOps = defineTool({
  name: "apply_ops",
  title: "Apply edits",
  description: [
    "Apply a batch of edits atomically (all or nothing) as one undoable step.",
    'Ops: slide.insert/remove/move/update, node.insert/remove/move/update, deck.updateMeta, deck.setFooter. node.update uses JSON Merge Patch: { "op": "node.update", "id": "title", "set": { "props": { "content": "New" } } } (null deletes a field).',
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
    const generated = new Set<string>();
    const normalize = { generated, deck: open.deck, validateElement: ctx.registry.validateElement };
    const ops = inputs.map((input, i) => normalizeOp(input, normalize, `ops[${i}]`));
    const { before, after } = await commit(ctx, open, label, ops, { generated });
    const created = ops.flatMap((op) => {
      const node = (op as { op: string; node?: Node }).node;
      return node ? [...walkNodes(node)].map((n) => n.node.id) : [];
    });
    // Slides made here: their root frame (generated) and the nodes inside, so the next call
    // can edit them without a get_slide first.
    const slides = ops.flatMap((op) => {
      const slide = (op as { op: string; slide?: Slide }).slide;
      if (!slide) return [];
      const inner = [...walkNodes(slide.root)].slice(1).map((n) => n.node.id);
      return [
        `${slide.id} (root frame ${slide.root.id}${inner.length ? `; ${inner.join(", ")}` : ""})`,
      ];
    });
    const changed = changedSlides(before, after);
    const regrouped = sectionMoves(before, after);
    return text(
      `Applied "${label}" (${ops.length} op${ops.length === 1 ? "" : "s"}).${created.length ? ` New node IDs: ${created.join(", ")}.` : ""}${slides.length ? ` New slides: ${slides.join("; ")}.` : ""}${regrouped.length ? ` Sections: ${regrouped.join("; ")}.` : ""}`,
      changed.length ? await lintReport(ctx, open, changed) : "",
    );
  },
});

/** A param as agents may write it: one target, a list, or with a description. */
const ParamTargetsInput = z.union([ParamTargetSchema, z.array(ParamTargetSchema).min(1).max(10)]);
const ParamInput = z.union([
  ParamTargetsInput,
  z.strictObject({
    description: z.string().max(300).optional(),
    targets: ParamTargetsInput,
  }),
]);

function normalizeParam(input: z.infer<typeof ParamInput>): ComponentParam {
  const list = (t: string | string[]) => (typeof t === "string" ? [t] : t);
  if (typeof input === "string" || Array.isArray(input)) return { targets: list(input) };
  return {
    ...(input.description && { description: input.description }),
    targets: list(input.targets),
  };
}

const saveComponent = defineTool({
  name: "save_component",
  title: "Save a component",
  description: [
    'Save a node (a card, tile, badge, a drawing made of shapes…) under a name, to insert copies of it anywhere with { "use": "<name>", "with": { … } } in upsert_slide children or node.insert.',
    "Give the template as `node` (same shape as upsert_slide nodes, with IDs on what params target) or copy one already on a slide with `from`.",
    'params map a value to template fields: { "title": "card-title.props.content", "accent": { "description": "Card fill", "targets": ["card.style.fill"] } }.',
    'Copies are plain nodes: changing one, or the component later, never changes the others. Guide: get_docs("components").',
  ].join(" "),
  input: z.strictObject({
    name: ComponentNameSchema,
    description: z
      .string()
      .max(500)
      .optional()
      .describe('What it\'s for, e.g. "Feature card: title and one line".'),
    node: NodeInputSchema.optional().describe("The template. Give IDs to the nodes params target."),
    from: z
      .string()
      .optional()
      .describe(
        "Or: the ID of a node already on a slide, copied with everything inside it; a slide's ID saves the whole slide as a slide layout.",
      ),
    slot: IdSchema.optional().describe(
      "A frame in the template that children given with `use` fill, in place of its placeholder.",
    ),
    params: z
      .record(ParamNameSchema, ParamInput)
      .optional()
      .describe('Param name → "<node ID>.<field>" target(s) inside the template.'),
    overwrite: z
      .boolean()
      .optional()
      .describe("Replace the component already saved under this name."),
  }),
  // The node is upsert_slide's node shape: listed again in full it would double the size.
  displaySchema: {
    type: "object",
    properties: {
      name: { type: "string", description: 'e.g. "Feature card" or "kpi-tile".' },
      description: { type: "string", description: "What it's for." },
      node: {
        type: "object",
        description:
          "The template: a node exactly like upsert_slide's (frame with layout/style/children, or element with type/props). Give IDs to the nodes params target.",
        additionalProperties: true,
      },
      from: {
        type: "string",
        description:
          "Or: the ID of a node on a slide (copied with everything in it), or of a slide: then it's a slide layout.",
      },
      slot: {
        type: "string",
        description: "A frame in the template that `children` given with `use` fill.",
      },
      params: {
        type: "object",
        description:
          'Param name → target "<node ID>.<field>", a list of targets, or { description, targets }.',
        additionalProperties: true,
      },
      overwrite: {
        type: "boolean",
        description: "Replace the component already saved under this name.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async run({ name, description, node, from, params, slot, overwrite }, ctx) {
    const open = await currentDeck(ctx);
    if ((node === undefined) === (from === undefined)) {
      throw new ToolError({
        message: "Give the template as either `node` or `from`",
        hint: "`node` describes it (like an upsert_slide node); `from` copies a node already on a slide by its ID, or a whole slide (a slide layout) by the slide's ID.",
      });
    }
    const existing = getComponent(open.deck, name);
    if (existing && !overwrite) {
      throw new ToolError({
        message: `A component named "${name}" already exists`,
        hint: "Pick another name, or pass overwrite: true to replace it (copies already on slides don't change). list_components shows it.",
      });
    }
    let template: Node;
    /** Set when `from` names a slide: the component is a slide layout (D95). */
    let layout: Component["slide"];
    if (from !== undefined) {
      const slide = findSlide(open.deck, from)?.slide;
      const found = slide ? null : findNode(open.deck, from);
      if (slide) {
        template = slide.root;
        layout = {
          ...(slide.background !== undefined && { background: slide.background }),
          ...(slide.hideFooter && { hideFooter: true }),
        };
      } else if (found) {
        template = found.node;
      } else {
        throw new ToolError({
          message: `No node or slide "${from}"`,
          path: "from",
          hint: "get_deck_summary lists the deck's slide and node IDs.",
        });
      }
    } else {
      template = normalizeNode(
        withFieldText(node as NonNullable<typeof node>),
        { deck: open.deck, validateElement: ctx.registry.validateElement },
        "node",
      );
    }
    const component: Component = {
      ...(description && { description }),
      ...(params &&
        Object.keys(params).length > 0 && {
          params: Object.fromEntries(
            Object.entries(params).map(([param, input]) => [param, normalizeParam(input)]),
          ),
        }),
      node: template,
      ...(slot !== undefined && { slot }),
      ...(layout && { slide: layout }),
    };
    const what = layout ? "slide layout" : "component";
    const label = `${existing ? "Replace" : "Save"} ${what} "${name}"`;
    await commit(ctx, open, label, [{ op: "component.save", name, component }], {
      asComponent: true,
    });
    const names = Object.keys(component.params ?? {});
    const example = names[0] ? `, "with": { "${names[0]}": … }` : "";
    return text(
      layout
        ? `${label}: done. Start slides from it with upsert_slide { "slide": { "use": "${name}"${example} } }.`
        : `${label}: done. Insert copies with { "use": "${name}"${example} } wherever a node goes.`,
      componentOutline(name, component),
    );
  },
});

const listComponents = defineTool({
  name: "list_components",
  title: "List components and slide layouts",
  description:
    'The deck\'s components and slide layouts (its own and the built-in ones): what each is for, its params (and the fields they fill), and its template tree. Use one with { "use": "<name>", "with": { … } }.',
  input: z.strictObject({}),
  annotations: { readOnlyHint: true },
  async run(_args, ctx) {
    const open = await currentDeck(ctx);
    const own = Object.entries(open.deck.components ?? {});
    const parts = own.filter(([, c]) => !c.slide);
    const layouts = slideLayouts(open.deck);
    return text(
      parts.length > 0
        ? `Components (${parts.length}). Insert with { "use": "<name>", "with": { <param>: <value> } } wherever a node goes; a copy's inner IDs are "<copy id>-<template id>".`
        : "No components yet. Build a repeated piece once and save it with save_component.",
      ...parts.map(([name, component]) => componentOutline(name, component)),
      `Slide layouts (${layouts.length}). Start a slide with upsert_slide { "slide": { "id": "s3", "use": "<name>", "with": { … }, "children": [ … ] } }: children fill its slot; inner IDs are "<slide id>-<template id>". Save your own with save_component { from: "<slide id>" }.`,
      ...layouts.map(({ name, component, builtin }) =>
        componentOutline(name, component, builtin ? "built in" : undefined),
      ),
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

const optimizeInput = z
  .boolean()
  .optional()
  .describe("false: keep this file's exact bytes (default: big photos are made smaller)");

const AssetFileInput = z.union([
  z.strictObject({
    path: z.string().min(1).describe("Absolute path of a local file"),
    optimize: optimizeInput,
  }),
  z.strictObject({
    data: z.string().min(1).describe("The file's bytes, base64-encoded"),
    name: z.string().max(255).describe('File name, e.g. "logo.svg"'),
    optimize: optimizeInput,
  }),
]);

/** Bytes and a file name from one `add_asset` entry; throws a fixable error. */
async function readAssetInput(input: z.infer<typeof AssetFileInput>, at: string) {
  const fail = (message: string, hint: string): never => {
    throw new ToolError({ message, hint, path: at });
  };
  if ("data" in input) {
    const bytes = Buffer.from(input.data, "base64");
    if (bytes.length === 0)
      fail("The data is empty or not base64", "Send the file's bytes base64-encoded.");
    return { bytes: new Uint8Array(bytes), name: input.name };
  }
  if (!isAbsolute(input.path)) {
    fail(`"${input.path}" isn't an absolute path`, "Give the full path, e.g. /home/me/logo.png.");
  }
  const info = await stat(input.path).catch(() => null);
  if (!info?.isFile())
    fail(`No file at ${input.path}`, "Check the path, or send the bytes as data.");
  if ((info?.size ?? 0) > MAX_ASSET_BYTES) {
    fail(
      `${input.path} is over ${MAX_ASSET_BYTES / 1024 ** 2} MiB`,
      "Use a smaller or compressed file.",
    );
  }
  return { bytes: new Uint8Array(await readFile(input.path)), name: basename(input.path) };
}

/** "optimized from 3.6 MB PNG 5120×2880": what the agent should know it got (D67). */
function describeOptimization(info: AssetInfo, o: Optimization): string {
  const from = o.original.info;
  const format = from.mime.replace("image/", "").toUpperCase();
  const resized = o.resized && from.width && from.height ? ` ${from.width}×${from.height}` : "";
  return `; optimized from ${formatBytes(from.bytes)} ${format}${resized} to ${formatBytes(info.bytes)}, looking the same`;
}

/** One line per added file: the reference to use, and how. */
function describeAsset(id: string, info: AssetInfo, optimization?: Optimization): string {
  const ref = `"asset:${id}"`;
  const label = info.name ? `${info.name}: ` : "";
  if (assetKind(info.mime) === "font") {
    if (!info.font) return `${label}${ref} (${info.mime}; its family name couldn't be read).`;
    const { family, weight, style } = info.font;
    const w = Array.isArray(weight)
      ? `weights ${weight[0]}–${weight[1]}`
      : `weight ${weight ?? 400}`;
    return `${label}font family "${family}" (${w}${style === "italic" ? ", italic" : ""}). Use it in the theme: set_theme({ "theme": { "fonts": { "heading": ${JSON.stringify(fontStackFor(family, info.font.category))} } } }).`;
  }
  const size = info.width && info.height ? `, ${info.width}×${info.height}` : "";
  const saved = optimization ? describeOptimization(info, optimization) : "";
  return `${label}${ref} (${info.mime}${size}${saved}). Use it as an image: { "type": "image", "props": { "asset": ${ref}, "alt": "…" } }, or as a frame background: "style": { "fill": { "type": "image", "asset": ${ref} } }.`;
}

const addAsset = defineTool({
  name: "add_asset",
  title: "Add images or fonts",
  description: `Add image files (PNG, JPEG, GIF, WebP, AVIF, SVG) or fonts (TTF, OTF, WOFF, WOFF2) to the current deck, up to ${MAX_ASSET_BYTES / 1024 ** 2} MiB each. Give a local file path, or base64 data with a file name. Returns the "asset:<id>" reference for each image, and the family name for each font. JPEG, PNG and WebP images over 32 KB (photos and screenshots alike) are made smaller on import: at most 3840 px, WebP that looks the same. Set optimize: false on a file to keep its exact bytes. Remote URLs aren't fetched: decks stay self-contained.`,
  input: z.strictObject({ files: z.array(AssetFileInput).min(1).max(20) }),
  async run({ files }, ctx) {
    const open = await currentDeck(ctx);
    const added: Array<{ id: string; info: AssetInfo; optimization?: Optimization }> = [];
    for (const [i, file] of files.entries()) {
      const { bytes, name } = await readAssetInput(file, `files[${i}]`);
      const result = await open.importAsset(bytes, name, {
        ...(file.optimize !== undefined && { optimize: file.optimize }),
      });
      if (!result.ok) {
        throw new ToolError({
          message: `${name ?? `files[${i}]`}: ${result.message}`,
          path: `files[${i}]`,
          hint: "Convert it to a supported format, or leave it out.",
        });
      }
      added.push(result);
    }
    const fresh = added.filter(
      (a, i) => !open.deck.assets[a.id] && added.findIndex((b) => b.id === a.id) === i,
    );
    if (fresh.length > 0) {
      const what = fresh.length === 1 ? (fresh[0]?.info.name ?? "1 file") : `${fresh.length} files`;
      await commit(
        ctx,
        open,
        `Add ${what}`,
        fresh.map(({ id, info }) => ({ op: "asset.add", id, asset: info })),
      );
    }
    return text(
      ...added.map(({ id, info, optimization }) => describeAsset(id, info, optimization)),
    );
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
    const before = open.deck;
    const undone: string[] = [];
    for (let i = 0; i < steps; i++) {
      const result = open.undo(ctx.origin);
      if (result === null) break;
      if (!result.ok) return errorResult(result.error);
      ctx.session.markMine(open.id, open.version);
      undone.push(result.transaction.label.replace(/^Undo: /, ""));
    }
    if (!undone.length)
      return text(
        "Nothing to undo: you haven't changed this deck yet (or already undid everything).",
      );
    const changed = changedSlides(before, open.deck);
    const kept = new Set(open.deck.slides.map((s) => s.id));
    const removed = before.slides.filter((s) => !kept.has(s.id)).map((s) => s.id);
    const where = [
      changed.length && `Changed: ${changed.join(", ")}.`,
      removed.length && `Removed: ${removed.join(", ")}.`,
    ].filter(Boolean);
    return text(
      `Undid ${undone.length} step${undone.length === 1 ? "" : "s"}: ${undone.map((l) => `"${l}"`).join(", ")}.${where.length ? ` ${where.join(" ")}` : ""}`,
      changed.length ? await lintReport(ctx, open, changed) : "",
    );
  },
});

const getDocsTool = defineTool({
  name: "get_docs",
  title: "Get docs",
  description:
    'Reference docs. Topics: "layout" (frames, sizing, patterns), "design" (rules for good slides), "theme" (tokens), "ops" (apply_ops), "components" (saved components and slide layouts), "sections" (sections, footer, slide numbers, live fields), "lint", "element/<type>" (e.g. "element/text").',
  input: z.strictObject({ topic: z.string() }),
  annotations: { readOnlyHint: true },
  async run({ topic }, ctx) {
    const id = sessionDeckId(ctx);
    const deck = id && ctx.workspace.has(id) ? (await ctx.workspace.get(id)).deck : null;
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
    ctx.session.deckId = open.id;
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
  description:
    "Decks in the workspace, most recently used first. Your current deck is marked, and so is the one the user's editor shows.",
  input: z.strictObject({}),
  annotations: { readOnlyHint: true },
  async run(_args, ctx) {
    const decks = ctx.workspace.list();
    if (!decks.length) return text("No decks yet. Create one with create_deck.");
    const mine = sessionDeckId(ctx);
    const shown = ctx.workspace.activeDeckId;
    const marks = (id: string) =>
      `${id === mine ? " · CURRENT" : ""}${id === shown ? " · in the user's editor" : ""}`;
    return text(
      decks
        .map((d) => `- ${d.id}: "${d.title}" · ${d.slideCount} slides · ${d.file}${marks(d.id)}`)
        .join("\n"),
    );
  },
});

const openDeck = defineTool({
  name: "open_deck",
  title: "Open deck",
  description:
    "Make another deck your current one (the user's editor switches to it). Get IDs from list_decks. Your current deck stays yours: the user or other agents switching decks don't change it.",
  input: z.strictObject({ deckId: z.string() }),
  async run({ deckId }, ctx) {
    const open = await ctx.workspace.get(deckId);
    ctx.session.deckId = open.id;
    ctx.workspace.setActive(open.id);
    return text(deckSummary(open.deck));
  },
});

export const TOOLS: readonly ToolDefinition[] = [
  getDeckSummary,
  getSlide,
  upsertSlide,
  applyOps,
  saveComponent,
  listComponents,
  listElementTypes,
  setTheme,
  addAsset,
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
    const message = formatIssues(parsed.error.issues);
    return errorResult({
      message: `Invalid arguments: ${message}`,
      hint: invalidArgumentsHint(name, message, parsed.error.issues),
    });
  }
  let result: ToolResult;
  try {
    result = await tool.run(parsed.data, ctx);
  } catch (error) {
    if (error instanceof ToolError) result = errorResult(error.info);
    else if (error instanceof VeloceError) result = errorResult(error.toJSON());
    else result = errorResult({ message: error instanceof Error ? error.message : String(error) });
  }
  return withCatchUp(result, ctx);
}

/**
 * Put what others changed since this session's last call at the top of `result` (D71), on
 * errors too: a failed edit is often the first sign the user changed things underneath.
 */
async function withCatchUp(result: ToolResult, ctx: ToolContext): Promise<ToolResult> {
  const deckId = ctx.session.deckId;
  if (!deckId || !ctx.workspace.has(deckId)) return result;
  const open = await ctx.workspace.get(deckId);
  const history = open.history;
  const { entries, missedEarlier } = ctx.session.catchUp(deckId, open.version, history);
  const labels = new Map(history.map((e) => [e.version, e.label]));
  const digest = othersChanges(entries, {
    origin: ctx.origin,
    mine: (version) => ctx.session.isMine(deckId, version),
    labelOf: (version) => labels.get(version),
    nodeLabel: (nodeId) => open.removedNode(nodeId)?.label,
    missedEarlier,
  });
  if (!digest) return result;
  // Into the first text block, so clients that join blocks without a break still separate them.
  const [first, ...rest] = result.content;
  if (first?.type === "text") {
    return { ...result, content: [{ type: "text", text: `${digest}\n\n${first.text}` }, ...rest] };
  }
  return { ...result, content: [{ type: "text", text: digest }, ...result.content] };
}
