/**
 * Deck lint: the checks an agent runs to catch its own design mistakes (D12: lint first,
 * screenshot second). Structural rules only need the document; visual rules also need
 * `SlideMeasurement`s from the renderer and are skipped for slides without one.
 *
 * Every issue names the nodes involved and says how to fix it, so an agent can repair a
 * slide without guessing (or looking at a screenshot).
 */

import { compileSlide, type EffectResolver } from "./evaluate.js";
import { sectionAt } from "./fields.js";
import { parentOf } from "./layout-motion.js";
import {
  contrastRatio,
  flattenLayers,
  type NodeMeasurement,
  parseCssColor,
  type Rect,
  type SlideMeasurement,
} from "./measure.js";
import { duplicateMatchKeys, morphPairs } from "./morph.js";
import { isRestMotion, type MotionState } from "./motion.js";
import { slideMotionTokens } from "./motion-tokens.js";
import { expandAnimation } from "./presets.js";
import type { EffectRef } from "./schema/animation.js";
import type { Deck, Slide } from "./schema/deck.js";
import {
  type ElementNode,
  type FrameStyle,
  isFreeLayer,
  type Layout,
  type Node,
} from "./schema/node.js";
import { TextContentSchema, toPlainText } from "./schema/rich-text.js";
import type { Theme } from "./schema/theme.js";
import { suggest } from "./suggest.js";
import { parseColorToken, parseTokenRef, resolveToken } from "./tokens.js";
import { morphPartners, transitionInto } from "./transition.js";
import { isGraphic } from "./vector/graphics.js";

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
  "ignored-padding":
    "A free (absolute) frame has padding, which does nothing: free layers are measured from the frame's edges.",
  "section-field":
    "Text shows the section's name where that's wrong: on a slide in no section (it's empty), or as the title of a slide that doesn't start the section it names.",
  "duplicate-match-key":
    "Two layers on one slide share a morph match key, so morph pairs only the first of them.",
  "morph-unpaired":
    "A slide arrives with morph but no layer matches the slide before it (or there's none), so it plays as a fade.",
  "flat-depth":
    "A layer has a `depth` but its frame has no `perspective`, so the depth shows nothing (2.5D).",
  "depth-behind-viewer":
    "A layer's `depth` is at or past its frame's `perspective`: it's behind the viewer and isn't drawn.",
  "morph-blocked":
    "A layer a morph would glide has its own entrance (or a loop as the slide leaves), so it fades instead of gliding.",
  "flat-turn":
    "An animation turns a layer in 3D (a flip, rotateX/rotateY), but its frame has no `perspective`, so it draws as a flat squash.",
  "effect-misfit":
    "An effect plays on a layer it can't show on well (an installed effect says why: count-up on text with no number).",
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
  /** The installed effects (`registry.motionLint`): motion rules run only with them (D126). */
  motion?: MotionLintHooks;
}

/** What motion lint needs from the plugins: how effects play, and their own warnings. */
export interface MotionLintHooks {
  effects: EffectResolver;
  /** An effect's warning about a layer it can play on but won't show well (count-up, no number). */
  effectWarning?: (effect: EffectRef, target: Node) => { message: string; fix: string } | undefined;
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
  /**
   * The same inside a frame that fills the slide under its title (a layout's content area):
   * a short list at the top of it is the usual slide, so only a bare one is mentioned (one
   * line under a title).
   */
  emptyBandInArea: 0.7,
  /** Empty bands above and below closer than this (share of the height) are centred, not bunched. */
  balancedBands: 0.1,
  /** A painted frame this tall (share of the slide) is a backdrop, not content, for balance. */
  backdropShare: 0.9,
  /** Free layers shorter than this (share of the slide) don't count for balance (labels). */
  smallFreeShare: 0.08,
} as const;

const SEVERITY_ORDER: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

export function lintDeck(deck: Deck, options: LintOptions = {}): LintIssue[] {
  const only = options.slideIds ? new Set(options.slideIds) : null;
  const issues: LintIssue[] = [];
  deck.slides.forEach((slide, index) => {
    if (only && !only.has(slide.id)) return;
    const slideIssues = [
      ...structuralRules(slide),
      ...sectionFieldRules(deck, slide, index),
      ...positionRules(slide),
      ...matchKeyRules(slide),
      ...morphRules(deck, slide, index),
      ...depthRules(slide),
      ...(options.motion ? motionRules(deck, slide, options.motion) : []),
      ...tokenRules(slide, deck.theme),
      ...visualRules(slide, options.measurements?.get(slide.id)),
      ...balanceRules(slide, options.measurements?.get(slide.id)),
    ];
    slideIssues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    issues.push(...slideIssues);
  });
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

// ── Section fields (D97) ─────────────────────────────────────────────────────────────

/** Title-sized text styles: a title showing the section's name is a section header's. */
const TITLE_STYLES = new Set(["$text.display", "$text.h1", "$text.h2"]);

function showsSection(node: ElementNode): boolean {
  const content = TextContentSchema.safeParse(node.props.content);
  if (!content.success || typeof content.data === "string") return false;
  return content.data.some((p) => p.runs.some((r) => r.field === "section"));
}

/**
 * A `section` field is live, so it can go quietly wrong: before the first section it shows
 * nothing, and a section header whose section was ended (or that was moved) shows the name
 * of the section before it, as its title.
 */
function sectionFieldRules(deck: Deck, slide: Slide, index: number): LintIssue[] {
  const issues: LintIssue[] = [];
  const name = sectionAt(deck, index);
  for (const { node } of visibleNodes(slide)) {
    if (node.kind !== "element" || !showsSection(node)) continue;
    if (name === null) {
      issues.push({
        rule: "section-field",
        severity: "warning",
        slideId: slide.id,
        nodeIds: [node.id],
        message: `${describe(node)} shows the section's name, but slide "${slide.id}" is in no section: it shows nothing.`,
        fix: `Start a section on this slide or one before it (slide.update with "section": "<name>"), or take the field out.`,
      });
    } else if (slide.section === undefined && TITLE_STYLES.has(String(node.props.style))) {
      const start = deck.slides.findLastIndex((s, i) => i < index && s.section !== undefined);
      issues.push({
        rule: "section-field",
        severity: "warning",
        slideId: slide.id,
        nodeIds: [node.id],
        message: `${describe(node)} is a title showing the section's name, "${name}", which starts on slide ${start + 1}, not here.`,
        fix: `If this slide opens a new section, start it here (slide.update { "id": "${slide.id}", "set": { "section": "<name>" } }). Otherwise type the title, or remove the slide.`,
      });
    }
  }
  return issues;
}

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

/** A match key twice on one slide: morph would pair only the first layer (D109). */
function matchKeyRules(slide: Slide): LintIssue[] {
  return [...duplicateMatchKeys(slide)].map(([key, ids]) => ({
    rule: "duplicate-match-key",
    severity: "warning",
    slideId: slide.id,
    nodeIds: ids,
    message: `${ids.length} layers on slide "${slide.id}" share the match key "${key}" (${ids.map((id) => `"${id}"`).join(", ")}), so morph pairs only the first.`,
    fix: 'Give each a different "matchKey", or remove the key from the ones that shouldn\'t morph ("matchKey": null).',
  }));
}

/**
 * A morph with nothing to glide (D123): no slide before it in the show, or no layer on it
 * that matches one here. It still plays (as a fade), but that's rarely what was meant.
 */
function morphRules(deck: Deck, slide: Slide, index: number): LintIssue[] {
  if (slide.hidden || transitionInto(deck, slide)?.type !== "morph") return [];
  const before = deck.slides.slice(0, index).findLast((s) => !s.hidden);
  if (before && morphPairs(before, slide).length > 0) return [];
  return [
    {
      rule: "morph-unpaired",
      severity: "warning",
      slideId: slide.id,
      nodeIds: [],
      message: before
        ? `Slide "${slide.id}" morphs from "${before.id}", but no layer matches one there, so it plays as a fade.`
        : `Slide "${slide.id}" morphs, but it's the first slide shown: there's nothing to morph from, so it plays as a fade.`,
      fix: before
        ? `Give a layer here and its counterpart on "${before.id}" the same "matchKey" (e.g. "logo"), or set "transition": { "type": "fade" }.`
        : 'Use another transition ("fade", or null for the theme\'s), or move the slide after the one it should morph from.',
    },
  ];
}

/**
 * Motion that quietly doesn't show (D126): a morph partner with its own entrance or loop
 * fades instead of gliding, a 3D turn without perspective squashes flat, and an effect on a
 * layer it can't show (count-up with no number). Each plays without error, which is why
 * agents and people missed them: lint names them with the fix.
 */
function motionRules(deck: Deck, slide: Slide, hooks: MotionLintHooks): LintIssue[] {
  const animations = slide.animations ?? [];
  if (animations.length === 0) return [];
  const issues: LintIssue[] = [];
  const tokens = slideMotionTokens(deck, slide);
  const nodes = new Map(visibleNodes(slide).map(({ node }) => [node.id, node]));

  // Morph partners: at rest when the slide arrives, and when it leaves.
  const { arriving, leaving } = morphPartners(deck, slide);
  if (arriving.size > 0 || leaving.size > 0) {
    const compiled = compileSlide(deck, slide, { effects: hooks.effects });
    const atStart = compiled.seek(0, 0);
    const last = compiled.steps.length - 1;
    const atEnd = compiled.seek(last, compiled.steps[last]?.duration ?? 0);
    const moved = (frame: typeof atStart, id: string) =>
      !isRestMotion(frame.get(id)?.motion as MotionState | undefined);
    for (const id of arriving) {
      if (!moved(atStart, id)) continue;
      issues.push({
        rule: "morph-blocked",
        severity: "warning",
        slideId: slide.id,
        nodeIds: [id],
        message: `"${id}" has its own entrance, so the morph into slide "${slide.id}" doesn't glide it: it fades in by its animation instead.`,
        fix: `Remove "${id}"'s entrance (the morph brings it in), or remove its matchKey if it shouldn't glide.`,
      });
    }
    for (const id of leaving) {
      const loops = animations.some((a) => a.target === id && a.repeat === "forever");
      if (!loops && !moved(atEnd, id)) continue;
      issues.push({
        rule: "morph-blocked",
        severity: "warning",
        slideId: slide.id,
        nodeIds: [id],
        message: `"${id}" ${loops ? "loops" : "has moved away"} as slide "${slide.id}" ends, so the morph to the next slide doesn't glide it.`,
        fix: `Remove its ${loops ? "loop" : "exit"} (a morph needs it at rest at the cut), or remove its matchKey.`,
      });
    }
  }

  for (const stored of animations) {
    const animation = expandAnimation(stored, deck.presets);
    const target = nodes.get(animation.target);
    if (!target) continue;
    const resolved = animation.effect
      ? hooks.effects(animation.effect, { animation, target, tokens })
      : null;
    const tracks = { ...resolved?.tracks, ...animation.tracks };
    // A 3D turn without perspective on the frame that draws it.
    if ("rotateX" in tracks || "rotateY" in tracks) {
      const frame = parentOf(slide.root, target.id);
      const space = animation.stagger && target.kind === "frame" ? target : frame;
      if (space && space.perspective === undefined) {
        const where = space.id === slide.root.id ? "the slide" : `frame "${space.id}"`;
        issues.push({
          rule: "flat-turn",
          severity: "warning",
          slideId: slide.id,
          nodeIds: [target.id],
          message: `Animation "${stored.id}" turns "${target.id}" in 3D, but ${where} has no perspective, so it draws as a flat squash.`,
          fix: `Give ${where} "perspective": 1200 (800 strong, 2000 gentle)${space.id === slide.root.id ? "" : ", or turn it without 3D (zoom-in)"}.`,
        });
      }
    }
    // The effect's own word on this layer.
    const warning = animation.effect && hooks.effectWarning?.(animation.effect, target);
    if (warning) {
      issues.push({
        rule: "effect-misfit",
        severity: "warning",
        slideId: slide.id,
        nodeIds: [target.id],
        message: `Animation "${stored.id}": ${warning.message}`,
        fix: warning.fix,
      });
    }
  }
  return issues;
}

/**
 * 2.5D's two traps (D112): depth only shows inside a frame with perspective, and a layer at
 * or past the viewer's distance vanishes. Both look like a broken renderer, so say why.
 */
function depthRules(slide: Slide): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const { node: frame } of visibleNodes(slide)) {
    if (frame.kind !== "frame") continue;
    for (const child of frame.children) {
      if (child.hidden || !child.depth) continue;
      const where = frame.id === slide.root.id ? "the slide" : `frame "${frame.id}"`;
      if (frame.perspective === undefined) {
        issues.push({
          rule: "flat-depth",
          severity: "warning",
          slideId: slide.id,
          nodeIds: [child.id],
          message: `${describe(child)} has depth ${child.depth}, but ${where} has no perspective, so it shows nothing.`,
          fix: `Give ${frame.id === slide.root.id ? `the slide's root frame "${frame.id}"` : `frame "${frame.id}"`} a perspective (e.g. "perspective": 1200), or remove the depth ("depth": null).`,
        });
      } else if (child.depth >= frame.perspective) {
        issues.push({
          rule: "depth-behind-viewer",
          severity: "error",
          slideId: slide.id,
          nodeIds: [child.id],
          message: `${describe(child)} has depth ${child.depth}, at or past ${where}'s perspective (${frame.perspective}): it's behind the viewer and isn't drawn.`,
          fix: `Use a depth well under ${frame.perspective} (e.g. ${Math.round(frame.perspective / 4)}), or a larger perspective.`,
        });
      }
    }
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
    if (
      node.kind === "frame" &&
      node.layout.mode === "absolute" &&
      node.layout.padding !== undefined
    ) {
      issues.push({
        rule: "ignored-padding",
        severity: "warning",
        slideId: slide.id,
        nodeIds: [node.id],
        message: `${describe(node)} is a free (absolute) frame with padding, but its children are placed from the frame's edges, so the padding does nothing.`,
        fix: "Remove the padding and add the inset to the children's positions, or make the frame a stack/grid if its children should be laid out inside the padding.",
      });
    }
    if (node.kind === "frame") for (const child of node.children) visit(child, node.layout);
  };
  visit(slide.root, null);
  return issues;
}

/** Free layers and everything inside them: placed by position, outside the slide's flow. */
function freeSubtrees(slide: Slide): Set<string> {
  const ids = new Set<string>();
  const visit = (node: Node, parent: Layout | null, inFree: boolean) => {
    const free = inFree || isFreeLayer(node, parent);
    if (free) ids.add(node.id);
    if (node.kind === "frame") for (const child of node.children) visit(child, node.layout, free);
  };
  visit(slide.root, null, false);
  return ids;
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

/**
 * Token references (`"$group.name"`) anywhere inside a JSON value. A color at an opacity
 * (`"$color.primary/30"`) counts as its token, so a misspelled one is caught too.
 */
function tokenRefsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const ref = parseColorToken(value)?.token ?? (parseTokenRef(value) ? value : null);
    if (ref) into.add(ref);
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
 * What counts as content: elements, and frames that draw something (a filled or stroked
 * card is content even where its text ends early). Not counted: frames that only arrange
 * (a "fill" frame spans the slide even when its content doesn't), a painted backdrop as tall
 * as the slide, and small free layers (a page number in a corner doesn't fill an empty
 * half). Big free layers, like a diagram's boxes in a Free frame, count.
 */
function balanceRules(slide: Slide, m: SlideMeasurement | undefined): LintIssue[] {
  if (!m) return [];
  const free = freeSubtrees(slide);
  const height = m.stage.height;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const { node } of visibleNodes(slide)) {
    const bounds = m.nodes[node.id]?.bounds;
    if (!bounds || bounds.height <= 0) continue;
    if (node.kind === "frame") {
      if (node.id === slide.root.id || !paints(node.style)) continue;
      if (bounds.height >= height * LINT_LIMITS.backdropShare) continue;
    }
    if (free.has(node.id) && bounds.height < height * LINT_LIMITS.smallFreeShare) continue;
    top = Math.min(top, bounds.y);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  if (!Number.isFinite(top)) return [];
  const below = (height - bottom) / height;
  const above = top / height;
  const band = Math.max(above, below);
  // A frame that fills the slide's column (a layout's content slot, s3-content) holds the
  // content, from its top: space under a short list there is the usual look.
  const filler = slide.root.children.find(
    (c) => c.kind === "frame" && !c.hidden && c.height === "fill",
  );
  if (band <= (filler ? LINT_LIMITS.emptyBandInArea : LINT_LIMITS.emptyBand)) return [];
  // Equal space above and below is a centred slide (a title slide), not content at one edge.
  if (Math.abs(above - below) < LINT_LIMITS.balancedBands) return [];
  const where = below >= above ? "bottom" : "top";
  const ignore = "It's only a hint: leave it if the space is meant to be there.";
  return [
    {
      rule: "empty-space",
      severity: "info",
      slideId: slide.id,
      nodeIds: [filler?.id ?? slide.root.id],
      message: `The ${where} ${Math.round(band * 100)}% of slide "${slide.id}" is empty.`,
      fix: filler
        ? `The content is in "${filler.id}", which fills the slide under the title, and it's nearly empty: add points or a visual, use "$text.lead" for the text, or use a layout made for one line (Big number, Quote, Section header). Don't center it there: content floating mid-slide under a top title looks unfinished. ${ignore} Check with render_preview.`
        : `Center the content (justify: "center" on the slide), let cards grow (height: "fill"), use larger styles, or add a visual. ${ignore} Check with render_preview.`,
    },
  ];
}

/** A frame that draws something: a fill, a stroke or a shadow. */
function paints(style: FrameStyle | undefined): boolean {
  return Boolean(style && (style.fill !== undefined || style.stroke || style.shadow));
}

function visualRules(slide: Slide, m: SlideMeasurement | undefined): LintIssue[] {
  if (!m) return [];
  const issues: LintIssue[] = [];
  const issue = (i: Omit<LintIssue, "slideId">) => issues.push({ slideId: slide.id, ...i });
  const tol = LINT_LIMITS.tolerance;
  const scale = 1920 / m.stage.width; // compare font sizes as if on a 1920-wide stage
  const free = freeSubtrees(slide);
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

  // Off the slide: elements, and frames that draw something (a box in a diagram). Once a
  // box is reported, what's inside it isn't reported again.
  const offCanvas = new Set<string>();
  const drawn = measured.filter(
    (x) =>
      isElement(x.node) ||
      (x.node.kind === "frame" && x.node.id !== slide.root.id && paints(x.node.style)),
  );
  for (const { node, ancestors, m: nm } of drawn) {
    const b = nm.bounds;
    if (b.width <= 0 && b.height <= 0) continue;
    if (ancestors.some((id) => offCanvas.has(id))) continue;
    const before = issues.length;
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
    if (issues.length > before) offCanvas.add(node.id);
  }

  // Overlap between content elements. Graphics are excluded: shapes are usually backgrounds
  // or decor, lines and arrows point at things, and icons sit on cards (D127).
  const content = elements.filter((x) => !isGraphic(x.node));
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
          fix:
            free.has(a.node.id) || free.has(b.node.id)
              ? "One of them is a free layer. If the other is text, it fills its frame's width by default: give it width: \"hug\" so it stops before the free layer. Otherwise move the free layer (position, anchor). Ignore if it's intentional (e.g. a badge over an image)."
              : "Put them in a stack/grid frame instead of absolute or free positions, or move one. Ignore if it's intentional (e.g. a caption over an image).",
        });
      }
    }
  }

  for (const { node, m: nm } of elements) {
    if (!nm.text?.length) continue;
    let worst: { ratio: number; needed: number; gradient: boolean } | null = null;
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
      if (ratio < needed && (!worst || ratio < worst.ratio)) {
        worst = { ratio, needed, gradient: sample.gradient === true };
      }
    }
    if (worst) {
      issue({
        rule: "low-contrast",
        severity: worst.ratio < 2 ? "error" : "warning",
        nodeIds: [node.id],
        message: `${describe(node)} has a contrast of ${worst.ratio.toFixed(2)}:1 against what's behind it (needs ${worst.needed}:1).`,
        fix: worst.gradient
          ? "A gradient behind it is too close to the text color where the text sits. Move the text to the part that contrasts, change that stop's color or opacity, or use a text color that contrasts with it."
          : 'Use "$color.text" or "$color.muted" on the slide background and "$color.surface" cards, "$color.on-primary" on "$color.primary" fills, or change the background.',
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
