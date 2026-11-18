/**
 * The TipTap (ProseMirror) editor behind on-slide text editing, limited to what the core
 * rich text model can hold (model/rich-text-doc.ts maps between the two): paragraphs, bullet
 * and numbered lists, bold/italic/underline/strike/code, links and colors. Headings, quotes,
 * code blocks and rules are switched off; a heading is a text *style* (`$text.h1`) here.
 *
 * Paragraphs carry two extra attributes (alignment and a text style token) and colors are a
 * mark that keeps the core value (`$color.primary` stays a token, rendered as its CSS var).
 */
import { Editor, Extension, Mark, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { isTokenRef, type TextContent, tokenCssVar } from "@veloce/core";
import { cssColor } from "@veloce/plugin-api";
import { DOC, type DocNode, toDoc } from "../model/rich-text-doc.js";

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;
const ALIGNS = ["left", "center", "right", "justify"];
/** CSS set by a paragraph's text style: the same properties the text plugin sets. */
const PARAGRAPH_STYLE_PROPS = [
  ["font-family", "font"],
  ["font-size", "size"],
  ["font-weight", "weight"],
  ["line-height", "line-height"],
] as const;

/** Paragraph alignment and text style (`$text.h2`), as in the core Paragraph. */
const ParagraphAttributes = Extension.create({
  name: "veloceParagraph",
  addGlobalAttributes() {
    return [
      {
        types: [DOC.paragraph],
        attributes: {
          align: {
            default: null,
            parseHTML: (el) => (ALIGNS.includes(el.style.textAlign) ? el.style.textAlign : null),
            renderHTML: (attrs) => (attrs.align ? { style: `text-align: ${attrs.align}` } : {}),
          },
          textStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-v-style"),
            renderHTML: (attrs) => {
              const ref = attrs.textStyle;
              if (typeof ref !== "string" || !isTokenRef(ref)) return {};
              const style = PARAGRAPH_STYLE_PROPS.map(
                ([prop, part]) => `${prop}: ${tokenCssVar(ref, part)}`,
              ).join("; ");
              return { "data-v-style": ref, style };
            },
          },
        },
      },
    ];
  },
});

/** Text color holding a core Color: a theme token or a CSS color. */
const ColorMark = Mark.create({
  name: DOC.color,
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-v-color"),
        renderHTML: (attrs) =>
          typeof attrs.color === "string"
            ? { "data-v-color": attrs.color, style: `color: ${cssColor(attrs.color)}` }
            : {},
      },
    };
  },
  // Only our own spans: pasted inline colors from other apps aren't theme colors.
  parseHTML: () => [{ tag: "span[data-v-color]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes), 0],
});

export interface TextEditorOptions {
  /** Where the editable goes (it fills it). */
  element: HTMLElement;
  content: TextContent;
  /** Every change to the text or its formatting. */
  onChange(doc: DocNode): void;
  /** Esc: done editing. */
  onExit(): void;
  /** Selection or formatting changed (toolbar state). */
  onSelectionChange(): void;
}

export function createTextEditor(options: TextEditorOptions): Editor {
  return new Editor({
    element: options.element,
    content: toDoc(options.content),
    extensions: [
      StarterKit.configure({
        // Block types the core model has no place for.
        blockquote: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        hardBreak: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["mailto"],
          // Same rule as the core LinkSchema and the renderer: web and mail links only.
          isAllowedUri: (url) => SAFE_LINK.test(url),
        },
      }),
      ParagraphAttributes,
      ColorMark,
    ],
    editorProps: {
      attributes: { class: "text-edit-content", "aria-label": "Text", spellcheck: "true" },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Escape") return false;
        event.preventDefault();
        options.onExit();
        return true;
      },
    },
    onUpdate: ({ editor }) => options.onChange(editor.getJSON() as DocNode),
    onSelectionUpdate: () => options.onSelectionChange(),
    onTransaction: () => options.onSelectionChange(),
  });
}
