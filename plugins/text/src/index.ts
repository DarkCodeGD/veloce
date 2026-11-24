/**
 * Built-in `text` element: headings, paragraphs, bullet/numbered lists and inline rich text.
 *
 * Security: all text goes in through `textContent` (never innerHTML), and links are re-checked
 * at render time (http/https/mailto only), so deck content can't inject markup or scripts.
 */
import {
  ColorSchema,
  type EffectContext,
  type FieldValues,
  type Paragraph,
  runText,
  type TextContent,
  TextContentSchema,
  type TextRun,
  type TokenRef,
  textStyleCss,
  tokenCssVar,
  tokenRefSchema,
  toParagraphs,
} from "@veloce/core";
import { cssColor, defineEffect, defineElement, definePlugin, z } from "@veloce/plugin-api";

export const TextPropsSchema = z.strictObject({
  /** A string ("\n" separates paragraphs) or rich paragraphs with styled runs. */
  content: TextContentSchema,
  /** Theme text style. Default: `"$text.body"`. */
  style: tokenRefSchema("text").optional(),
  /** Default: `"$color.text"`. */
  color: ColorSchema.optional(),
  /** Default: `"left"`. */
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  /** Where text sits when the box is taller than the text. Default: `"top"`. */
  verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
  /** Overrides of the theme text style (use sparingly; prefer another `style`). */
  fontSize: z.number().positive().max(2000).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  font: tokenRefSchema("font").optional(),
  italic: z.boolean().optional(),
  lineHeight: z.number().positive().max(10).optional(),
  /**
   * Animation only (the typewriter effect, D117): the share of characters shown, 0 to 1;
   * the rest keep their place, invisible, so nothing reflows while it types. Default 1.
   */
  reveal: z.number().min(0).max(1).meta({ animationOnly: true }).optional(),
  /**
   * Animation only (the count-up effect, D117): how far every number in the text has
   * counted up from 0, 0 to 1, keeping its decimals and thousands separators. Default 1.
   */
  countUp: z.number().min(0).max(1).meta({ animationOnly: true }).optional(),
});
export type TextProps = z.infer<typeof TextPropsSchema>;

const DEFAULT_STYLE: TokenRef<"text"> = "$text.body";
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

const AI_DOCS = `# text

Headings, body copy, captions and bullet lists. Size and font come from theme text styles. Use \`style\` and avoid raw font sizes.

**Props**
- \`content\`: a string (\`"\\n"\` starts a new paragraph) or rich paragraphs: \`[{ runs: [...], list?: "bullet" | "number", level?: 0–8, align?, style? }]\` (a paragraph \`style\` overrides the layer's for that paragraph)
  - a run: \`{ text, bold?, italic?, underline?, strike?, code?, color?, link? }\`: every run has \`text\`, except a field run, which has \`field\` instead (\`code\`: inline monospace; \`link\`: https/mailto, drawn in the text's color, underlined)
  - a field run draws a live value: \`{ "field": "slideNumber" | "slideCount" | "date" | "deckTitle" | "section" }\`, e.g. "Slide 3 of 12" is \`[{ "text": "Slide " }, { "field": "slideNumber" }, { "text": " of " }, { "field": "slideCount" }]\`. For a number on every slide, set the deck's footer instead (get_docs("sections")).
- \`style\`: \`"$text.display" | "$text.h1" | "$text.h2" | "$text.h3" | "$text.lead" | "$text.body" | "$text.small" | "$text.caption" | "$text.code"\` (default body). Headings (display, h1–h3) are bold; \`"$text.lead"\` is large regular-weight body text, for bullets and short paragraphs that fill a content slide (the layouts' text uses it). Each style's font (heading or body), size, weight and case (caption may be UPPERCASE) are listed in get_docs("theme").
- \`color\`: a color token such as \`"$color.muted"\` (default \`"$color.text"\`)
- \`align\`: \`"left" | "center" | "right" | "justify"\`; \`verticalAlign\`: \`"top" | "middle" | "bottom"\`
- Overrides of the style, used sparingly: \`fontSize\`, \`fontWeight\`, \`font\` (\`"$font.heading"\`…), \`italic\`, \`lineHeight\`

**Example:** a title
\`{ "type": "text", "props": { "content": "Q3 Results", "style": "$text.h1" } }\`

**Example:** bullets
\`{ "content": [{ "runs": [{ "text": "Faster" }], "list": "bullet" }, { "runs": [{ "text": "Cheaper" }], "list": "bullet" }] }\`

**Tips:** One idea per slide. Keep body text under ~40 words. Default width is "fill" and height is "hug", so text wraps to its frame.`;

export const textElement = defineElement<TextProps>({
  type: "text",
  title: "Text",
  description: "Headings, paragraphs and lists styled by the theme's text styles.",
  propsSchema: TextPropsSchema,
  defaultProps: { content: "Text", style: DEFAULT_STYLE },
  defaultSize: { width: "fill", height: "hug" },
  deterministic: true,
  aiDocs: AI_DOCS,
  mount(container, props, ctx) {
    const root = document.createElement("div");
    root.className = "v-text";
    container.append(root);
    const render = (p: TextProps) => {
      applyBoxStyle(root, p);
      root.replaceChildren(
        ...renderParagraphs(p.content, ctx.fields?.(), { reveal: p.reveal, countUp: p.countUp }),
      );
    };
    render(props);
    return {
      update: render,
      seek: () => {}, // static element: nothing changes over time
      dispose: () => root.remove(),
    };
  },
});

// ── Text effects (D117) ──────────────────────────────────────────────────────────────

/** The characters a text layer shows, fields as their own text (a fair length estimate). */
function characterCount(target: EffectContext["target"]): number {
  if (target.kind !== "element") return 0;
  const parsed = TextContentSchema.safeParse(target.props.content);
  if (!parsed.success) return 0;
  return toParagraphs(parsed.data).reduce(
    (sum, p) => sum + p.runs.reduce((n, run) => n + Array.from(runText(run, null)).length, 0),
    0,
  );
}

/** The longest a typewriter takes by default, however long the text. */
const MAX_TYPING_MS = 8000;

export const typewriterEffect = defineEffect({
  name: "typewriter",
  title: "Typewriter",
  description: "Types the text out, character by character.",
  kind: "entrance",
  targets: ["text"],
  paramsSchema: z.strictObject({}),
  defaultParams: {},
  aiDocs:
    "Types a text layer out character by character; the text keeps its final layout, so nothing jumps. Its duration follows the text's length (about a tenth of `$motion.normal` per character, so it follows the level, up to 8 s); set `duration` to choose. Best on short lines: a title, a quote, a command.",
  resolve: (_, { target, tokens }) => ({
    duration: Math.round(
      Math.min(
        MAX_TYPING_MS,
        Math.max(tokens.normal, (characterCount(target) * tokens.normal) / 10),
      ),
    ),
    easing: "linear",
    tracks: {
      "props.reveal": [
        { at: 0, value: 0 },
        { at: 1, value: 1 },
      ],
    },
  }),
});

export const countUpEffect = defineEffect({
  name: "count-up",
  title: "Count up",
  description: "Counts the numbers in the text up from zero.",
  kind: "entrance",
  targets: ["text"],
  paramsSchema: z.strictObject({}),
  defaultParams: {},
  aiDocs:
    'Counts every number in a text layer up from 0 to its value, keeping its format: "$4.2M" counts 0.0 → 4.2, "12,500 users" keeps its comma. For stats and key numbers; every number in the layer counts, so keep the year out of it.',
  resolve: () => ({
    duration: "$motion.slow",
    easing: "$motion.enter",
    tracks: {
      "props.countUp": [
        { at: 0, value: 0 },
        { at: 1, value: 1 },
      ],
    },
  }),
});

export const textPlugin = definePlugin({
  manifest: {
    id: "veloce.text",
    name: "Text",
    version: "0.1.0",
    description: "Built-in text element, and the effects only text has.",
    license: "Apache-2.0",
  },
  elements: [textElement],
  effects: [typewriterEffect, countUpEffect],
});

// ── Rendering ─────────────────────────────────────────────────────────────────────────

function applyBoxStyle(el: HTMLElement, p: TextProps): void {
  const style = p.style ?? DEFAULT_STYLE;
  const s = el.style;
  s.cssText = "";
  s.boxSizing = "border-box";
  s.width = "100%";
  s.height = "100%";
  s.display = "flex";
  s.flexDirection = "column";
  s.justifyContent = { top: "flex-start", middle: "center", bottom: "flex-end" }[
    p.verticalAlign ?? "top"
  ];
  s.whiteSpace = "pre-wrap";
  s.overflowWrap = "break-word";
  s.textAlign = p.align ?? "left";
  s.color = cssColor(p.color ?? "$color.text");
  s.fontFamily = p.font ? tokenCssVar(p.font) : tokenCssVar(style, "font");
  s.fontSize = p.fontSize ? `${p.fontSize}px` : tokenCssVar(style, "size");
  s.fontWeight = p.fontWeight ? String(p.fontWeight) : tokenCssVar(style, "weight");
  s.lineHeight = p.lineHeight ? String(p.lineHeight) : tokenCssVar(style, "line-height");
  s.letterSpacing = tokenCssVar(style, "letter-spacing");
  s.textTransform = tokenCssVar(style, "transform");
  if (p.italic) s.fontStyle = "italic";
}

/** Mid-animation states of the text (D117). Absent or 1: the text as it is. */
export interface TextProgress {
  /** Share of characters shown (typewriter). */
  reveal?: number | undefined;
  /** How far numbers have counted up from 0 (count-up). */
  countUp?: number | undefined;
}

/** A number as written in text: `12,500`, `4.2`, `99`. */
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/**
 * `text` with every number at `progress` of its value, written the same way: as many
 * decimals, and thousands separators if it had them. Deterministic (no locale).
 */
export function countedText(text: string, progress: number): string {
  if (progress >= 1) return text;
  return text.replace(NUMBER, (match) => {
    const plain = match.replaceAll(",", "");
    const decimals = plain.split(".")[1]?.length ?? 0;
    const [whole = "0", fraction] = (Number(plain) * Math.max(0, progress))
      .toFixed(decimals)
      .split(".");
    const grouped = match.includes(",") ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
    return fraction === undefined ? grouped : `${grouped}.${fraction}`;
  });
}

/**
 * Paragraphs → DOM. Consecutive list paragraphs are grouped into real <ul>/<ol> elements
 * (nested by `level`), so lists stay semantic for screen readers and copy/paste.
 */
export function renderParagraphs(
  content: TextContent,
  fields?: FieldValues | null,
  progress: TextProgress = {},
): Node[] {
  const out: Node[] = [];
  const stack: Array<{ list: HTMLElement; type: "bullet" | "number"; level: number }> = [];
  const paragraphs = toParagraphs(content);
  const count = progress.countUp ?? 1;
  const texts = paragraphs.map((p) =>
    p.runs.map((run) => countedText(runText(run, fields), count)),
  );
  // Characters the typewriter has shown so far, spent run by run in reading order.
  const reveal = progress.reveal ?? 1;
  const total = texts.flat().reduce((n, t) => n + Array.from(t).length, 0);
  const budget = { left: reveal >= 1 ? Number.POSITIVE_INFINITY : Math.floor(reveal * total) };
  const element = (tag: "p" | "li", i: number) =>
    paragraphElement(tag, paragraphs[i] as Paragraph, texts[i] ?? [], budget);

  for (const [i, paragraph] of paragraphs.entries()) {
    if (!paragraph.list) {
      stack.length = 0;
      out.push(element("p", i));
      continue;
    }
    const level = paragraph.level ?? 0;
    let top = stack.at(-1);
    while (top && (top.level > level || (top.level === level && top.type !== paragraph.list))) {
      stack.pop();
      top = stack.at(-1);
    }
    if (!top || top.level < level) {
      const list = document.createElement(paragraph.list === "number" ? "ol" : "ul");
      list.style.margin = "0";
      // Markers hang in the padding: "1." is twice a bullet's width, so numbers get more room
      // (else they sit flush with the frame's edge while bullets are indented).
      list.style.paddingLeft = paragraph.list === "number" ? "1.8em" : "1.2em";
      if (top) (top.list.lastElementChild ?? top.list).append(list);
      else out.push(list);
      top = { list, type: paragraph.list, level };
      stack.push(top);
    }
    top.list.append(element("li", i));
  }
  return out;
}

function paragraphElement(
  tag: "p" | "li",
  paragraph: Paragraph,
  texts: readonly string[],
  budget: { left: number },
): HTMLElement {
  const el = document.createElement(tag);
  el.style.margin = "0";
  // Not typed yet: kept in place but invisible, its bullet or number too.
  if (budget.left <= 0) el.style.visibility = "hidden";
  if (paragraph.align) el.style.textAlign = paragraph.align;
  if (paragraph.style) {
    // The whole style (letter-spacing and case too), so a "display" paragraph inside a body
    // layer looks exactly like a "display" layer.
    for (const [prop, value] of Object.entries(textStyleCss(paragraph.style))) {
      el.style.setProperty(prop, value);
    }
  }
  if (texts.every((t) => t === "")) {
    el.append(document.createElement("br")); // keep empty lines one line tall
  } else {
    el.append(
      ...paragraph.runs.map((run, i) => {
        const text = texts[i] ?? "";
        const shown = Math.min(budget.left, Array.from(text).length);
        budget.left -= shown;
        return runElement(run, text, shown);
      }),
    );
  }
  return el;
}

/** A run, its first `shown` characters visible and the rest holding their place. */
function runElement(run: TextRun, text: string, shown = Number.POSITIVE_INFINITY): HTMLElement {
  const isLink = run.link !== undefined && SAFE_LINK.test(run.link);
  const el = document.createElement(isLink ? "a" : "span");
  const chars = Array.from(text);
  if (shown >= chars.length) {
    el.textContent = text;
  } else {
    const rest = document.createElement("span");
    rest.style.visibility = "hidden";
    rest.textContent = chars.slice(shown).join("");
    el.append(chars.slice(0, shown).join(""), rest);
  }
  if (run.field) el.dataset.vField = run.field;
  if (isLink && el instanceof HTMLAnchorElement && run.link) {
    el.href = run.link;
    el.rel = "noopener noreferrer";
    el.target = "_blank";
  }
  const s = el.style;
  if (run.bold) s.fontWeight = "700";
  if (run.italic) s.fontStyle = "italic";
  // Links read like the text around them, underlined (never the browser's blue, which
  // ignores the theme and fails contrast on dark slides); a run color still applies.
  if (isLink) s.color = "inherit";
  const underline = run.underline || isLink;
  const decorations = [underline && "underline", run.strike && "line-through"].filter(Boolean);
  if (decorations.length) s.textDecorationLine = decorations.join(" ");
  if (run.code) {
    s.fontFamily = "var(--v-font-mono, monospace)";
    s.fontSize = "0.9em";
  }
  if (run.color) s.color = cssColor(run.color);
  return el;
}
