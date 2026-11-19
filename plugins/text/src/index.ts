/**
 * Built-in `text` element: headings, paragraphs, bullet/numbered lists and inline rich text.
 *
 * Security: all text goes in through `textContent` (never innerHTML), and links are re-checked
 * at render time (http/https/mailto only), so deck content can't inject markup or scripts.
 */
import {
  ColorSchema,
  type Paragraph,
  type TextContent,
  TextContentSchema,
  type TextRun,
  type TokenRef,
  textStyleCss,
  tokenCssVar,
  tokenRefSchema,
  toParagraphs,
} from "@veloce/core";
import { cssColor, defineElement, definePlugin, z } from "@veloce/plugin-api";

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
});
export type TextProps = z.infer<typeof TextPropsSchema>;

const DEFAULT_STYLE: TokenRef<"text"> = "$text.body";
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

const AI_DOCS = `# text

Headings, body copy, captions and bullet lists. Size and font come from theme text styles. Use \`style\` and avoid raw font sizes.

**Props**
- \`content\`: a string (\`"\\n"\` starts a new paragraph) or rich paragraphs: \`[{ runs: [...], list?: "bullet" | "number", level?: 0–5, align?, style? }]\` (a paragraph \`style\` overrides the layer's for that paragraph)
  - a run: \`{ text, bold?, italic?, underline?, strike?, code?, color?, link? }\` (\`code\`: inline monospace; \`link\`: https/mailto, drawn in the text's color, underlined)
- \`style\`: \`"$text.display" | "$text.h1" | "$text.h2" | "$text.h3" | "$text.body" | "$text.small" | "$text.caption" | "$text.code"\` (default body). Each style's font (heading or body), size, weight and case (caption may be UPPERCASE) are listed in get_docs("theme").
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
  mount(container, props) {
    const root = document.createElement("div");
    root.className = "v-text";
    container.append(root);
    const render = (p: TextProps) => {
      applyBoxStyle(root, p);
      root.replaceChildren(...renderParagraphs(p.content));
    };
    render(props);
    return {
      update: render,
      seek: () => {}, // static element: nothing changes over time
      dispose: () => root.remove(),
    };
  },
});

export const textPlugin = definePlugin({
  manifest: {
    id: "veloce.text",
    name: "Text",
    version: "0.1.0",
    description: "Built-in text element.",
    license: "Apache-2.0",
  },
  elements: [textElement],
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

/**
 * Paragraphs → DOM. Consecutive list paragraphs are grouped into real <ul>/<ol> elements
 * (nested by `level`), so lists stay semantic for screen readers and copy/paste.
 */
export function renderParagraphs(content: TextContent): Node[] {
  const out: Node[] = [];
  const stack: Array<{ list: HTMLElement; type: "bullet" | "number"; level: number }> = [];

  for (const paragraph of toParagraphs(content)) {
    if (!paragraph.list) {
      stack.length = 0;
      out.push(paragraphElement("p", paragraph));
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
      list.style.paddingLeft = "1.2em";
      if (top) (top.list.lastElementChild ?? top.list).append(list);
      else out.push(list);
      top = { list, type: paragraph.list, level };
      stack.push(top);
    }
    top.list.append(paragraphElement("li", paragraph));
  }
  return out;
}

function paragraphElement(tag: "p" | "li", paragraph: Paragraph): HTMLElement {
  const el = document.createElement(tag);
  el.style.margin = "0";
  if (paragraph.align) el.style.textAlign = paragraph.align;
  if (paragraph.style) {
    // The whole style (letter-spacing and case too), so a "display" paragraph inside a body
    // layer looks exactly like a "display" layer.
    for (const [prop, value] of Object.entries(textStyleCss(paragraph.style))) {
      el.style.setProperty(prop, value);
    }
  }
  if (paragraph.runs.length === 0 || paragraph.runs.every((r) => r.text === "")) {
    el.append(document.createElement("br")); // keep empty lines one line tall
  } else {
    el.append(...paragraph.runs.map(runElement));
  }
  return el;
}

function runElement(run: TextRun): HTMLElement {
  const isLink = run.link !== undefined && SAFE_LINK.test(run.link);
  const el = document.createElement(isLink ? "a" : "span");
  el.textContent = run.text;
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
