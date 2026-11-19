/**
 * Compact, token-cheap text views of a deck for agents: an indented outline with every ID an
 * agent needs to make an edit, element types, and text snippets. No blobs, no full props.
 */
import {
  type Deck,
  type LintIssue,
  type Node,
  type Slide,
  type SlideMeasurement,
  TextContentSchema,
  toPlainText,
} from "@veloce/core";

const SNIPPET = 60;

export function deckSummary(deck: Deck): string {
  const lines = [
    `Deck "${deck.meta.title}" (id ${deck.id}) · theme ${deck.theme.name} · ${deck.stage.width}×${deck.stage.height} · ${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"}`,
  ];
  if (deck.slides.length === 0) lines.push("(no slides yet: add some with upsert_slide)");
  deck.slides.forEach((slide, i) => {
    lines.push("", slideOutline(slide, i));
  });
  return lines.join("\n");
}

/** One slide: its header line, then its node tree. */
export function slideOutline(slide: Slide, index: number): string {
  const lines = [slideHeader(slide, index)];
  for (const child of slide.root.children) outline(child, 1, lines);
  return lines.join("\n");
}

export function slideHeader(slide: Slide, index: number): string {
  const name = slide.name ? ` "${slide.name}"` : "";
  const flags = [slide.hidden && "hidden", slide.notes && "has notes"].filter(Boolean).join(", ");
  return `${index + 1}. slide ${slide.id}${name} · root frame ${slide.root.id} (${layoutLabel(slide.root)})${flags ? ` · ${flags}` : ""}`;
}

function outline(node: Node, depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth);
  // Free layers say so: they're out of the flow, so reordering them won't move them.
  const free =
    node.positioning === "free"
      ? ` [free at ${node.position?.x ?? 0},${node.position?.y ?? 0}]`
      : "";
  const hidden = `${free}${node.hidden ? " [hidden]" : ""}`;
  if (node.kind === "frame") {
    lines.push(`${indent}- ${node.id}: frame (${layoutLabel(node)})${hidden}`);
    for (const child of node.children) outline(child, depth + 1, lines);
    return;
  }
  const text = TextContentSchema.safeParse(node.props.content);
  const style = typeof node.props.style === "string" ? ` ${node.props.style}` : "";
  const detail = text.success
    ? ` "${snippet(toPlainText(text.data))}"${style}`
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
