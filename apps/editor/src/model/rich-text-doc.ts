/**
 * Core rich text (packages/core/src/schema/rich-text.ts) ⇄ the editor's ProseMirror document
 * (TipTap JSON). Pure and DOM-free, so it's unit-tested without a browser.
 *
 * The two models disagree on lists: ours is a flat run of paragraphs tagged `list` + `level`
 * (cheap for an AI to write), ProseMirror nests `bulletList > listItem > paragraph`. Going in,
 * consecutive list paragraphs are grouped exactly like the renderer groups them into <ul>/<ol>
 * (plugins/text renderParagraphs), so what you edit is what you saw. Coming out, the tree is
 * flattened again, with the nesting depth as `level`.
 *
 * Fields (D97) are inline atoms holding the field's name and the text it was written with:
 * the caret steps over them whole and they're deleted whole, like PowerPoint's fields.
 *
 * Coming out, every value is re-validated with the core schemas: pasted HTML can't smuggle
 * a `javascript:` link or a bogus color into a transaction (the server would refuse it and
 * the whole edit would be lost).
 */
import {
  ColorSchema,
  FieldNameSchema,
  LinkSchema,
  type Paragraph,
  type TextContent,
  type TextRun,
  tokenRefSchema,
  toParagraphs,
} from "@veloce/core";

/** The subset of TipTap's JSONContent we produce and read. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** Node and mark names, shared with the TipTap setup (components/text-editor.ts). */
export const DOC = {
  doc: "doc",
  paragraph: "paragraph",
  text: "text",
  listItem: "listItem",
  bulletList: "bulletList",
  orderedList: "orderedList",
  /** Our color mark: holds a core Color (a token like `$color.primary`, or a CSS color). */
  color: "veloceColor",
  /** A field (D97): an inline atom with `field` and the `text` it was written with. */
  field: "veloceField",
} as const;

const LIST_NODE = { bullet: DOC.bulletList, number: DOC.orderedList } as const;
const LIST_KIND: Record<string, Paragraph["list"]> = {
  [DOC.bulletList]: "bullet",
  [DOC.orderedList]: "number",
};

/** Boolean run flags and the TipTap marks they map to (same names). */
const FLAG_MARKS = ["bold", "italic", "underline", "strike", "code"] as const;
type Flag = (typeof FLAG_MARKS)[number];

const ALIGNS = new Set(["left", "center", "right", "justify"]);
const TextStyleRef = tokenRefSchema("text");

// ── Core → document ──────────────────────────────────────────────────────────────────

export function toDoc(content: TextContent): DocNode {
  const blocks: DocNode[] = [];
  // Open lists, outermost first. `level` is the paragraph level that opened each one.
  const stack: Array<{ list: DocNode & { content: DocNode[] }; kind: string; level: number }> = [];

  for (const paragraph of toParagraphs(content)) {
    if (!paragraph.list) {
      stack.length = 0;
      blocks.push(paragraphNode(paragraph));
      continue;
    }
    const level = paragraph.level ?? 0;
    let top = stack.at(-1);
    // Close deeper lists, and a same-level list of the other kind (bullets → numbers).
    while (top && (top.level > level || (top.level === level && top.kind !== paragraph.list))) {
      stack.pop();
      top = stack.at(-1);
    }
    if (!top || top.level < level) {
      const list = { type: LIST_NODE[paragraph.list], content: [] as DocNode[] };
      // A nested list lives inside the previous item (every open list has at least one).
      const parentItem = top?.list.content.at(-1);
      if (parentItem) parentItem.content = [...(parentItem.content ?? []), list];
      else blocks.push(list);
      top = { list, kind: paragraph.list, level };
      stack.push(top);
    }
    top.list.content.push({ type: DOC.listItem, content: [paragraphNode(paragraph)] });
  }
  // ProseMirror needs at least one block.
  return { type: DOC.doc, content: blocks.length > 0 ? blocks : [paragraphNode({ runs: [] })] };
}

function paragraphNode(paragraph: Paragraph): DocNode {
  const node: DocNode = {
    type: DOC.paragraph,
    attrs: { align: paragraph.align ?? null, textStyle: paragraph.style ?? null },
  };
  // ProseMirror text nodes can't be empty: an empty paragraph has no content.
  const runs = paragraph.runs.filter((r) => r.text !== "" || r.field);
  if (runs.length > 0) node.content = runs.map(textNode);
  return node;
}

function textNode(run: TextRun): DocNode {
  const marks: DocMark[] = FLAG_MARKS.filter((flag) => run[flag]).map((type) => ({ type }));
  if (run.link) marks.push({ type: "link", attrs: { href: run.link } });
  if (run.color) marks.push({ type: DOC.color, attrs: { color: run.color } });
  const node: DocNode = run.field
    ? { type: DOC.field, attrs: { field: run.field, text: run.text } }
    : { type: DOC.text, text: run.text };
  if (marks.length > 0) node.marks = marks;
  return node;
}

// ── Document → core ──────────────────────────────────────────────────────────────────

/** The document as core paragraphs (lists flattened, values validated). */
export function fromDoc(doc: DocNode): Paragraph[] {
  const out: Paragraph[] = [];
  const visit = (blocks: readonly DocNode[], list?: { kind: Paragraph["list"]; level: number }) => {
    for (const block of blocks) {
      if (block.type === DOC.paragraph) {
        out.push(toParagraph(block, list));
      } else if (block.type === DOC.bulletList || block.type === DOC.orderedList) {
        const kind = LIST_KIND[block.type];
        const level = list ? list.level + 1 : 0;
        for (const item of block.content ?? []) visit(item.content ?? [], { kind, level });
      } else if (block.content) {
        visit(block.content, list); // anything unexpected: keep its text
      }
    }
  };
  visit(doc.content ?? []);
  return out.length > 0 ? out : [{ runs: [] }];
}

function toParagraph(node: DocNode, list?: { kind: Paragraph["list"]; level: number }) {
  const paragraph: Paragraph = { runs: mergeRuns((node.content ?? []).flatMap(toRun)) };
  const align = node.attrs?.align;
  if (typeof align === "string" && ALIGNS.has(align)) {
    paragraph.align = align as Paragraph["align"];
  }
  const style = TextStyleRef.safeParse(node.attrs?.textStyle);
  if (style.success) paragraph.style = style.data;
  if (list?.kind) {
    paragraph.list = list.kind;
    if (list.level > 0) paragraph.level = Math.min(list.level, 8);
  }
  return paragraph;
}

function toRun(node: DocNode): TextRun[] {
  let run: TextRun;
  if (node.type === DOC.field) {
    const field = FieldNameSchema.safeParse(node.attrs?.field);
    if (!field.success) return [];
    const text = node.attrs?.text;
    run = { text: typeof text === "string" ? text : "", field: field.data };
  } else if (node.type === DOC.text && node.text) {
    run = { text: node.text };
  } else return [];
  for (const mark of node.marks ?? []) {
    if ((FLAG_MARKS as readonly string[]).includes(mark.type)) run[mark.type as Flag] = true;
    if (mark.type === "link") {
      const link = LinkSchema.safeParse(mark.attrs?.href);
      if (link.success) run.link = link.data;
    }
    if (mark.type === DOC.color) {
      const color = ColorSchema.safeParse(mark.attrs?.color);
      if (color.success) run.color = color.data;
    }
  }
  return [run];
}

const sameFormat = (a: TextRun, b: TextRun) =>
  !a.field &&
  !b.field && // each field stays its own run
  FLAG_MARKS.every((flag) => !a[flag] === !b[flag]) &&
  a.link === b.link &&
  a.color === b.color;

/** Adjacent runs with the same formatting become one (ProseMirror may split them). */
export function mergeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (last && sameFormat(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

/**
 * The cheapest faithful content form: a plain string when nothing is formatted (what an AI
 * would write, and what the inspector's text box edits), else rich paragraphs.
 */
export function toContent(paragraphs: readonly Paragraph[]): TextContent {
  const plain = paragraphs.every(
    (p) =>
      !p.list &&
      !p.align &&
      !p.style &&
      p.runs.every((r) => Object.keys(r).length === 1 && !r.text.includes("\n")),
  );
  if (plain) return paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
  return paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r })) }));
}

/** Content → document → content: how `content` looks after an edit that changed nothing. */
export const normalizeContent = (content: TextContent): TextContent =>
  toContent(fromDoc(toDoc(content)));

export const sameContent = (a: TextContent, b: TextContent) =>
  JSON.stringify(a) === JSON.stringify(b);

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

/**
 * What someone typed into the link field → a link the core model accepts, or null:
 * `example.com` → `https://example.com`, `a@b.co` → `mailto:a@b.co`, other schemes refused.
 */
export function normalizeLink(input: string): string | null {
  const url = input.trim();
  if (!url) return null;
  if (SAFE_LINK.test(url)) return LinkSchema.safeParse(url).success ? url : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // another scheme (javascript:, data:…)
  const candidate = url.includes("@") && !url.includes("/") ? `mailto:${url}` : `https://${url}`;
  return LinkSchema.safeParse(candidate).success ? candidate : null;
}
