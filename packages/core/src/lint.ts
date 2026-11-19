/**
 * Deck lint: the checks an agent runs to catch its own design mistakes (D12: lint first,
 * screenshot second). Structural rules only need the document; visual rules also need
 * `SlideMeasurement`s from the renderer and are skipped for slides without one.
 *
 * Every issue names the nodes involved and says how to fix it, so an agent can repair a
 * slide without guessing (or looking at a screenshot).
 */
import {
  contrastRatio,
  flattenLayers,
  type NodeMeasurement,
  parseCssColor,
  type Rect,
  type SlideMeasurement,
} from "./measure.js";
import type { Deck, Slide } from "./schema/deck.js";
import { type ElementNode, isFreeLayer, type Layout, type Node } from "./schema/node.js";
import { TextContentSchema, toPlainText } from "./schema/rich-text.js";
import type { Theme } from "./schema/theme.js";
import { suggest } from "./suggest.js";
import { parseTokenRef, resolveToken } from "./tokens.js";

export type LintSeverity = "error" | "warning" | "info";

export const LINT_RULES = {
  overflow: "Content spills out of its box or off the bottom of the slide.",
  "off-canvas": "An element is partly or fully outside the slide.",
  overlap: "Two content elements cover each other.",
  "low-contrast": "Text color is too close to its background (WCAG contrast).",
  "small-text": "Text is too small to read when presented.",
  "empty-slide": "The slide has nothing visible on it.",
  "too-much-text": "Too many words for one slide or one text box.",
  "alt-text": "An image's alt text is empty or looks like a file name.",
  "unknown-token": "Content references a theme token the theme doesn't define.",
  "empty-space": "Content is bunched at one edge, leaving a large empty band (layout balance).",
  "ignored-position":
    'A layer has a `position` its frame ignores (a stack/grid child that isn\'t `positioning: "free"`).',
} as const;
export type LintRule = keyof typeof LINT_RULES;

export interface LintIssue {
  rule: LintRule;
  severity: LintSeverity;
  slideId: string;
  /** Nodes involved (empty for slide-level issues). */
  nodeIds: string[];
  message: string;
  /** What to change, concretely. */
  fix: string;
}

export interface LintOptions {
  /** Only lint these slides. Default: all. */
  slideIds?: readonly string[];
  /** Renderer measurements keyed by slide ID. Visual rules run only for measured slides. */
  measurements?: ReadonlyMap<string, SlideMeasurement>;
}

/** Thresholds, in pixels of a 1920-wide stage (scaled for other stage sizes). */
export const LINT_LIMITS = {
  /** Words in one text element / on one slide before we warn. */
  wordsPerElement: 50,
  wordsPerSlide: 90,
  /** Smallest readable font size. The theme's `$text.caption` is 20px. */
  minFontSize: 20,
  /** Text at least this big (or `largeBoldFontSize` and bold) needs contrast 3:1 instead of 4.5:1. */
  largeFontSize: 40,
  largeBoldFontSize: 32,
  /** Overflow/off-canvas tolerance (sub-pixel rounding, antialiasing). */
  tolerance: 2,
  /** Share of the slide height left empty above or below all content before we mention it. */
  emptyBand: 0.4,
} as const;

const SEVERITY_ORDER: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

export function lintDeck(deck: Deck, options: LintOptions = {}): LintIssue[] {
  const only = options.slideIds ? new Set(options.slideIds) : null;
  const issues: LintIssue[] = [];
  for (const slide of deck.slides) {
    if (only && !only.has(slide.id)) continue;
    const slideIssues = [
      ...structuralRules(slide),
      ...positionRules(slide),
      ...tokenRules(slide, deck.theme),
      ...visualRules(slide, options.measurements?.get(slide.id)),
      ...balanceRules(slide, options.measurements?.get(slide.id)),
    ];
    slideIssues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    issues.push(...slideIssues);
  }
  return issues;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────

interface Visible {
  node: Node;
  /** IDs of the frames above this node, nearest last. */
  ancestors: string[];
}

/** Visible nodes (a hidden frame hides its whole subtree). */
function visibleNodes(slide: Slide): Visible[] {
  const out: Visible[] = [];
  const visit = (node: Node, ancestors: string[]) => {
    if (node.hidden) return;
    out.push({ node, ancestors });
    if (node.kind === "frame") {
      for (const child of node.children) visit(child, [...ancestors, node.id]);
    }
  };
  visit(slide.root, []);
  return out;
}

const isElement = (node: Node): node is ElementNode => node.kind === "element";

function describe(node: Node): string {
  const kind = node.kind === "frame" ? "frame" : node.type;
  return node.name ? `${kind} "${node.id}" (${node.name})` : `${kind} "${node.id}"`;
}

function textOf(node: ElementNode): string | null {
  const parsed = TextContentSchema.safeParse(node.props.content);
  return parsed.success ? toPlainText(parsed.data) : null;
}

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

// ── Structural rules (document only) ───────────────────────────────────────────────────

const FILE_NAME_ALT =
  /\.(?:png|jpe?g|gif|webp|svg|avif)$|^(?:img|image|dsc|photo|screenshot)[-_ ]?\d+$/i;

function structuralRules(slide: Slide): LintIssue[] {
  const issues: LintIssue[] = [];
  const issue = (i: Omit<LintIssue, "slideId">) => issues.push({ slideId: slide.id, ...i });
  const elements = visibleNodes(slide)
    .map((v) => v.node)
    .filter(isElement);

  if (elements.length === 0) {
    issue({
      rule: "empty-slide",
      severity: "warning",
      nodeIds: [],
      message: `Slide "${slide.id}" has no visible content.`,
      fix: "Add content to the slide, or remove it.",
    });
  }

  let slideWords = 0;
  const textNodes: string[] = [];
  for (const node of elements) {
    const text = textOf(node);
    if (text !== null) {
      const words = countWords(text);
      slideWords += words;
      if (words > 0) textNodes.push(node.id);
      if (words > LINT_LIMITS.wordsPerElement) {
        issue({
          rule: "too-much-text",
          severity: "warning",
          nodeIds: [node.id],
          message: `${describe(node)} has ${words} words (aim for under ${LINT_LIMITS.wordsPerElement}).`,
          fix: "Cut it to the key point, turn it into 3–5 short bullets, or move detail to speaker notes.",
        });
      }
    }
    const alt = node.props.alt;
    if (typeof alt === "string") {
      if (alt.trim() === "") {
        issue({
          rule: "alt-text",
          severity: "info",
          nodeIds: [node.id],
          message: `${describe(node)} has empty alt text.`,
          fix: 'Fine for purely decorative images; otherwise describe the image in "alt".',
        });
      } else if (FILE_NAME_ALT.test(alt.trim())) {
        issue({
          rule: "alt-text",
          severity: "warning",
          nodeIds: [node.id],
          message: `${describe(node)} has a file name as alt text ("${alt}").`,
          fix: 'Describe what the image shows in "alt", e.g. "Team photo at the 2026 offsite".',
        });
      }
    }
  }
  if (slideWords > LINT_LIMITS.wordsPerSlide) {
    issue({
      rule: "too-much-text",
      severity: "warning",
      nodeIds: textNodes,
      message: `Slide "${slide.id}" has ${slideWords} words (aim for under ${LINT_LIMITS.wordsPerSlide}).`,
      fix: "Split it into two slides or move detail to speaker notes (slide `notes`).",
    });
  }
  return issues;
}

/**
 * A `position` on a layer its frame lays out is silently ignored: almost always an agent
 * expecting the layer to sit there. Say so, and offer both readings of the intent.
 */
function positionRules(slide: Slide): LintIssue[] {
  const issues: LintIssue[] = [];
  const visit = (node: Node, parent: Layout | null) => {
    if (parent !== null && node.position && !isFreeLayer(node, parent)) {
      issues.push({
        rule: "ignored-position",
        severity: "warning",
        slideId: slide.id,
        nodeIds: [node.id],
        message: `${describe(node)} has position ${node.position.x},${node.position.y}, but its frame is a ${parent.mode}, so the position is ignored.`,
        fix: 'To place it there on top of the layout, add positioning: "free". To keep it in the flow, remove position.',
      });
    } else if (parent !== null && node.anchor && !isFreeLayer(node, parent)) {
      issues.push({
        rule: "ignored-position",
        severity: "warning",
        slideId: slide.id,
        nodeIds: [node.id],
        message: `${describe(node)} has an anchor, but its frame is a ${parent.mode} that places it, so the anchor is ignored.`,
        fix: 'To pin it to an edge of the frame, add positioning: "free" and a position. To keep it in the flow, remove anchor.',
      });
    }
    if (node.kind === "frame") for (const child of node.children) visit(child, node.layout);
  };
  visit(slide.root, null);
  return issues;
}

/** Every token reference must exist in the theme, or it silently renders with fallback styling. */
function tokenRules(slide: Slide, theme: Theme): LintIssue[] {
  const issues: LintIssue[] = [];
  const check = (value: unknown, owner: string, nodeIds: string[]) => {
    for (const ref of tokenRefsIn(value)) {
      if (resolveToken(theme, ref) !== undefined) continue;
      const parsed = parseTokenRef(ref);
      if (!parsed) continue;
      const names = Object.keys(themeGroup(theme, parsed.group));
      const valid = names.map((n) => `$${parsed.group}.${n}`);
      // Match on the name alone: the shared "$group." prefix would make far-off names look close.
      const close = suggest(parsed.name, names).map((n) => `$${parsed.group}.${n}`);
      issues.push({
        rule: "unknown-token",
        severity: "error",
        slideId: slide.id,
        nodeIds,
        message: `${owner} uses "${ref}", which the theme "${theme.name}" doesn't define.`,
        fix: close.length
          ? `Did you mean ${close.map((c) => `"${c}"`).join(" or ")}?`
          : `Use one of: ${valid.map((v) => `"${v}"`).join(", ")}.`,
      });
    }
  };
  check(slide.background, `Slide "${slide.id}" background`, []);
  for (const { node } of visibleNodes(slide)) {
    const fields = node.kind === "frame" ? { layout: node.layout, style: node.style } : node.props;
    check(fields, describe(node), [node.id]);
  }
  return issues;
}

/** Token references (`"$group.name"`) anywhere inside a JSON value. */
function tokenRefsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (parseTokenRef(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) tokenRefsIn(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) tokenRefsIn(item, into);
  }
  return into;
}

const THEME_KEYS: Record<string, keyof Theme> = {
  color: "colors",
  font: "fonts",
  text: "text",
  space: "space",
  radius: "radius",
  shadow: "shadow",
};

function themeGroup(theme: Theme, group: string): Record<string, unknown> {
  const key = THEME_KEYS[group];
  return key ? (theme[key] as Record<string, unknown>) : {};
}

// ── Visual rules (need measurements) ──────────────────────────────────────────────────

/**
 * Layout balance (info only: a design call, but agents that skip previews can't see it).
 * Elements, not frames: "fill" frames span the slide even when their content doesn't.
 */
function balanceRules(slide: Slide, m: SlideMeasurement | undefined): LintIssue[] {
  if (!m) return [];
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const { node } of visibleNodes(slide)) {
    const bounds = node.kind === "element" ? m.nodes[node.id]?.bounds : undefined;
    if (!bounds || bounds.height <= 0) continue;
    top = Math.min(top, bounds.y);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  if (!Number.isFinite(top)) return [];
  const height = m.stage.height;
  const below = (height - bottom) / height;
  const above = top / height;
  const band = Math.max(above, below);
  if (band <= LINT_LIMITS.emptyBand) return [];
  const where = below >= above ? "bottom" : "top";
  return [
    {
      rule: "empty-space",
      severity: "info",
      slideId: slide.id,
      nodeIds: [slide.root.id],
      message: `The ${where} ${Math.round(band * 100)}% of slide "${slide.id}" is empty.`,
      fix: 'Center the content (justify: "center" on the slide), let cards grow (height: "fill"), use larger styles, or add a visual. Check with render_preview.',
    },
  ];
}

function visualRules(slide: Slide, m: SlideMeasurement | undefined): LintIssue[] {
  if (!m) return [];
  const issues: LintIssue[] = [];
  const issue = (i: Omit<LintIssue, "slideId">) => issues.push({ slideId: slide.id, ...i });
  const tol = LINT_LIMITS.tolerance;
  const scale = 1920 / m.stage.width; // compare font sizes as if on a 1920-wide stage
  const visible = visibleNodes(slide);
  const measured = visible.flatMap((v) => {
    const nm = m.nodes[v.node.id];
    return nm ? [{ ...v, m: nm }] : [];
  });

  // Overflow. Report the innermost node that overflows: if a text box overflows, the frames
  // around it often do too, and those reports would just be noise.
  const overflowing = measured.filter(
    (x) => (x.m.overflow?.x ?? 0) > tol || (x.m.overflow?.y ?? 0) > tol,
  );
  const hasOverflowingDescendant = new Set(overflowing.flatMap((x) => x.ancestors));
  for (const { node, m: nm } of overflowing) {
    if (hasOverflowingDescendant.has(node.id)) continue;
    const { x, y } = nm.overflow ?? { x: 0, y: 0 };
    const amount = y > tol ? `${Math.ceil(y)}px too tall` : `${Math.ceil(x)}px too wide`;
    if (node.id === slide.root.id) {
      issue({
        rule: "overflow",
        severity: "error",
        nodeIds: [node.id],
        message: `Slide "${slide.id}" content doesn't fit: it's ${amount} for the slide.`,
        fix: "Shorten or remove content, use smaller text styles, reduce gaps/padding, or split the slide.",
      });
    } else if (node.kind === "element") {
      issue({
        rule: "overflow",
        severity: "error",
        nodeIds: [node.id],
        message: `${describe(node)} content is ${amount} for its box.`,
        fix: 'Let it size to its content (height: "hug"), give it more room, shorten the text, or use a smaller style.',
      });
    } else {
      issue({
        rule: "overflow",
        severity: "error",
        nodeIds: [node.id],
        message: `${describe(node)}: its children are ${amount} for it.`,
        fix: 'Use height/width "hug" on the frame, reduce its gap/padding, or remove/shorten children.',
      });
    }
  }

  const elements = measured.filter((x) => isElement(x.node)) as Array<
    Visible & { node: ElementNode; m: NodeMeasurement }
  >;
  const stage: Rect = { x: 0, y: 0, width: m.stage.width, height: m.stage.height };

  for (const { node, m: nm } of elements) {
    const b = nm.bounds;
    if (b.width <= 0 && b.height <= 0) continue;
    const inside = intersectionArea(b, stage);
    if (inside === 0) {
      issue({
        rule: "off-canvas",
        severity: "error",
        nodeIds: [node.id],
        message: `${describe(node)} is entirely outside the slide, so it's invisible.`,
        fix: "Move it inside the slide (position within the stage), or remove it.",
      });
    } else if (
      b.x < -tol ||
      b.y < -tol ||
      b.x + b.width > stage.width + tol ||
      b.y + b.height > stage.height + tol
    ) {
      issue({
        rule: "off-canvas",
        severity: "warning",
        nodeIds: [node.id],
        message: `${describe(node)} sticks out of the slide (bounds ${fmtRect(b)}, slide ${stage.width}×${stage.height}).`,
        fix: "Move or shrink it so it stays inside the slide, or put it in an auto-layout frame.",
      });
    }
  }

  // Overlap between content elements. Shapes are excluded: they're usually backgrounds/decor.
  const content = elements.filter((x) => x.node.type !== "shape");
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const a = content[i];
      const b = content[j];
      if (!a || !b) continue;
      const overlap = intersectionArea(a.m.bounds, b.m.bounds);
      const smaller = Math.min(area(a.m.bounds), area(b.m.bounds));
      if (overlap > 100 && overlap > smaller * 0.05) {
        issue({
          rule: "overlap",
          severity: "warning",
          nodeIds: [a.node.id, b.node.id],
          message: `${describe(a.node)} and ${describe(b.node)} overlap (${Math.round((overlap / smaller) * 100)}% of the smaller one).`,
          fix: "Put them in a stack/grid frame instead of absolute or free positions, or move one. Ignore if it's intentional (e.g. a caption over an image).",
        });
      }
    }
  }

  for (const { node, m: nm } of elements) {
    if (!nm.text?.length) continue;
    let worst: { ratio: number; needed: number } | null = null;
    let smallest = Number.POSITIVE_INFINITY;
    for (const sample of nm.text) {
      const size = sample.fontSize * scale;
      smallest = Math.min(smallest, size);
      const fg = parseCssColor(sample.color);
      const bg = sample.background === null ? null : parseCssColor(sample.background);
      if (!fg || !bg) continue;
      const opaqueBg = flattenLayers([bg]);
      const ratio = contrastRatio(flattenLayers([fg, opaqueBg]), opaqueBg);
      const large =
        size >= LINT_LIMITS.largeFontSize ||
        (size >= LINT_LIMITS.largeBoldFontSize && sample.fontWeight >= 700);
      const needed = large ? 3 : 4.5;
      if (ratio < needed && (!worst || ratio < worst.ratio)) worst = { ratio, needed };
    }
    if (worst) {
      issue({
        rule: "low-contrast",
        severity: worst.ratio < 2 ? "error" : "warning",
        nodeIds: [node.id],
        message: `${describe(node)} text contrast is ${worst.ratio.toFixed(2)}:1 (needs ${worst.needed}:1).`,
        fix: 'Use "$color.text" or "$color.muted" on the slide background and "$color.surface" cards, "$color.on-primary" on "$color.primary" fills, or change the background.',
      });
    }
    if (smallest < LINT_LIMITS.minFontSize) {
      issue({
        rule: "small-text",
        severity: "warning",
        nodeIds: [node.id],
        message: `${describe(node)} has ${Math.round(smallest)}px text, too small to read when presented.`,
        fix: `Use "$text.caption" (${LINT_LIMITS.minFontSize}px) or a larger text style.`,
      });
    }
  }
  return issues;
}

function area(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const fmtRect = (r: Rect) =>
  `x ${Math.round(r.x)}, y ${Math.round(r.y)}, ${Math.round(r.width)}×${Math.round(r.height)}`;
