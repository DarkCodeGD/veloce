/**
 * The TipTap (ProseMirror) editor behind on-slide text editing, limited to what the core
 * rich text model can hold (model/rich-text-doc.ts maps between the two): paragraphs, bullet
 * and numbered lists, bold/italic/underline/strike/code, links and colors. Headings, quotes,
 * code blocks and rules are switched off; a heading is a text *style* (`$text.h1`) here.
 *
 * Paragraphs carry two extra attributes (alignment and a text style token) and colors are a
 * mark that keeps the core value (`$color.primary` stays a token, rendered as its CSS var).
 * Fields (D97) are inline atoms showing the slide's current value.
 */
import { Editor, Extension, Mark, mergeAttributes, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  FieldNameSchema,
  type FieldValues,
  isTokenRef,
  runText,
  type TextContent,
  textStyleCss,
} from "@veloce/core";
import { cssColor } from "@veloce/plugin-api";
import { DOC, type DocNode, toDoc } from "../model/rich-text-doc.js";
import { proseMirrorKey, SHORTCUTS } from "../model/shortcuts.js";

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;
const ALIGNS = ["left", "center", "right", "justify"];

/** Paragraph alignment shortcuts (model/shortcuts.ts, shown in the toolbar's tooltips). */
const ALIGN_KEYS = {
  left: SHORTCUTS.textAlignLeft,
  center: SHORTCUTS.textAlignCenter,
  right: SHORTCUTS.textAlignRight,
  justify: SHORTCUTS.textAlignJustify,
} as const;

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
              // The same CSS the text plugin gives a styled paragraph (core TEXT_STYLE_CSS).
              const style = Object.entries(textStyleCss(ref))
                .map(([prop, value]) => `${prop}: ${value}`)
                .join("; ");
              return { "data-v-style": ref, style };
            },
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    const align = (value: string) => () =>
      this.editor.commands.updateAttributes(DOC.paragraph, { align: value });
    return Object.fromEntries(
      Object.entries(ALIGN_KEYS).map(([value, spec]) => [proseMirrorKey(spec), align(value)]),
    );
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

/**
 * A field: one unit the caret steps over, drawn as this slide's value (what the slide shows),
 * keeping its name and the text it was written with (rich-text-doc.ts maps both).
 */
const fieldNode = (values: FieldValues | null) =>
  Node.create({
    name: DOC.field,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        field: { default: null, parseHTML: (el) => el.getAttribute("data-v-field") },
        text: { default: "", parseHTML: (el) => el.textContent ?? "" },
      };
    },
    // Only our own fields: copied from another slide, they show this slide's value.
    parseHTML: () => [{ tag: "span[data-v-field]" }],
    renderHTML: ({ node, HTMLAttributes }) => [
      "span",
      mergeAttributes(HTMLAttributes, { "data-v-field": node.attrs.field, class: "text-field" }),
      shownText(node.attrs, values),
    ],
    renderText: ({ node }) => shownText(node.attrs, values),
  });

function shownText(attrs: Record<string, unknown>, values: FieldValues | null): string {
  const field = FieldNameSchema.safeParse(attrs.field);
  const text = typeof attrs.text === "string" ? attrs.text : "";
  return runText(field.success ? { text, field: field.data } : { text }, values);
}

export interface TextEditorOptions {
  /** Where the editable goes (it fills it). */
  element: HTMLElement;
  content: TextContent;
  /** What fields show on this slide (D97). */
  fields: FieldValues | null;
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
      fieldNode(options.fields),
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
