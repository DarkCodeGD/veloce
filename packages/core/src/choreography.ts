/**
 * Choreography from intent (D104 §3, D111 §7, D121): "Animate this slide". A rule-based
 * engine, no AI, that turns a small intent (how it's paced, what to punch) into ordinary,
 * editable animations, from each layer's role on the slide, reading order, the slide's
 * motion level and the theme's `$motion` tokens. The editor's button and MCP call the same
 * function, so a person (one click) and an agent (one call) get the same slide (golden
 * rule 1). Pure: the same slide and intent give the same animations, IDs aside.
 *
 * How it reads a slide:
 * 1. **Units, in reading order.** Each layer that would animate on its own: a text, an
 *    image, a shape, a card (a frame with a fill, stroke or shadow, animated whole), or a
 *    list (a stack or grid of two or more alike children, played one by one). Plain frames
 *    are see-through: their children are the units.
 * 2. **Roles.** `title` (the first display/h1 heading, else the first h2), `number` (a
 *    short, large text that's mostly a figure: "42%", "$4.2M"), `body` (other text),
 *    `visual` (images, and plugin elements like charts), `accent` (shapes: icons,
 *    dividers) and `backdrop` (a free layer covering most of the slide). A card or list
 *    takes the strongest role inside it.
 * 3. **The level decides how much moves** (`MOTION_LEVEL_SCALES`): its reach picks the
 *    roles that animate (calm: the title and the main point only), its effects-per-layer
 *    cap bounds entrance + emphasis + loop, and its ambient reach picks what keeps moving.
 * 4. **The intent decides when:** `auto` plays everything as the slide appears, cascading;
 *    `build` brings the title in with the slide, then one point per click (lists one item
 *    per click); `focus` brings everything in, then punches the main point on a click.
 *    `emphasize` names the layers to punch (else the main point: a number, a visual, or
 *    the first body text).
 *
 * Effects are the built-in effect presets by name (the effects and text plugins). When the
 * caller says one isn't installed, a plain fade stands in, so the result always applies.
 */
import { createId } from "./ids.js";
import { parentOf } from "./layout-motion.js";
import { MOTION_LEVEL_SCALES, slideMotionLevel } from "./motion-tokens.js";
import type { Op } from "./ops/schema.js";
import type { Animation } from "./schema/animation.js";
import type { Deck, Slide } from "./schema/deck.js";
import type { MotionLevel, Time } from "./schema/motion.js";
import { type ElementNode, type FrameNode, isFreeLayer, type Node } from "./schema/node.js";
import { toPlainText } from "./schema/rich-text.js";
import { morphPartners } from "./transition.js";

type StaggerFrom = NonNullable<NonNullable<Animation["stagger"]>["from"]>;

// ── Intent ────────────────────────────────────────────────────────────────────────────

export const CHOREOGRAPHY_PACINGS = ["auto", "build", "focus"] as const;
export type ChoreographyPacing = (typeof CHOREOGRAPHY_PACINGS)[number];

export interface ChoreographyIntent {
  /** Default `auto`. */
  pacing?: ChoreographyPacing;
  /** Layers to punch (an emphasis after they enter, or their own click). */
  emphasize?: readonly string[];
}

export interface ChoreographyOptions {
  /** Whether an effect is installed; effects that aren't fall back to a plain fade. */
  hasEffect?: (name: string) => boolean;
  /** New animation IDs (default: `createId("an")`); tests pass a counter. */
  newId?: () => string;
}

export interface Choreography {
  /** The slide's new animations, in play order: they replace its current ones. */
  animations: Animation[];
  level: MotionLevel;
  /** How many layers move (a list counts its items). */
  moving: number;
  /** Plain notes for people and agents: what was left still, and why. */
  notes: string[];
}

// ── Roles and units ───────────────────────────────────────────────────────────────────

export type LayerRole = "title" | "number" | "body" | "visual" | "accent" | "backdrop";

/** Strongest first: a card or list takes the strongest role inside it. */
const ROLE_STRENGTH: readonly LayerRole[] = [
  "title",
  "number",
  "visual",
  "body",
  "accent",
  "backdrop",
];
const stronger = (a: LayerRole, b: LayerRole) =>
  ROLE_STRENGTH.indexOf(a) <= ROLE_STRENGTH.indexOf(b) ? a : b;

/** Something the engine animates as one: a layer, or a list played one by one. */
export interface ChoreographyUnit {
  /**
   * A kicker above the title (or the big number) or a subtitle under it: plays as part of
   * the heading, with it (D126).
   */
  companion?: boolean;
  /** A drawing (a free-form frame of shapes): its parts cascade in, but it's one point. */
  drawing?: boolean;
  node: Node;
  role: LayerRole;
  /** A list's items in reading order (the frame staggers them); absent for one layer. */
  items?: Node[];
}

const HEADINGS = new Set(["display", "h1"]);
const LARGE = new Set(["display", "h1", "h2", "h3", "lead"]);
/**
 * A figure: digits with at most a few symbols or one unit word around them ("42%",
 * "$4.2M", "3×", "12k users", "70 cherries", "1,200 °C"). A year with a word ("2026 roadmap") is a
 * heading, not a figure: counting a year up from 0 looks broken.
 */
const FIGURE = /^[^\p{L}\d]{0,3}[\d.,]+\s?[\p{L}%×x+°]{0,12}$/u;
const YEAR_HEADING = /^(?:19|20)\d\d\s+\p{L}/u;

const textStyle = (node: ElementNode): string | undefined => {
  const style = node.props.style;
  return typeof style === "string" && style.startsWith("$text.") ? style.slice(6) : undefined;
};

const textOf = (node: ElementNode): string => {
  try {
    return toPlainText(node.props.content as never).trim();
  } catch {
    return "";
  }
};

/** A free layer that covers at least half the stage both ways: it sets the scene. */
function isBackdrop(node: Node, parent: FrameNode, stage: Deck["stage"]): boolean {
  if (!isFreeLayer(node, parent.layout)) return false;
  const big = (size: unknown, of: number) =>
    size === "fill" || (typeof size === "number" && size >= of / 2);
  return big(node.width, stage.width) && big(node.height, stage.height);
}

const hasLook = (frame: FrameNode): boolean =>
  Boolean(frame.style?.fill || frame.style?.stroke || frame.style?.shadow);

/** Children alike enough to be a list: all text, all cards, all images… */
const kindOf = (node: Node): string =>
  node.kind === "frame" ? (hasLook(node) ? "card" : "frame") : node.type;

/**
 * A slide's units in reading order, each with its role. The footer and hidden layers never
 * animate.
 */
export function choreographyUnits(slide: Slide, stage: Deck["stage"]): ChoreographyUnit[] {
  const units: ChoreographyUnit[] = [];
  let titled = false;

  const elementRole = (node: ElementNode, parent: FrameNode): LayerRole => {
    if (isBackdrop(node, parent, stage)) return "backdrop";
    // A shape big enough to look at is the slide's visual (a planet, a star); small ones
    // (dots, rules, badges) decorate.
    if (node.type === "shape") return sized(node, HERO_SHAPE) ? "visual" : "accent";
    if (node.type !== "text") return "visual";
    const style = textStyle(node) ?? "body";
    const text = textOf(node);
    if (LARGE.has(style) && text.length <= 16 && FIGURE.test(text) && !YEAR_HEADING.test(text)) {
      return "number";
    }
    if (!titled && (HEADINGS.has(style) || style === "h2")) {
      titled = true;
      return "title";
    }
    return "body";
  };

  /** The strongest role inside a frame (a card, or a list's items). */
  const roleInside = (frame: FrameNode): LayerRole => {
    let role: LayerRole = "backdrop";
    const visit = (node: Node, parent: FrameNode) => {
      if (node.hidden) return;
      if (node.kind === "frame") for (const child of node.children) visit(child, node);
      else role = stronger(role, elementRole(node, parent));
    };
    for (const child of frame.children) visit(child, frame);
    return role === "backdrop" ? "accent" : role;
  };

  const visit = (node: Node, parent: FrameNode) => {
    if (node.hidden) return;
    if (node.kind === "element") {
      units.push({ node, role: elementRole(node, parent) });
      return;
    }
    const shown = node.children.filter((c) => !c.hidden);
    if (shown.length === 0) return;
    if (isBackdrop(node, parent, stage)) {
      units.push({ node, role: "backdrop" });
      return;
    }
    // A drawing: a free-form frame of shapes (labels allowed). One visual, built in parts.
    if (isDrawing(node, shown)) {
      units.push({ node, role: "visual", items: shown, drawing: true });
      return;
    }
    // A stack or grid of alike children reads as a list: bullets, a row of stats, cards.
    const kinds = new Set(shown.map(kindOf));
    const flowing = shown.every((c) => !isFreeLayer(c, node.layout));
    if (node.layout.mode !== "absolute" && shown.length >= 2 && kinds.size === 1 && flowing) {
      const [only] = kinds;
      // A list of headings isn't a list: the first is the title, the rest its subtitle.
      const headings =
        only === "text" &&
        shown.some((c) => c.kind === "element" && HEADINGS.has(textStyle(c) ?? ""));
      if (!headings) {
        const role = roleInside(node);
        units.push({ node, role: role === "title" ? "body" : role, items: shown });
        return;
      }
    }
    if (hasLook(node)) {
      units.push({ node, role: roleInside(node) });
      return;
    }
    for (const child of shown) visit(child, node);
  };

  for (const child of slide.root.children) visit(child, slide.root);
  markCompanions(slide, units);
  return units;
}

/** Shapes at least this big both ways are visuals (stage pixels). */
const HERO_SHAPE = 160;
const sized = (node: Node, min: number) =>
  typeof node.width === "number" &&
  typeof node.height === "number" &&
  Math.min(node.width, node.height) >= min;

/** Small text styles that label rather than say: kickers, captions on drawings. */
const LABELS = new Set(["caption", "small", "overline", "label", "eyebrow"]);
/** Styles a subtitle under a title is set in. */
const SUBTITLES = new Set(["h2", "h3", "lead"]);

function isDrawing(frame: FrameNode, shown: readonly Node[]): boolean {
  const free = frame.layout.mode === "absolute" || shown.every((c) => isFreeLayer(c, frame.layout));
  if (!free || shown.length < 2) return false;
  let shapes = 0;
  for (const child of shown) {
    if (child.kind !== "element") return false;
    if (child.type === "shape" || child.type === "image") shapes++;
    else if (child.type !== "text" || !LABELS.has(textStyle(child) ?? "body")) return false;
  }
  return shapes >= 2;
}

/**
 * A kicker ("Stage 1 · Nebula") right before the title or the big number, and a subtitle
 * right after the title, in the same frame: they come with the heading, not on a click.
 */
function markCompanions(slide: Slide, units: ChoreographyUnit[]): void {
  const parent = (u: ChoreographyUnit | undefined) => u && parentOf(slide.root, u.node.id);
  const style = (u: ChoreographyUnit) =>
    u.node.kind === "element" && u.node.type === "text" && !u.items
      ? (textStyle(u.node) ?? "body")
      : undefined;
  units.forEach((unit, i) => {
    const next = units[i + 1];
    const prev = units[i - 1];
    const s = style(unit);
    if (!s || unit.role === "title") return;
    const kicker =
      next &&
      LABELS.has(s) &&
      (next.role === "title" || next.role === "number") &&
      parent(next) === parent(unit);
    const subtitle =
      prev?.role === "title" &&
      !prev.companion &&
      SUBTITLES.has(s) &&
      parent(prev) === parent(unit);
    if (kicker || subtitle) {
      unit.role = "title";
      unit.companion = true;
    }
  });
}

// ── What each level plays ─────────────────────────────────────────────────────────────

interface Move {
  effect: string;
  params?: Record<string, unknown>;
  duration?: Time;
}

/** Entrances per level and role: calm fades, subtle rises, then bigger and wilder. */
const ENTRANCES: Record<MotionLevel, Record<LayerRole, Move>> = {
  calm: {
    title: { effect: "fade-in" },
    number: { effect: "fade-in" },
    body: { effect: "fade-in" },
    visual: { effect: "fade-in" },
    accent: { effect: "fade-in" },
    backdrop: { effect: "fade-in" },
  },
  subtle: {
    title: { effect: "slide-in" },
    number: { effect: "scale-in" },
    body: { effect: "slide-in" },
    visual: { effect: "scale-in" },
    accent: { effect: "fade-in" },
    backdrop: { effect: "fade-in" },
  },
  lively: {
    title: { effect: "slide-in" },
    number: { effect: "count-up" },
    body: { effect: "slide-in" },
    visual: { effect: "zoom-in" },
    accent: { effect: "scale-in" },
    backdrop: { effect: "fade-in", duration: "$motion.slow" },
  },
  intense: {
    title: { effect: "blur-in" },
    number: { effect: "count-up" },
    body: { effect: "slide-in" },
    visual: { effect: "zoom-in" },
    accent: { effect: "pop-in" },
    backdrop: { effect: "zoom-in", duration: "$motion.slow" },
  },
  absurd: {
    title: { effect: "flip-in" },
    number: { effect: "count-up" },
    body: { effect: "pop-in" },
    visual: { effect: "flip-in" },
    accent: { effect: "pop-in" },
    backdrop: { effect: "zoom-in", duration: "$motion.slow" },
  },
};

/** A card (a frame) can't count up: it enters like a visual. */
const CARD_NUMBER: Record<MotionLevel, Move> = {
  calm: { effect: "fade-in" },
  subtle: { effect: "scale-in" },
  lively: { effect: "pop-in" },
  intense: { effect: "pop-in" },
  absurd: { effect: "flip-in" },
};

const EMPHASIS: Record<MotionLevel, Move> = {
  calm: { effect: "pulse" },
  subtle: { effect: "pulse" },
  lively: { effect: "pulse" },
  intense: { effect: "pulse" },
  absurd: { effect: "bounce" },
};

/** Keeps moving once it's in: a slow drift, made to loop. */
const AMBIENT: Move = { effect: "float", duration: 3000 };

/** Roles each reach (and ambient reach) covers (D111 §7). */
const REACH: Record<string, ReadonlySet<LayerRole>> = {
  none: new Set(),
  content: new Set(["title", "number", "body", "visual"]),
  most: new Set(["title", "number", "body", "visual", "accent"]),
  all: new Set(ROLE_STRENGTH),
};
/** Loops only on things that carry the slide, never on reading text below absurd. */
const AMBIENT_CONTENT: ReadonlySet<LayerRole> = new Set(["number", "visual"]);

const STAGGER_FROM: Record<MotionLevel, StaggerFrom> = {
  calm: "start",
  subtle: "start",
  lively: "start",
  intense: "center",
  absurd: "random",
};

/** The step a unit's play goes in, and what punches it. */
interface Planned {
  unit: ChoreographyUnit;
  entrance: Move;
  emphasis: boolean;
  ambient: boolean;
}

// ── The engine ────────────────────────────────────────────────────────────────────────

/**
 * Animate a slide from an intent: the animations that replace its current ones. Throws
 * nothing: names in `emphasize` that aren't on the slide are left out with a note.
 */
export function choreograph(
  deck: Pick<Deck, "motionLevel" | "stage"> & Partial<Pick<Deck, "slides" | "theme">>,
  slide: Slide,
  intent: ChoreographyIntent = {},
  options: ChoreographyOptions = {},
): Choreography {
  const level = slideMotionLevel(deck, slide);
  const scale = MOTION_LEVEL_SCALES[level];
  const pacing = intent.pacing ?? "auto";
  const newId = options.newId ?? (() => createId("an"));
  const installed = options.hasEffect ?? (() => true);
  const notes: string[] = [];

  const units = choreographyUnits(slide, deck.stage);
  const owner = (id: string) =>
    units.find((u) => u.node.id === id || u.items?.some((i) => i.id === id || contains(i, id)));
  const contains = (node: Node, id: string): boolean =>
    node.kind === "frame" && node.children.some((c) => c.id === id || contains(c, id));

  // The main point: what calm still moves, and what focus punches by default.
  const main =
    units.find((u) => u.role === "number") ??
    units.find((u) => u.role === "visual") ??
    units.find((u) => u.role === "body") ??
    units.find((u) => u.role === "title");

  // Morph partners (D123): an arriving one comes in by the morph, so it gets no entrance; a
  // leaving one must be at rest at the cut, so it gets no loop. Either would turn its glide
  // into a fade (D126).
  const partners =
    deck.slides && deck.theme
      ? morphPartners(
          { slides: deck.slides, theme: deck.theme, motionLevel: deck.motionLevel },
          slide,
        )
      : { arriving: new Set<string>(), leaving: new Set<string>() };
  const holds = (unit: ChoreographyUnit, ids: ReadonlySet<string>) =>
    ids.has(unit.node.id) || [...ids].some((id) => contains(unit.node, id));
  const morphed = units.filter((u) => holds(u, partners.arriving));
  if (morphed.length > 0) {
    notes.push(
      `${morphed.map((u) => `"${u.node.id}"`).join(", ")} ${morphed.length === 1 ? "comes" : "come"} in by the morph from the slide before, so ${morphed.length === 1 ? "it gets" : "they get"} no entrance.`,
    );
  }

  // Who to punch: the layers asked for, by the unit that plays them.
  const punched = new Set<ChoreographyUnit>();
  for (const id of intent.emphasize ?? []) {
    const unit = owner(id);
    if (unit) punched.add(unit);
    else notes.push(`"${id}" isn't a layer on this slide that animates, so it's not emphasized.`);
  }
  if (pacing === "focus" && punched.size === 0 && main) punched.add(main);

  // What moves: the level's reach, plus anything asked to be punched.
  const reach =
    scale.reach === "key"
      ? new Set(units.filter((u) => u.role === "title" || u === main))
      : new Set(units.filter((u) => REACH[scale.reach]?.has(u.role)));
  for (const unit of punched) reach.add(unit);
  for (const unit of morphed) reach.delete(unit);
  const still = units.length - reach.size - morphed.length;
  if (still > 0) {
    notes.push(
      `${still} ${still === 1 ? "layer stays" : "layers stay"} still at "${level}": ${scale.summary}`,
    );
  }

  const cap = scale.effectsPerLayer ?? Number.POSITIVE_INFINITY;
  // What keeps moving: the slide's visual (key), what carries the slide (content), or all.
  // Reading text never drifts below absurd, and nothing a morph carries on loops.
  const hero = units.find((u) => u.role === "visual" && !holds(u, partners.leaving));
  const keepsMoving = (unit: ChoreographyUnit) =>
    !holds(unit, partners.leaving) &&
    (scale.ambient === "all" ||
      (scale.ambient === "content" && AMBIENT_CONTENT.has(unit.role)) ||
      (scale.ambient === "key" && unit === hero));
  const planned: Planned[] = units
    .filter((u) => reach.has(u))
    .map((unit) => {
      const loops = keepsMoving(unit);
      const emphasis = punched.has(unit) && cap >= 2;
      return {
        unit,
        entrance: entranceFor(unit, level),
        emphasis,
        ambient: loops && cap >= (emphasis ? 3 : 2),
      };
    });
  if (punched.size > 0 && cap < 2 && pacing !== "focus") {
    notes.push(
      `"${level}" gives each layer one effect, so the emphasized layers get no extra punch. Use pacing "focus" to give them their own click, or a livelier level.`,
    );
  }

  // ── Timing ──────────────────────────────────────────────────────────────────────
  const out: Animation[] = [];
  const flattened = new Set<string>();
  const play = (
    target: string,
    move: Move,
    timing: Pick<Animation, "trigger" | "delay" | "stagger" | "repeat">,
  ): Animation => {
    // A flip turns in 3D: without a perspective on the layer's frame it draws as a flat
    // squash, so it zooms instead, and a note says how to get the flip (D126).
    // A staggered list flips its items, which sit in the list's own frame.
    const space = timing.stagger
      ? units.find((u) => u.node.id === target)?.node
      : parentOf(slide.root, target);
    const flat = move.effect === "flip-in" && !(space?.kind === "frame" && space.perspective);
    if (flat) flattened.add(target);
    const wanted: Move = flat ? { ...move, effect: "zoom-in" } : move;
    // An effect that isn't installed: a plain fade in its place, so the result applies.
    const m: Move = installed(wanted.effect) ? wanted : { effect: "", duration: wanted.duration };
    const animation: Animation = {
      id: newId(),
      target,
      ...(timing.trigger !== "onClick" && { trigger: timing.trigger }),
      ...(timing.delay !== undefined && { delay: timing.delay }),
      ...(m.duration !== undefined && { duration: m.duration }),
      ...(timing.stagger && { stagger: timing.stagger }),
      ...(timing.repeat !== undefined && { repeat: timing.repeat }),
      ...(m.effect
        ? { effect: { name: m.effect, ...(m.params && { params: m.params }) } }
        : { tracks: { opacity: [{ at: 0, value: 0 }] } }),
    };
    out.push(animation);
    return animation;
  };

  /** A unit's entrance: the frame staggers a list, or one animation per item when an item's effect can't play on the frame (count-up). */
  const enter = (p: Planned, first: Animation["trigger"], delay?: Time) => {
    const { unit } = p;
    // Calm brings a list in whole: one thing moving, not one per item.
    if (!unit.items || level === "calm") {
      return play(unit.node.id, p.entrance, { trigger: first, delay });
    }
    if (p.entrance.effect === "count-up") {
      unit.items.forEach((item, i) => {
        play(item.id, p.entrance, {
          trigger: i === 0 ? first : "withPrevious",
          delay: i === 0 ? delay : "$motion.stagger",
        });
      });
      return;
    }
    const from = STAGGER_FROM[level];
    return play(unit.node.id, p.entrance, {
      trigger: first,
      delay,
      stagger: from === "start" ? {} : { from },
    });
  };
  const emphasize = (p: Planned, trigger: Animation["trigger"]) =>
    play(p.unit.node.id, EMPHASIS[level], { trigger });
  const loop = (p: Planned, trigger: Animation["trigger"], delay?: Time) =>
    play(p.unit.node.id, AMBIENT, { trigger, delay, repeat: "forever" });

  /** Units cascade in as the slide appears (or on one click), then punches, then loops. */
  const cascade = (list: Planned[], firstTrigger: Animation["trigger"], punch = true) => {
    list.forEach((p, i) => {
      enter(p, i === 0 ? firstTrigger : "withPrevious", i === 0 ? undefined : "$motion.fast");
    });
    const punches = punch ? list.filter((p) => p.emphasis) : [];
    punches.forEach((p, i) => {
      emphasize(p, i === 0 ? "afterPrevious" : "withPrevious");
    });
    list
      .filter((p) => p.ambient)
      .forEach((p, i) => {
        loop(p, i === 0 ? "afterPrevious" : "withPrevious");
      });
  };

  if (pacing === "auto") {
    cascade(planned, "withPrevious");
  } else if (pacing === "build") {
    // The heading and the scenery come with the slide; then each point on its own click.
    // With no heading, the big number is the headline: it comes with the slide, its
    // caption with it, so the slide never opens empty (D126).
    const heading = units.some((u) => u.role === "title" && !u.companion);
    const headline = !heading && main?.role === "number" ? main : undefined;
    const after = headline ? units[units.indexOf(headline) + 1] : undefined;
    const caption =
      after && after.node.kind === "element" && after.node.type === "text" && !after.items
        ? after
        : undefined;
    // A visual with nothing else to say beside the heading (a title slide's art) is scenery.
    const points = units.filter((u) => u.role === "body" || u.role === "number").length;
    const withSlide = planned.filter(
      (p) =>
        ["title", "accent", "backdrop"].includes(p.unit.role) ||
        (p.unit.role === "visual" && points === 0) ||
        p.unit === headline ||
        p.unit === caption,
    );
    cascade(withSlide, "withPrevious");
    for (const p of planned.filter((q) => !withSlide.includes(q))) {
      if (p.unit.items && !p.unit.drawing) {
        for (const item of p.unit.items) play(item.id, p.entrance, { trigger: "onClick" });
      } else {
        enter(p, "onClick");
      }
      if (p.emphasis) emphasize(p, "afterPrevious");
      if (p.ambient) loop(p, "afterPrevious");
    }
  } else {
    // Focus: everything in as the slide appears; then a click punches the main point.
    // One effect per layer (calm, subtle): the punched layer enters on that click instead.
    const ownClick = cap < 2;
    cascade(
      planned.filter((p) => !(ownClick && punched.has(p.unit))),
      "withPrevious",
      false,
    );
    const punches = planned.filter((p) => punched.has(p.unit));
    punches.forEach((p, i) => {
      const trigger = i === 0 ? "onClick" : "withPrevious";
      if (ownClick) enter(p, trigger);
      else emphasize(p, trigger);
    });
  }

  const oneByOne = pacing === "build" || level !== "calm";
  const moving = planned.reduce((n, p) => n + (oneByOne ? (p.unit.items?.length ?? 1) : 1), 0);
  if (planned.length === 0) notes.push("Nothing on this slide animates at this level.");
  if (flattened.size > 0) {
    notes.push(
      `${[...flattened].map((id) => `"${id}"`).join(", ")} zoom in instead of flipping: a flip turns in 3D, which needs a perspective on its frame. Give the slide (or that frame) "perspective": 1200 and animate again to flip.`,
    );
  }
  return { animations: out, level, moving, notes };
}

/** The entrance a unit plays at a level: a card or list can't count up, its items can. */
function entranceFor(unit: ChoreographyUnit, level: MotionLevel): Move {
  const move = ENTRANCES[level][unit.role];
  if (move.effect !== "count-up") return move;
  const texts = unit.items
    ? unit.items.every((i) => i.kind === "element" && i.type === "text")
    : unit.node.kind === "element";
  return texts ? move : CARD_NUMBER[level];
}

/**
 * The ops that give a slide `animations` in place of its own: one transaction, so
 * "Animate this slide" is one undo step and every animation it wrote stays editable.
 */
export function replaceAnimationsOps(slide: Slide, animations: readonly Animation[]): Op[] {
  return [
    ...(slide.animations ?? []).map((a): Op => ({ op: "animation.remove", id: a.id })),
    ...animations.map(
      (animation): Op => ({ op: "animation.insert", slideId: slide.id, animation }),
    ),
  ];
}

/** One slide's share of a whole deck animated at once. */
export interface SlideChoreography {
  slideId: string;
  /** Left as it was: it already had animations and `keepAnimated` was on. */
  kept: boolean;
  moving: number;
  notes: string[];
}

/**
 * "Animate whole deck": every slide choreographed with the same pacing, each at its own
 * level, as one transaction (one undo step). `keepAnimated` leaves slides that already have
 * animations as they are, so hand-tuned slides survive. Nothing is punched by name: each
 * slide's main point is its own.
 */
export function choreographDeck(
  deck: Deck,
  intent: Pick<ChoreographyIntent, "pacing"> & { keepAnimated?: boolean } = {},
  options: ChoreographyOptions = {},
): { ops: Op[]; slides: SlideChoreography[] } {
  const ops: Op[] = [];
  const slides = deck.slides.map((slide): SlideChoreography => {
    if (intent.keepAnimated && (slide.animations?.length ?? 0) > 0) {
      return { slideId: slide.id, kept: true, moving: 0, notes: [] };
    }
    const result = choreograph(deck, slide, { pacing: intent.pacing }, options);
    ops.push(...replaceAnimationsOps(slide, result.animations));
    return { slideId: slide.id, kept: false, moving: result.moving, notes: result.notes };
  });
  return { ops, slides };
}
