/**
 * Built-in slide layouts (D95): the slides every deck needs (title, title + content, two
 * columns, section header…), ready to `use` without saving anything. They're built from
 * theme tokens only, so they take on whatever theme the deck has. A deck's own component
 * with the same name wins: saving a slide as "Title" restyles that deck's title slides.
 *
 * Title and Section header slides leave the deck's footer off (D97), as title slides do in
 * PowerPoint.
 *
 * Template IDs are short words (`title`, `content`): a slide `s3` made from one gets
 * `s3-title`, `s3-content`.
 */
import { element, frame } from "./builders.js";
import type { Component } from "./schema/component.js";
import type { Deck } from "./schema/deck.js";
import type { Layout } from "./schema/node.js";

const text = (id: string, content: string, style: string, extra: Record<string, unknown> = {}) =>
  element("text", { content, style: `$text.${style}`, ...extra }, { id, name: label(id) });

/** "subtitle" → "Subtitle": layer names people see in Layers. */
const label = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

const column = (overrides: Partial<Extract<Layout, { mode: "stack" }>> = {}): Layout => ({
  mode: "stack",
  direction: "column",
  gap: "$space.md",
  padding: "$space.xl",
  justify: "center",
  ...overrides,
});

const target = (id: string, description: string) => ({
  description,
  targets: [`${id}.props.content`],
});

export const BUILTIN_LAYOUTS: Readonly<Record<string, Component>> = {
  Title: {
    description: "Opening slide: a big title and a subtitle, centered",
    params: {
      title: target("title", "The deck's title"),
      subtitle: target("subtitle", "One line under it"),
    },
    node: frame({
      id: "root",
      layout: column({ align: "center", gap: "$space.sm" }),
      children: [
        text("title", "Title", "display", { align: "center" }),
        text("subtitle", "Subtitle", "h3", { align: "center", color: "$color.muted" }),
      ],
    }),
    slide: { hideFooter: true },
  },
  "Title and content": {
    description: "A title, then the content: a line of text, or children given with use",
    params: {
      title: target("title", "The slide's takeaway"),
      body: target("body", "The content, when it's text"),
    },
    node: frame({
      id: "root",
      layout: column({ justify: "start" }),
      children: [
        text("title", "Title", "h1"),
        frame({
          id: "content",
          name: "Content",
          height: "fill",
          layout: { mode: "stack", gap: "$space.md" },
          children: [text("body", "Content", "body")],
        }),
      ],
    }),
    slot: "content",
    slide: {},
  },
  "Two columns": {
    description: "A title over two columns of text, side by side",
    params: {
      title: target("title", "The slide's takeaway"),
      left: target("left", "The left column"),
      right: target("right", "The right column"),
    },
    node: frame({
      id: "root",
      layout: column({ justify: "start" }),
      children: [
        text("title", "Title", "h1"),
        frame({
          id: "columns",
          name: "Columns",
          height: "fill",
          layout: { mode: "grid", columns: 2, gap: "$space.lg" },
          children: [text("left", "Left column", "body"), text("right", "Right column", "body")],
        }),
      ],
    }),
    slide: {},
  },
  "Section header": {
    description: "Opens a part of the talk: a section title on the primary color",
    params: {
      title: target("title", "The section's name"),
      subtitle: target("subtitle", "One line about it"),
    },
    node: frame({
      id: "root",
      layout: column({ gap: "$space.sm" }),
      children: [
        text("title", "Section", "h1", { color: "$color.on-primary" }),
        text("subtitle", "What this part covers", "h3", { color: "$color.on-primary" }),
      ],
    }),
    slide: { background: "$color.primary", hideFooter: true },
  },
  "Big number": {
    description: "One number that tells the story, with what it means",
    params: {
      number: target("number", 'The figure, e.g. "3×" or "48%"'),
      caption: target("caption", "What it means"),
    },
    node: frame({
      id: "root",
      layout: column({ align: "center", gap: "$space.sm" }),
      children: [
        text("number", "42%", "display", { align: "center", color: "$color.primary" }),
        text("caption", "of what it measures", "h3", { align: "center" }),
      ],
    }),
    slide: {},
  },
  Quote: {
    description: "A quote and who said it",
    params: {
      quote: target("quote", "The words, without quote marks"),
      author: target("author", "Who said it"),
    },
    node: frame({
      id: "root",
      layout: column({ gap: "$space.md" }),
      children: [
        text("quote", "“A sentence worth remembering.”", "h2"),
        text("author", "— Name, Role", "body", { color: "$color.muted" }),
      ],
    }),
    slide: {},
  },
};

/**
 * The component `use` means by `name`: the deck's own, else a built-in layout. Own keys
 * only, so "constructor" is just a name.
 */
export function findComponent(deck: Pick<Deck, "components">, name: string): Component | undefined {
  const own = deck.components ?? {};
  if (Object.hasOwn(own, name)) return own[name];
  // A deck's "title" replaces the built-in "Title" too (names are unique ignoring case).
  const lower = name.toLowerCase();
  if (Object.keys(own).some((n) => n.toLowerCase() === lower)) return undefined;
  return Object.hasOwn(BUILTIN_LAYOUTS, name) ? BUILTIN_LAYOUTS[name] : undefined;
}

/** Every slide layout `use` can name: the deck's own, then the built-ins it doesn't replace. */
export function slideLayouts(
  deck: Pick<Deck, "components">,
): Array<{ name: string; component: Component; builtin: boolean }> {
  const own = Object.entries(deck.components ?? {})
    .filter(([, c]) => c.slide)
    .map(([name, component]) => ({ name, component, builtin: false }));
  const taken = new Set(Object.keys(deck.components ?? {}).map((n) => n.toLowerCase()));
  const builtins = Object.entries(BUILTIN_LAYOUTS)
    .filter(([name]) => !taken.has(name.toLowerCase()))
    .map(([name, component]) => ({ name, component, builtin: true }));
  return [...own, ...builtins];
}
