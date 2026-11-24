/**
 * Compact, token-cheap text views of a deck for agents: an indented outline with every ID an
 * agent needs to make an edit, element types, and text snippets. No blobs, no full props.
 */
import {
  type Component,
  type Deck,
  isFreeLayer,
  type Layout,
  type LintIssue,
  type Node,
  type Slide,
  type SlideMeasurement,
  slideLayouts,
  type TextContent,
  TextContentSchema,
  toPlainText,
} from "@veloce/core";

const SNIPPET = 60;

export function deckSummary(deck: Deck): string {
  const lines = [
    `Deck "${deck.meta.title}" (id ${deck.id}) · theme ${deck.theme.name} · ${deck.stage.width}×${deck.stage.height} · ${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"}`,
    ...metaLines(deck.meta),
  ];
  const components = Object.entries(deck.components ?? {}).filter(([, c]) => !c.slide);
  if (components.length > 0) {
    const list = components.map(([name, c]) => {
      const params = Object.keys(c.params ?? {});
      return `"${name}"${params.length ? ` (${params.join(", ")})` : ""}`;
    });
    lines.push(
      `Components: ${list.join(", ")}. Insert copies with { "use": name, "with": { … } }; list_components shows them.`,
    );
  }
  const layouts = slideLayouts(deck).map(({ name, builtin }) => (builtin ? name : `${name} (own)`));
  lines.push(
    `Slide layouts: ${layouts.join(", ")}. Start a slide with { "use": name, "with": { … } } in upsert_slide.`,
  );
  const footer = footerLine(deck.footer);
  // Said either way (3 tokens): "none" tells a removed footer from one left out of the outline.
  lines.push(footer ?? "Footer: none.");
  if (deck.slides.length === 0) lines.push("(no slides yet: add some with upsert_slide)");
  // Slides before the first section are in none (D97): say so once, with how far that runs.
  const firstSection = deck.slides.findIndex((s) => s.section !== undefined);
  deck.slides.forEach((slide, i) => {
    const noSection = i === 0 && firstSection > 0 ? firstSection : 0;
    lines.push("", slideOutline(slide, i, { noSection, footer: footer !== null }));
  });
  return lines.join("\n");
}

/** What the footer shows (D97), or null without one. */
function footerLine(footer: Deck["footer"]): string | null {
  const parts = [
    footer?.date && "date",
    footer?.text && `"${footer.text}"`,
    footer?.slideNumber && "slide number",
  ].filter(Boolean);
  return parts.length
    ? `Footer: ${parts.join(" · ")} (deck.setFooter changes it; hideFooter leaves it off a slide).`
    : null;
}

/**
 * The deck info a person set (File → Deck info, D76), when there is any: what the deck is
 * for, who it's by and its language, so agents write for that audience in that language.
 */
function metaLines(meta: Deck["meta"]): string[] {
  const lines: string[] = [];
  if (meta.description) lines.push(`About: ${meta.description}`);
  const by = [
    meta.authors?.length && `By ${meta.authors.join(", ")}`,
    meta.language && `language ${meta.language}`,
  ].filter(Boolean);
  if (by.length) lines.push(by.join(" · "));
  return lines;
}

/** One slide: its header line, then its node tree. */
export function slideOutline(slide: Slide, index: number, marks: HeaderMarks = {}): string {
  const lines = [slideHeader(slide, index, marks)];
  for (const child of slide.root.children) outline(child, slide.root.layout, 1, lines);
  return lines.join("\n");
}

/** A component for list_components (D94): what it's for, its params, then its template tree. */
export function componentOutline(name: string, component: Component, note?: string): string {
  const tags = [note, component.slot && `slot ${component.slot}`].filter(Boolean).join(", ");
  const lines = [
    `"${name}"${tags ? ` (${tags})` : ""}${component.description ? `: ${component.description}` : ""}`,
  ];
  const params = Object.entries(component.params ?? {});
  if (params.length > 0) {
    lines.push("  params:");
    for (const [param, { description, targets }] of params) {
      lines.push(`    ${param}${description ? ` (${description})` : ""} → ${targets.join(", ")}`);
    }
  } else lines.push("  no params");
  lines.push("  template:");
  outline(component.node, { mode: "stack" }, 2, lines);
  return lines.join("\n");
}

export interface HeaderMarks {
  /** How many slides before the first section start here: `[no section: slides 1–3]`. */
  noSection?: number;
  /** The deck has a footer: say which slides leave it off. Default true. */
  footer?: boolean;
}

export function slideHeader(
  slide: Slide,
  index: number,
  { noSection = 0, footer = true }: HeaderMarks = {},
): string {
  const name = slide.name ? ` "${slide.name}"` : "";
  const flags = [
    slide.hidden && "hidden",
    slide.notes && "has notes",
    footer && slide.hideFooter && "no footer",
  ]
    .filter(Boolean)
    .join(", ");
  const section =
    slide.section !== undefined
      ? `[section "${slide.section}"] `
      : noSection
        ? `[no section: ${noSection === 1 ? "slide 1" : `slides 1–${noSection}`}] `
        : "";
  return `${section}${index + 1}. slide ${slide.id}${name} · root frame ${slide.root.id} (${layoutLabel(slide.root)})${flags ? ` · ${flags}` : ""}`;
}

/** " from top-right" for anchored layers ("" for the default top-left). */
function anchorLabel(node: Node): string {
  const x = node.anchor?.x ?? "start";
  const y = node.anchor?.y ?? "start";
  if (x === "start" && y === "start") return "";
  if (x === "center" && y === "center") return " from center";
  const h = { start: "left", center: "center", end: "right" }[x];
  const v = { start: "top", center: "middle", end: "bottom" }[y];
  return ` from ${v}-${h}`;
}

function outline(node: Node, parent: Layout, depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth);
  // Layers placed by their position say where: free layers of a stack or grid say "free"
  // (they're out of the flow, so reordering won't move them); an absolute frame's children,
  // such as everything on a slide made by hand (D83), say "at". Anchored ones also say
  // which corner their position is measured from.
  const at = `${node.position?.x ?? 0},${node.position?.y ?? 0}${anchorLabel(node)}`;
  const placed = isFreeLayer(node, parent) || node.anchor !== undefined;
  const free = node.positioning === "free" ? ` [free at ${at}]` : placed ? ` [at ${at}]` : "";
  const turned = node.rotation ? ` [rotated ${node.rotation}°]` : "";
  // A match key pairs the layer with others for morph (D109): on copies made by Duplicate
  // slide it's the original's ID.
  const key = node.matchKey === undefined ? "" : ` [key "${node.matchKey}"]`;
  const hidden = `${free}${turned}${key}${node.hidden ? " [hidden]" : ""}`;
  if (node.kind === "frame") {
    lines.push(`${indent}- ${node.id}: frame (${layoutLabel(node)})${hidden}`);
    for (const child of node.children) outline(child, node.layout, depth + 1, lines);
    return;
  }
  const text = TextContentSchema.safeParse(node.props.content);
  const style = typeof node.props.style === "string" ? ` ${node.props.style}` : "";
  const detail = text.success
    ? ` "${snippet(outlineText(text.data).replace(/\s*\n\s*/g, " / "))}"${style}`
    : typeof node.props.shape === "string"
      ? ` ${node.props.shape}`
      : typeof node.props.alt === "string"
        ? ` alt="${snippet(node.props.alt)}"`
        : "";
  lines.push(`${indent}- ${node.id}: ${node.type}${detail}${hidden}`);
}

function layoutLabel(node: Extract<Node, { kind: "frame" }>): string {
  const l = node.layout;
  if (l.mode === "stack") return `stack ${l.direction ?? "column"}`;
  if (l.mode === "grid") return `grid ${l.columns} cols`;
  return "absolute";
}

/** Text as agents read it in outlines: a field run as `{slideNumber}` (D97), not its stored text. */
function outlineText(content: TextContent): string {
  if (typeof content === "string") return content;
  return toPlainText(
    content.map((p) => ({
      ...p,
      runs: p.runs.map((r) => (r.field ? { text: `{${r.field}}` } : r)),
    })),
  );
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET - 1)}…` : flat;
}

/** `node: x,y w×h` lines from a measurement (where things actually ended up). */
export function boundsTable(m: SlideMeasurement): string {
  return Object.entries(m.nodes)
    .map(([id, { bounds: b, overflow }]) => {
      const spill = overflow ? ` OVERFLOW(${Math.ceil(overflow.x)},${Math.ceil(overflow.y)})` : "";
      return `${id}: ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)}${spill}`;
    })
    .join("\n");
}

export function formatLint(issues: LintIssue[], visual: string | true): string {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const head =
    issues.length === 0
      ? "Lint: no issues."
      : `Lint: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, ${issues.length - errors - warnings} info.`;
  const note = visual === true ? "" : ` (Visual checks skipped: ${visual})`;
  const body = issues.map(
    (i) =>
      `- [${i.severity}] ${i.rule} · slide ${i.slideId}${i.nodeIds.length ? ` · ${i.nodeIds.join(", ")}` : ""}: ${i.message} Fix: ${i.fix}`,
  );
  return [head + note, ...body].join("\n");
}
