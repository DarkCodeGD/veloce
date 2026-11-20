/**
 * The Issues panel's logic, pure (D73): lint issues as a person reads them.
 *
 * Core words issues for agents: IDs (`text "nd_x7"`, `slide "s3"`) and prop syntax
 * (`height: "hug"`). Agents need exactly that; people don't. So the editor keeps core's
 * measurement (the numbers, which layers) and rewrites the rest: layers by their names,
 * "this slide" for the slide, a short title per rule, and fixes in the inspector's words
 * ("set its height to Hug content"). Unknown rules (a newer server) fall back to core's text.
 */
import { type Deck, findNode, type LintIssue, type LintSeverity, type Node } from "@veloce/core";
import { nodeLabel } from "./slide-index.js";

const SEVERITY_RANK: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

export interface IssueView {
  /** Stable React key. */
  key: string;
  rule: string;
  severity: LintSeverity;
  slideId: string;
  /** The layers involved that still exist (what clicking selects). */
  nodeIds: string[];
  /** A few words: "Text doesn't fit". */
  title: string;
  /** Core's message, with names instead of IDs: what exactly is wrong, and by how much. */
  detail: string;
  /** What to do, in the editor's words. */
  hint: string;
}

export interface SlideIssues {
  slideId: string;
  /** 1-based position in the deck. */
  number: number;
  name?: string;
  worst: LintSeverity;
  issues: IssueView[];
}

export interface IssueCounts {
  error: number;
  warning: number;
  info: number;
}

/** How many of each severity. */
export function issueCounts(issues: readonly LintIssue[]): IssueCounts {
  const counts: IssueCounts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return counts;
}

const worse = (a: LintSeverity, b: LintSeverity) => (SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b);

/**
 * Per slide: how many problems (errors and warnings; tips don't badge) and the worst one,
 * for the thumbnails' badges.
 */
export function slideBadges(
  issues: readonly LintIssue[],
): Map<string, { count: number; worst: LintSeverity }> {
  const badges = new Map<string, { count: number; worst: LintSeverity }>();
  for (const issue of issues) {
    if (issue.severity === "info") continue;
    const badge = badges.get(issue.slideId);
    if (badge) {
      badge.count++;
      badge.worst = worse(badge.worst, issue.severity);
    } else badges.set(issue.slideId, { count: 1, worst: issue.severity });
  }
  return badges;
}

/** Per layer on one slide: its worst problem (errors and warnings), for the layers list. */
export function layerSeverities(
  issues: readonly LintIssue[],
  slideId: string,
): Map<string, LintSeverity> {
  const out = new Map<string, LintSeverity>();
  for (const issue of issues) {
    if (issue.slideId !== slideId || issue.severity === "info") continue;
    for (const id of issue.nodeIds) {
      const had = out.get(id);
      out.set(id, had ? worse(had, issue.severity) : issue.severity);
    }
  }
  return out;
}

const kindOf = (node: Node) => (node.kind === "frame" ? "frame" : node.type);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** `Text "Our tagline"`, or `a frame` when it has nothing better to go by than its type. */
function describeNode(node: Node): string {
  const kind = kindOf(node);
  const label = nodeLabel(node);
  if (label.toLowerCase() === kind || label === "Frame" || label === "Grid") {
    return `${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}`;
  }
  return `${kind} "${label}"`;
}

/** Core's message with IDs swapped for names (only IDs of real nodes/slides are touched). */
export function humanizeMessage(message: string, deck: Deck, slideId: string): string {
  const slideRef = (id: string) => (id === slideId ? "this slide" : `slide "${id}"`);
  const text = message
    .replace(
      /\bof slide "([^"]+)"/g,
      (_, id: string) => `of ${id === slideId ? "the slide" : `slide "${id}"`}`,
    )
    .replace(/\b[Ss]lide "([^"]+)"/g, (_, id: string) => slideRef(id))
    // `text "nd_x7" (Title)` / `frame "card"`: a node, if that ID is one.
    .replace(/\b([a-z][\w-]*) "([^"]+)"(?: \([^)]*\))?/g, (whole, _kind: string, id: string) => {
      const found = findNode(deck, id);
      return found ? describeNode(found.node) : whole;
    });
  return capitalize(text);
}

/** Short title per rule; `node` is the first layer involved (some rules read differently). */
function titleFor(issue: LintIssue, node: Node | undefined): string {
  switch (issue.rule) {
    case "overflow":
      return !node
        ? "Slide content doesn't fit"
        : node.kind === "frame"
          ? "Content doesn't fit its frame"
          : "Text doesn't fit";
    case "off-canvas":
      return "Off the slide";
    case "overlap":
      return "Layers overlap";
    case "low-contrast":
      return "Hard to read";
    case "small-text":
      return "Text too small";
    case "empty-slide":
      return "Empty slide";
    case "too-much-text":
      return "Too much text";
    case "alt-text":
      return "No image description";
    case "unknown-token":
      return "Missing theme style";
    case "empty-space":
      return "Unbalanced layout";
    case "ignored-position":
      return "Position has no effect";
    case "ignored-padding":
      return "Padding has no effect";
    default:
      return capitalize(String(issue.rule).replaceAll("-", " "));
  }
}

/** What to do, in the inspector's words. */
function hintFor(issue: LintIssue, node: Node | undefined): string {
  switch (issue.rule) {
    case "overflow":
      if (!node) {
        return "Shorten or remove content, use smaller text styles, tighten gaps and padding, or split it into two slides.";
      }
      return node.kind === "frame"
        ? "Set the frame's height to Hug content, reduce its gap or padding, or shorten what's inside."
        : "Set its height to Hug content, give it more room, shorten the text, or pick a smaller text style.";
    case "off-canvas":
      return "Drag it back onto the slide, make it smaller, or put it in an auto-layout frame.";
    case "overlap":
      return "Move one of them, or put both in a stack so they sit side by side. Fine to ignore if it's on purpose, like a caption over an image.";
    case "low-contrast":
      // The gradient advice is already plain language; the other names theme tokens.
      return issue.fix.startsWith("A gradient")
        ? issue.fix
        : "Pick a text color that stands out from what's behind it, or change the background.";
    case "small-text":
      return "Use the Caption text style (20px) or a larger one.";
    case "empty-slide":
      return "Add content, or delete the slide.";
    case "too-much-text":
      return node
        ? "Cut it to the key point, turn it into a few short bullets, or move detail to the speaker notes."
        : "Split it into two slides, or move detail to the speaker notes.";
    case "alt-text":
      return "Describe what the image shows in its Alt field. Leave it empty only for decoration.";
    case "unknown-token":
      // `"$text.h2"` → `"h2"`: the theme lists styles and colors by name.
      return issue.fix.replace(/"\$[a-z]+\.([\w-]+)"/g, '"$1"');
    case "empty-space":
      return "Center the content, let cards grow to fill the space, use larger text styles, or add an image.";
    case "ignored-position":
      return issue.message.includes("anchor")
        ? "Make it a Free layer to pin it to an edge, or remove the anchor."
        : "Make it a Free layer to place it there, or clear its position to keep it in the flow.";
    case "ignored-padding":
      return "Remove the padding (free layers ignore it), or switch the frame to a stack or grid.";
    default:
      return issue.fix;
  }
}

/**
 * Issues as the panel lists them: per slide in deck order, worst first within each slide,
 * tips (info) only when `showTips`. Issues on slides that are gone are dropped.
 */
export function viewIssues(
  deck: Deck,
  issues: readonly LintIssue[],
  { showTips = false }: { showTips?: boolean } = {},
): SlideIssues[] {
  const bySlide = new Map<string, IssueView[]>();
  issues.forEach((issue, i) => {
    if (issue.severity === "info" && !showTips) return;
    const nodes = issue.nodeIds.flatMap((id) => {
      const found = findNode(deck, id);
      return found && found.slide.id === issue.slideId ? [found.node] : [];
    });
    const first = issue.nodeIds.length ? nodes[0] : undefined;
    const view: IssueView = {
      key: `${issue.slideId}:${issue.rule}:${issue.nodeIds.join(",")}:${i}`,
      rule: issue.rule,
      severity: issue.severity,
      slideId: issue.slideId,
      nodeIds: nodes.map((n) => n.id),
      title: titleFor(issue, first),
      detail: humanizeMessage(issue.message, deck, issue.slideId),
      hint: hintFor(issue, first),
    };
    const list = bySlide.get(issue.slideId) ?? [];
    list.push(view);
    bySlide.set(issue.slideId, list);
  });
  const out: SlideIssues[] = [];
  deck.slides.forEach((slide, i) => {
    const list = bySlide.get(slide.id);
    if (!list?.length) return;
    list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    out.push({
      slideId: slide.id,
      number: i + 1,
      ...(slide.name && { name: slide.name }),
      worst: list[0]?.severity ?? "info",
      issues: list,
    });
  });
  return out;
}
