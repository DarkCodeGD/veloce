/**
 * What agents learn from (D13): short server `instructions` (always loaded) plus deeper topics
 * fetched on demand with `get_docs`. Theme and element docs are generated from the live theme
 * and plugin registry, so they can't drift from what the engine actually accepts.
 */
import { BUILTIN_THEMES, BUNDLED_FONTS, type Deck, LINT_RULES, type Theme } from "@veloce/core";
import type { PluginRegistry } from "@veloce/plugin-api";

export const INSTRUCTIONS = `Veloce builds presentation decks. The user watches the deck update live in the Veloce editor.

Workflow:
1. get_deck_summary to see the current deck. If it already has slides and the user asks for a new presentation, create_deck (choosing a theme) instead of changing theirs.
2. Build each slide with upsert_slide: describe structure (frames with stack/grid layout), not pixel positions. The engine lays it out.
3. Read the lint issues returned with every change and fix them (overflow, contrast, overlaps).
4. render_preview a slide to check it visually when it matters. Fix, then move on.

Rules:
- Use theme tokens ("$color.primary", "$text.h1", "$space.lg"), not raw colors and font sizes.
- One idea per slide, short text, strong hierarchy. Detail goes in speaker notes.
- Use the IDs returned by tools to edit nodes (apply_ops with node.update / node.insert / node.remove).
- Users edit the same deck. Don't undo or overwrite their changes; undo_agent_changes only reverts yours. upsert_slide only replaces slides you created in this session.

Docs: get_docs("layout"), get_docs("design"), get_docs("theme"), get_docs("ops"), get_docs("element/text").`;

const LAYOUT = `# Layout

A slide's content is a tree. **Frames** lay out their children; **elements** (text, shape, image…) draw things.
Describe structure and let the engine compute positions: content reflows when text changes.

## Frame layouts (\`layout\`)
- \`{ "mode": "stack", "direction": "row" | "column", "gap", "padding", "align", "justify", "wrap" }\`: a row or column (flexbox).
  - \`align\` (cross axis): start | center | end | stretch (default stretch).
  - \`justify\` (main axis): start | center | end | space-between | space-around | space-evenly.
- \`{ "mode": "grid", "columns": 3, "gap", "rowGap", "padding", "align" }\`: equal-width columns.
- \`{ "mode": "absolute", "padding" }\`: children use \`position: { x, y }\`. Only for overlaps and decoration.

\`gap\` and \`padding\` take pixels or space tokens ("$space.md"). Padding can be one value, \`{ x, y }\` or \`{ top, right, bottom, left }\`.

## Sizing (\`width\` / \`height\` on any node)
- \`"fill"\`: take the free space (in a row: share the width; in a column: share the height).
- \`"hug"\`: fit the content.
- a number: fixed pixels.
- omitted: the element's default (text: fill width, hug height; shape 200×200; image 400×300).

## Frame style (\`style\`)
\`{ "fill": color | gradient | image, "stroke": { "color", "width" }, "radius": "$radius.lg", "shadow": "$shadow.md", "clip": true }\`

## Patterns
Title slide (the slide root is already a centered column):
\`{ "children": [ { "type": "text", "props": { "content": "Acme", "style": "$text.display" } }, { "type": "text", "props": { "content": "Tagline", "style": "$text.h3", "color": "$color.muted" } } ] }\`

Two columns:
\`{ "layout": { "mode": "stack", "direction": "row", "gap": "$space.lg", "padding": "$space.xl", "align": "center" }, "children": [ { "children": [ …left… ], "width": "fill" }, { "type": "image", "props": { … }, "width": "fill", "height": 600 } ] }\`

Three cards:
\`{ "layout": { "mode": "grid", "columns": 3, "gap": "$space.md" }, "children": [ { "layout": { "mode": "stack", "gap": "$space.sm", "padding": "$space.md" }, "style": { "fill": "$color.surface", "radius": "$radius.md" }, "children": [ … ] }, … ] }\`

Slide with a title on top and content below: set the slide \`layout\` to \`{ "mode": "stack", "gap": "$space.lg", "padding": "$space.xl", "justify": "start" }\`.`;

const DESIGN = `# Design rules

- **One idea per slide.** The title states the takeaway ("Revenue doubled in Q3"), not the topic ("Revenue").
- **Hierarchy:** one dominant element per slide. Use $text.display/h1 for the main point, $text.body/small for support, $color.muted for secondary text.
- **Brevity:** ≤ 6 bullets, ≤ ~12 words each; ≤ ~40 words of body text per slide. Put detail in speaker notes (\`notes\`).
- **Whitespace:** keep the slide padding; prefer $space tokens for gaps. Don't fill every pixel.
- **Consistency:** same layout for slides of the same kind; same title position across content slides.
- **Color:** text on $color.background or $color.surface uses $color.text/$color.muted; text on $color.primary uses $color.on-primary. Accent colors for emphasis only.
- **Icons:** there is no icon element yet. Don't use symbol characters (arrows, dingbats, emoji) as icons: the bundled fonts only cover text, so they render in a mismatched fallback font. Use shapes, numbers or short words instead.
- **Numbers:** show a big number ($text.display, $color.primary) with a short caption instead of a sentence.
- **Check your work:** fix every lint error; run render_preview on slides with images, many elements or custom layouts.`;

const OPS = `# Ops (apply_ops)

All edits are ops applied as one atomic transaction (all or nothing), undoable with undo_agent_changes.

- \`{ "op": "slide.insert", "slide": <slide like upsert_slide>, "index"? }\`
- \`{ "op": "slide.remove", "id" }\`, \`{ "op": "slide.move", "id", "index" }\`
- \`{ "op": "slide.update", "id", "set": { "name"?, "background"?, "notes"?, "hidden"? } }\`
- \`{ "op": "node.insert", "parentId": <frame id>, "node": <node>, "index"? }\` (index omitted = last)
- \`{ "op": "node.remove", "id" }\`
- \`{ "op": "node.move", "id", "parentId", "index"? }\`
- \`{ "op": "node.update", "id", "set": { … } }\`: JSON Merge Patch. Objects merge, \`null\` deletes a field.
  e.g. \`{ "op": "node.update", "id": "title", "set": { "props": { "content": "New title" }, "width": "fill" } }\`
- \`{ "op": "deck.updateMeta", "set": { "title"?, "description"?, "authors"?, "language"? } }\`

Notes:
- IDs are shared by slides and nodes and unique per deck. Slide roots are frames: insert into them with the root's ID (see get_slide).
- To replace a whole slide, use upsert_slide instead.`;

/**
 * The color pairs agents actually use, in one line. Shown wherever a theme takes effect, so an
 * agent never has to guess (e.g. on-primary is dark in Midnight, white in Light).
 */
export function paletteLine(theme: Theme): string {
  const c = theme.colors;
  return `Palette (${theme.name}): background ${c.background}, surface ${c.surface}, text ${c.text}, muted ${c.muted}, primary ${c.primary} (text on primary fills: $color.on-primary ${c["on-primary"]}), secondary ${c.secondary}, accent ${c.accent}.`;
}

function themeDocs(current: Theme | null): string {
  if (current === null) {
    return `# Theme

No deck is open, so there is no current theme yet. Token values depend on the deck's theme:
pick one with create_deck({ theme }) and call get_docs("theme") again for its full token list.

## Built-in themes
${Object.entries(BUILTIN_THEMES)
  .map(([id, t]) => `- \`${id}\`: ${paletteLine(t)}`)
  .join("\n")}`;
  }
  const list = (record: Record<string, unknown>, group: string, show: (v: never) => string) =>
    Object.entries(record)
      .map(([name, v]) => `- \`$${group}.${name}\`: ${show(v as never)}`)
      .join("\n");
  const themes = Object.entries(BUILTIN_THEMES)
    .map(
      ([id, t]) =>
        `- \`${id}\`: ${t.name} (background ${t.colors.background}, primary ${t.colors.primary})`,
    )
    .join("\n");
  return `# Theme

Content references theme tokens; switching themes (set_theme) restyles everything.
Current theme: **${current.name}**. ${paletteLine(current)}

## Built-in themes
${themes}

set_theme also takes overrides on top of a theme, e.g. brand colors:
\`{ "theme": { "base": "light", "colors": { "primary": "#e11d48" } } }\`

## Colors
${list(current.colors, "color", (v: string) => v)}

## Text styles (use as \`style\` on text)
${list(current.text, "text", (v: { size: number; weight: number }) => `${v.size}px, weight ${v.weight}`)}

## Spacing / radius / shadow
${list(current.space, "space", (v: number) => `${v}px`)}
${list(current.radius, "radius", (v: number) => `${v}px`)}
${list(current.shadow, "shadow", () => "shadow")}

## Fonts
${list(current.fonts, "font", (v: string) => v)}

Bundled with Veloce (they look the same on every machine; other fonts only render where
installed). Set them with set_theme, e.g. \`{ "theme": { "fonts": { "heading": "Fraunces, Georgia, serif" } } }\`:
${BUNDLED_FONTS.map((f) => `- ${f.family} (\`${f.stack}\`): ${f.note}`).join("\n")}`;
}

export function docTopics(registry: PluginRegistry): string[] {
  return [
    "layout",
    "design",
    "theme",
    "ops",
    "lint",
    ...registry.types().map((t) => `element/${t}`),
  ];
}

/** Markdown for a topic, or null if the topic doesn't exist. */
export function getDocs(topic: string, registry: PluginRegistry, deck: Deck | null): string | null {
  const key = topic
    .trim()
    .toLowerCase()
    .replace(/^elements?[/:]/, "element/");
  switch (key) {
    case "layout":
      return LAYOUT;
    case "design":
      return DESIGN;
    case "ops":
      return OPS;
    case "theme":
      return themeDocs(deck?.theme ?? null);
    case "lint":
      return `# Lint rules\n\n${Object.entries(LINT_RULES)
        .map(([rule, what]) => `- \`${rule}\`: ${what}`)
        .join(
          "\n",
        )}\n\nVisual rules (overflow, off-canvas, overlap, contrast, small text) need the headless renderer.`;
  }
  if (key.startsWith("element/")) {
    const registered = registry.get(key.slice("element/".length));
    return registered ? registered.definition.aiDocs : null;
  }
  return null;
}
