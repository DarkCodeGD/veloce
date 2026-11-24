/**
 * What agents learn from (D13): short server `instructions` (always loaded) plus deeper topics
 * fetched on demand with `get_docs`. Theme and element docs are generated from the live theme
 * and plugin registry, so they can't drift from what the engine actually accepts.
 */
import {
  BUILTIN_THEMES,
  BUNDLED_FONTS,
  type Deck,
  deckFontFamilies,
  deckFontStack,
  LINT_RULES,
  type TextStyle,
  type Theme,
} from "@veloce/core";
import type { PluginRegistry } from "@veloce/plugin-api";

export const INSTRUCTIONS = `Veloce builds presentation decks. The user watches the deck update live in the Veloce editor.

Workflow:
1. get_deck_summary to see the current deck. If it already has slides and the user asks for a new presentation, create_deck (choosing a theme) instead of changing theirs. Your current deck stays yours for this session: create_deck and open_deck set it, and the user (or another agent) switching decks doesn't move it.
2. Build each slide with upsert_slide: describe structure (frames with stack/grid layout), not pixel positions. The engine lays it out.
3. Read the lint issues returned with every change and fix them (overflow, contrast, overlaps).
4. render_preview a slide to check it visually when it matters. Fix, then move on.

Rules:
- Use theme tokens ("$color.primary", "$text.h1", "$space.lg"), not raw colors and font sizes.
- One idea per slide, short text, strong hierarchy. Detail goes in speaker notes.
- Use the IDs returned by tools to edit nodes (apply_ops with node.update / node.insert / node.remove).
- Something repeats (cards, tiles, badges, a drawing made of shapes)? Build it once, save_component it with params, then insert copies with { "use": "<name>", "with": { … } } wherever a node goes. Copies are plain nodes you edit like any other.
- Slide layouts (Title, Title and content, Two columns, Section header, Big number, Quote, and the deck's own) start a slide: upsert_slide { "slide": { "use": "Title and content", "with": { "title": "…" }, "children": [ … ] } }.
- Sections, slide numbers and footers: "section" on a slide starts a named section; the deck's footer (date, text, slide number on every slide) is one deck.setFooter op; live text like "Slide 3 of 12" uses field runs. See get_docs("sections").
- Users edit the same deck. Don't undo or overwrite their changes; undo_agent_changes only reverts yours. upsert_slide only replaces slides you created in this session.
- Tool results start with what the user (or another agent) changed since your last call. A revert or a deleted slide is the user's decision: don't redo that work unless they ask.

Docs: get_docs("layout"), get_docs("design"), get_docs("theme"), get_docs("ops"), get_docs("components"), get_docs("sections"), get_docs("element/text").`;

const LAYOUT = `# Layout

A slide's content is a tree. **Frames** lay out their children; **elements** (text, shape, image…) draw things.
Describe structure and let the engine compute positions: content reflows when text changes.

## Frame layouts (\`layout\`)
- \`{ "mode": "stack", "direction": "row" | "column", "gap", "padding", "align", "justify", "wrap" }\`: a row or column (flexbox).
  - \`align\` (cross axis): start | center | end | stretch (default stretch).
  - \`justify\` (main axis): start | center | end | space-between | space-around | space-evenly.
- \`{ "mode": "grid", "columns": 3, "gap", "rowGap", "padding", "align", "justify" }\`: equal-width columns.
  - \`align\` (vertical, within each cell) and \`justify\` (horizontal): start | center | end | stretch (default stretch). A layer with a fixed or hug width sits at the cell's start unless \`justify\` places it: \`"justify": "center"\` centres logos in their cells.
- \`{ "mode": "absolute" }\`: children use \`position: { x, y }\` from the frame's edges (padding does nothing here). Only for overlaps and decoration.

## Free layers (\`positioning: "free"\`)
One layer that should sit on top of an auto-layout frame (a badge on a card, a sticker, an arrow pointing at something) doesn't need an absolute frame: give it \`"positioning": "free"\` and a \`position: { x, y }\`, measured from the frame's own edges: the frame's padding spaces its flow, never its free layers, and strokes take no room. It leaves the flow: its siblings close up as if it weren't there, and it's drawn above the siblings before it. Keep everything else in the flow. A \`position\` without \`positioning: "free"\` is ignored in stacks and grids (lint: ignored-position).

## Slides people made (a Free root)
Slides made by hand in the editor start Free: the root is \`{ "mode": "absolute" }\` and the person placed every layer (\`[at x,y]\` in get_slide). Keep their arrangement: add a node with a \`position\` where it fits, and put anything with structure (a list, a row of cards) in a stack or grid frame placed by its \`position\`. Don't switch the root to a stack or grid unless they ask: that re-arranges their whole slide.

**Anchors** pin a free layer to an edge or corner of its frame, so it stays there when the frame, its padding or the layer's own text changes size: \`"anchor": { "x": "end", "y": "start" }\` measures \`position\` from the top-right corner, where \`{ "x": 16, "y": 16 }\` means 16px in from the frame's right edge and its top edge. \`"center"\` measures from the middle (\`position\` is the offset of the layer's centre). Omitted axes are "start" (left / top). Badge on a card's corner: \`{ "type": "text", "props": { "content": "New" }, "width": "hug", "positioning": "free", "anchor": { "x": "end" }, "position": { "x": 16, "y": 16 } }\`. Give anchored text \`"width": "hug"\`: text fills its frame's width by default. Negative values reach past the edge (a sticker hanging over a corner: \`{ "x": -12, "y": -12 }\`).

\`gap\` and \`padding\` take pixels or space tokens ("$space.md"). Padding can be one value, \`{ x, y }\` or \`{ top, right, bottom, left }\`.

## Sizing (\`width\` / \`height\` on any node)
- \`"fill"\`: take the free space (in a row: share the width; in a column: share the height). Siblings share what's left after their own padding, so cards that should be equal widths need equal padding (or fixed widths).
- \`"hug"\`: fit the content.
- a number: fixed pixels.
- omitted: the element's default (text: fill width, hug height; shape 200×200; image 400×300).

## Frame style (\`style\`)
\`{ "fill": color | gradient | image, "stroke": { "color", "width" }, "radius": "$radius.lg", "shadow": "$shadow.md", "clip": true }\`
Paints (a frame's or slide's \`fill\`/\`background\`, a shape's \`fill\`): a color; a gradient, \`{ "type": "linear-gradient", "angle"?: 180, "stops": [{ "offset": 0, "color": "$color.primary" }, { "offset": 1, "color": "$color.secondary/40" }] }\` (angle: 0 = towards the top, 90 = right; optional \`start\`/\`end\`, default 0 and 1, place offsets 0 and 1 along the gradient line across the box, so \`"start": 0.4, "end": 0.6\` is a sharp band in the middle and values past 0–1 run beyond the edges), \`"radial-gradient"\` (\`center\`: \`{ "x": 0.5, "y": 0.5 }\` as fractions of the box, and it may sit outside it for a glow from off the edge; offset 1 reaches the farthest box sides, or the ellipse \`radius\`: \`{ "x": 0.3, "y": 0.3 }\` in fractions of the box's width and height) or \`"conic-gradient"\` (an angular sweep: \`angle\` where offset 0 starts, clockwise from the top, and \`center\`; repeat the first color last for a seamless wheel); or an image, \`{ "type": "image", "asset": "asset:<sha256>", "fit"?: "cover" | "contain" | "fill" | "tile" }\` ("tile" repeats it at its own pixel size from the top-left corner). 2–16 stops, offsets 0–1. A slide background is drawn over the theme's background color, so translucent stops fade into it.
Strokes are drawn inside the frame's edge and take no room: adding one never moves the content or the free layers (still measured from the outer edge), so a stroked card lines up with unstroked ones.

## Rotation (\`rotation\` on any node)
Degrees, clockwise, around the layer's centre. It doesn't affect layout: \`position\`, \`anchor\` and sizes describe the upright box, so a rotated sticker at \`{ "x": -12, "y": -12 }\` has its upright box 12px past the corner and its turned corners a little further. get_slide's measured bounds for a rotated node are the upright box it covers on screen (larger than its own size).

## Patterns
Title slide (the slide root is a column centered top-to-bottom; its children stretch across, so add \`"align": "center"\` to the slide layout to center hug-width things like a button frame):
\`{ "children": [ { "type": "text", "props": { "content": "Acme", "style": "$text.display" } }, { "type": "text", "props": { "content": "Tagline", "style": "$text.h3", "color": "$color.muted" } } ] }\`

Two columns:
\`{ "layout": { "mode": "stack", "direction": "row", "gap": "$space.lg", "padding": "$space.xl", "align": "center" }, "children": [ { "children": [ …left… ], "width": "fill" }, { "type": "image", "props": { … }, "width": "fill", "height": 600 } ] }\`

Three cards:
\`{ "layout": { "mode": "grid", "columns": 3, "gap": "$space.md" }, "children": [ { "layout": { "mode": "stack", "gap": "$space.sm", "padding": "$space.md" }, "style": { "fill": "$color.surface", "radius": "$radius.md" }, "children": [ … ] }, … ] }\`

Slide with a title on top and content below: set the slide \`layout\` to \`{ "mode": "stack", "gap": "$space.lg", "padding": "$space.xl", "justify": "start" }\`.`;

const DESIGN = `# Design rules

- **One idea per slide.** The title states the takeaway ("Revenue doubled in Q3"), not the topic ("Revenue").
- **Hierarchy:** one dominant element per slide. Use $text.display/h1 for the main point, $text.lead for bullets on a content slide (large, not bold: h2/h3 are bold headings), $text.body/small for denser support, $color.muted for secondary text.
- **Brevity:** ≤ 6 bullets, ≤ ~12 words each; ≤ ~40 words of body text per slide. Put detail in speaker notes (\`notes\`).
- **Whitespace:** keep the slide padding; prefer $space tokens for gaps. Don't fill every pixel.
- **Consistency:** same layout for slides of the same kind; same title position across content slides.
- **Color:** text on $color.background or $color.surface uses $color.text/$color.muted; text on $color.primary uses $color.on-primary. Accent colors for emphasis only.
- **Translucent color:** add an opacity in percent to a color token: "$color.primary/15" for a tinted card, "$color.secondary/30" for a glow or glass layer. It follows theme switches; a hex with alpha doesn't.
- **Icons:** there is no icon element yet. Don't use symbol characters (arrows, dingbats, emoji) as icons: the bundled fonts only cover text, so they render in a mismatched fallback font. Use shapes, numbers or short words instead.
- **Structure:** in a longer deck, start each part with \`section: "<name>"\` on its first slide (upsert_slide), often a Section header slide. Slide numbers and a footer line come from the deck's footer, set once with deck.setFooter (get_docs("sections")), never drawn by hand on each slide; Title and Section header slides leave it off.
- **Numbers:** show a big number ($text.display, $color.primary) with a short caption instead of a sentence.
- **Check your work:** fix every lint error; run render_preview on slides with images, many elements or custom layouts.`;

const COMPONENTS = `# Components

Save a node (and everything in it) once, then insert copies anywhere. Copies are plain nodes:
editing a copy, or the component later, never changes the others.

**Save** with save_component: \`name\`, a \`description\` (what it's for), the template as
\`node\` (same shape as upsert_slide nodes) or \`from\` (the ID of a node already on a slide),
and \`params\`. A param maps one value to fields inside the template, as
\`"<node ID>.<field>"\`:

\`\`\`json
{ "name": "Feature card", "description": "Icon-less card: title and one line",
  "node": { "id": "card", "layout": { "mode": "stack", "gap": "$space.sm", "padding": "$space.lg" },
            "style": { "fill": "$color.surface", "radius": "$radius.md" },
            "children": [ { "id": "card-title", "type": "text", "props": { "content": "Title", "style": "$text.h3" } },
                          { "id": "card-body", "type": "text", "props": { "content": "Body", "style": "$text.body" } } ] },
  "params": { "title": "card-title.props.content", "body": "card-body.props.content",
              "accent": { "description": "Card fill", "targets": ["card.style.fill"] } } }
\`\`\`

**Insert** with \`{ "use": "<name>", "with": { <param>: <value> } }\` anywhere a node goes:
upsert_slide children, frame children, or a node.insert op. Params left out keep the
template's value; \`null\` removes the field. A value is anything its field takes: a text
param takes rich text too, e.g. a bold heading line over plain ones:
\`[{ "runs": [{ "text": "Plan", "bold": true }] }, { "runs": [{ "text": "$3.9M" }] }]\`. The copy's own fields (\`id\`, \`width\`,
\`position\`, \`name\`…) can be set next to \`use\`.

\`\`\`json
{ "layout": { "mode": "grid", "columns": 3, "gap": "$space.md" }, "children": [
  { "use": "Feature card", "id": "c1", "with": { "title": "Faster", "body": "2× the speed" } },
  { "use": "Feature card", "id": "c2", "with": { "title": "Cheaper", "accent": "$color.primary" } } ] }
\`\`\`

**IDs:** the copy gets its \`id\` (or a generated one), and each inner node
\`<copy id>-<its ID in the template>\` without the template root's prefix: \`card-title\` in
copy \`c1\` is \`c1-title\`. Edit it later with node.update like any node.

list_components shows the deck's components with their params and templates. Saving under an
existing name needs \`overwrite: true\` (copies already on slides don't change).

**Slots:** a component can name a frame as its \`slot\` (save_component \`slot\`); \`children\`
given with \`use\` go there, in place of the template's placeholder.

# Slide layouts

A slide layout is a component for a whole slide: \`use\` it as the slide in upsert_slide (or a
slide.insert op). Params go in \`with\`; \`children\` fill its slot, except free layers
(\`positioning: "free"\`), which sit on the slide itself, so any layout takes a corner label or
a sticker; the slide's own \`id\`,
\`name\`, \`notes\`, \`background\`, \`hidden\`, \`section\` and \`hideFooter\` sit next to \`use\` (not
\`layout\` or \`style\`: those come from the layout). Inner IDs start with the slide's:
\`s3-title\`. The root frame's ID is generated: to add a node to the slide itself, give the
slide's ID as \`parentId\` (node.insert takes it, even for a slide inserted earlier in the same
apply_ops).

The content slot (\`s3-content\` in Title and content, \`s3-columns\` in Two columns) fills
the slide under the title (\`height: "fill"\`), and its children start at its top, under the
title, as in PowerPoint. A short list leaves space below: fill it (larger styles, cards with
\`height: "fill"\`, a visual), rather than centering the list away from its title.

\`\`\`json
{ "slide": { "id": "s3", "use": "Title and content", "with": { "title": "Three reasons" },
  "children": [ { "use": "Feature card", "with": { "title": "Faster" } } ] } }
\`\`\`

Built in (they follow the deck's theme): **Title** (title, subtitle), **Title and content**
(title, body; slot: content), **Two columns** (title, left, right; both set their text in
\`$text.lead\`: give your own children \`"style": "$text.lead"\` to match), **Section header** (title,
subtitle; on the primary color), **Big number** (number, caption), **Quote** (quote, author).
Leave out Title's \`title\` and it shows the deck's title live; leave out Section header's and
it shows its section's name live (start the section on that slide with \`section\`). Both
leave the footer off. The Quote layout adds no quote marks: put them in \`quote\`.
Save a slide of your own as a layout with save_component \`{ "name": "…", "from": "<slide id>" }\`;
one named like a built-in replaces it in this deck.`;

const SECTIONS = `# Sections, footer and fields

**Sections** group slides (the editor's slide list shows them as headers). Put
\`"section": "<name>"\` on the slide that starts one (upsert_slide, or slide.update): it runs to
the next slide that starts a section. Slides before the first section are in none.
**Rename** a section: slide.update its first slide's \`section\` (its slides and section
fields follow). **End** one at a slide: slide.update \`{ "section": null }\` (its slides join
the section before; a Section header slide there would then show that section's name: give
it a section of its own, or remove it).
The summary marks starts as \`[section "Results"]\`, and the slides before the first section
as \`[no section: slides 1–3]\`. A raw slide.move or slide.remove takes the
marker with that slide: moving a section's first slide moves where the section starts, and
a slide moved above the first section is in none. slide.move's \`index\` is 0-based: the
slide's position once it's moved (index 2 = the 3rd slide). apply_ops says which slides a
change moved into another section ("Sections: s7 is now in no section") and lints them.

**The footer** is set once for the whole deck:
\`{ "op": "deck.setFooter", "footer": { "date": true, "text": "Acme · Confidential", "slideNumber": true } }\`
(apply_ops; \`"footer": null\` removes it). It's drawn along the bottom of every slide inside its
margin: the date left, the text centered, the number right, small and muted. It takes no
room in the layout, so keep content above the bottom margin. A slide leaves it off with
\`"hideFooter": true\` (\`false\` shows it again); Title and Section header slides do already. Never draw slide numbers
by hand.

**Fields** are live values inside any text, as runs: \`{ "field": "slideNumber" }\`, with
\`"slideCount"\`, \`"date"\` (today, long form, in the deck's language), \`"deckTitle"\` or
\`"section"\` (the name of the section the slide is in; empty before the first section). They
stay right when slides move, the deck is renamed or a section is renamed. "Slide 3 of 12":
\`{ "content": [{ "runs": [{ "text": "Slide " }, { "field": "slideNumber" }, { "text": " of " }, { "field": "slideCount" }] }] }\`
Summaries show them as \`{slideNumber}\`. Lint warns when a section field shows nothing (a
slide in no section) or titles a slide that doesn't start the section it names (a section
header whose section was ended).

**A small label on any slide** (the section's name in a corner), even a layout with no slot:
a free layer anchored to a corner, in the slide's \`children\` (with \`use\` too: free layers
go on the slide, not in the slot), or node.insert into the slide later. Free positions are
measured from the slide's edges (its padding doesn't apply; the stage is 1920×1080):
\`{ "op": "node.insert", "parentId": "<slide id>", "node": { "type": "text", "width": "hug", "positioning": "free", "anchor": { "x": "end" }, "position": { "x": 96, "y": 40 }, "props": { "content": [{ "runs": [{ "field": "section" }] }], "style": "$text.small", "color": "$color.muted" } } }\`.
At y 40 the label sits in the top margin, above the title (which starts at the slide's padding,
96px). Keep it clear of the footer, which sits along the bottom; content stays clear of the
footer by staying inside the slide's padding.

**On many slides, save it once:** save_component \`{ "name": "Section label", "node": <that
label node> }\`, then put \`{ "use": "Section label" }\` in each slide's \`children\` (it's free,
so with \`use\` it goes on the slide, not the slot), even on Big number or Quote.`;

const OPS = `# Ops (apply_ops)

All edits are ops applied as one atomic transaction (all or nothing), undoable with undo_agent_changes.

- \`{ "op": "slide.insert", "slide": <slide like upsert_slide>, "index"? }\`
- \`{ "op": "slide.remove", "id" }\`, \`{ "op": "slide.move", "id", "index" }\` (index 0-based: the slide's position after the move)
- \`{ "op": "slide.update", "id", "set": { "name"?, "background"?, "notes"?, "hidden"?, "section"?, "hideFooter"? } }\` (\`"section": null\` ends a section there)
- \`{ "op": "node.insert", "parentId": <frame id, or a slide id for its root frame>, "node": <node>, "index"? }\` (index omitted = last). The node is written as in upsert_slide: \`kind\` and \`id\` are optional (new IDs are returned).
- \`{ "op": "node.remove", "id" }\`
- \`{ "op": "node.move", "id", "parentId", "index"? }\`
- \`{ "op": "node.update", "id", "set": { … } }\`: JSON Merge Patch. Objects merge, \`null\` deletes a field.
  e.g. \`{ "op": "node.update", "id": "title", "set": { "props": { "content": "New title" }, "width": "fill" } }\`
- \`{ "op": "deck.updateMeta", "set": { "title"?, "description"?, "authors"?, "language"? } }\`
- \`{ "op": "deck.setFooter", "footer": { "text"?, "slideNumber"?: true, "date"?: true } }\`: a footer along the bottom of every slide (date left, text centered, number right), drawn inside the slide's margin; \`"footer": null\` removes it. Slides with \`hideFooter\` leave it off.

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

/** The fonts this deck carries (added with add_asset), ready for its theme. */
function deckFontsLine(deck: Deck): string {
  const families = deckFontFamilies(deck);
  if (families.length === 0) return "";
  return `This deck's own fonts (added with add_asset): ${families
    .map((f) => `${f} (\`${deckFontStack(deck, f)}\`)`)
    .join(
      ", ",
    )}. They have only the weights of their files: other weights snap to the nearest (a weight-600 style on a 400/700 font renders bold, so bold runs inside it don't stand out).\n\n`;
}

function themeDocs(deck: Deck | null): string {
  const current = deck?.theme ?? null;
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
This is the theme of the open deck, "${deck?.meta.title ?? ""}": **${current.name}**. ${paletteLine(current)}
After create_deck or open_deck, call get_docs("theme") again: each deck has its own theme.

## Built-in themes
${themes}

set_theme also takes overrides on top of a theme, e.g. brand colors:
\`{ "theme": { "base": "light", "colors": { "primary": "#e11d48" } } }\`

## Colors
Any color token takes an opacity in percent (0–100): \`"$color.primary/30"\`.
${list(current.colors, "color", (v: string) => v)}

## Text styles (use as \`style\` on text)
${list(current.text, "text", (v: TextStyle) => `${v.size}px, weight ${v.weight}, $font.${v.font}${v.transform && v.transform !== "none" ? `, ${v.transform.toUpperCase()}` : ""}`)}

## Spacing / radius / shadow
${list(current.space, "space", (v: number) => `${v}px`)}
${list(current.radius, "radius", (v: number) => `${v}px`)}
${list(current.shadow, "shadow", () => "shadow")}

## Fonts
${list(current.fonts, "font", (v: string) => v)}

${deck ? deckFontsLine(deck) : ""}Bundled with Veloce (they look the same on every machine; other fonts only render where
installed, unless the font file is added to the deck with add_asset). Set them with set_theme, e.g. \`{ "theme": { "fonts": { "heading": "Fraunces, Georgia, serif" } } }\`:
${BUNDLED_FONTS.map((f) => `- ${f.family} (\`${f.stack}\`): ${f.note}`).join("\n")}`;
}

export function docTopics(registry: PluginRegistry): string[] {
  return [
    "layout",
    "design",
    "theme",
    "ops",
    "components",
    "sections",
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
    case "components":
      return COMPONENTS;
    case "sections":
    case "section":
    case "footer":
    case "fields":
    case "field":
    case "slide numbers":
      return SECTIONS;
    case "theme":
      return themeDocs(deck);
    case "lint":
      return `# Lint rules\n\n${Object.entries(LINT_RULES)
        .map(([rule, what]) => `- \`${rule}\`: ${what}`)
        .join(
          "\n",
        )}\n\nVisual rules (overflow, off-canvas, overlap, contrast, small text, empty-space) need the headless renderer.\n\nHow they measure:\n- **Contrast:** each text run against what's drawn behind it, translucent layers composited down to the slide. On a gradient, only the part under the text counts. Over an image it can't be measured (check with render_preview).\n- **Overlap:** text and images covering each other. Shapes don't count (they're usually backgrounds or decoration).\n- **off-canvas:** elements, and frames that draw something (fill, stroke, shadow), reported once per box.\n- **empty-space:** an empty band over 40% of the slide's height above or below the content (unless the bands above and below are about equal: centred content is fine). Content means elements, frames that draw something, and free layers taller than 8% of the slide (a small page number doesn't count).`;
  }
  if (key.startsWith("element/")) {
    const registered = registry.get(key.slice("element/".length));
    return registered ? registered.definition.aiDocs : null;
  }
  return null;
}
