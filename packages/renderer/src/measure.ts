/**
 * Measure a rendered slide: bounds, overflow and the colors text is drawn in, in stage pixels.
 *
 * Overflow is measured geometrically (content rects vs the box), not with `scrollHeight`:
 * centered content (a slide root with `justify: center`, a text box with
 * `verticalAlign: middle`) spills out of both ends, and `scrollHeight` only sees the bottom.
 */
import {
  compositeOver,
  contrastRatio,
  flattenLayers,
  type NodeMeasurement,
  parseCssColor,
  type Rect,
  type Rgba,
  type SlideMeasurement,
  type TextSample,
  toRgbString,
} from "@veloce/core";
import { type Area, parseGradient, rangesUnder, samplesIn } from "./gradient-sample.js";

const MAX_TEXT_SAMPLES = 12;

export function measureSlide(
  stage: HTMLElement,
  slideId: string,
  elements: ReadonlyMap<string, HTMLElement>,
): SlideMeasurement {
  const width = stage.offsetWidth;
  const height = stage.offsetHeight;
  const stageRect = stage.getBoundingClientRect();
  // The stage may be CSS-scaled to fit the window; report everything in unscaled stage pixels.
  const scale = width > 0 && stageRect.width > 0 ? stageRect.width / width : 1;
  const toStage = (r: DOMRect | Rect): Rect => ({
    x: round((("left" in r ? r.left : r.x) - stageRect.left) / scale),
    y: round((("top" in r ? r.top : r.y) - stageRect.top) / scale),
    width: round(r.width / scale),
    height: round(r.height / scale),
  });
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let s = styles.get(el);
    if (!s) {
      s = el.ownerDocument.defaultView?.getComputedStyle(el) ?? (el as HTMLElement).style;
      styles.set(el, s);
    }
    return s;
  };

  const nodes: Record<string, NodeMeasurement> = {};
  for (const [id, el] of elements) {
    if (el.getClientRects().length === 0) continue; // display: none (hidden, or in a hidden frame)
    const box = el.getBoundingClientRect();
    const m: NodeMeasurement = { bounds: toStage(box) };
    const isFrame = el.classList.contains("v-frame");
    const clipped = style(el).overflow === "hidden";
    const content = isFrame ? childRects(el, style) : contentRects(el, style);
    const overflow = clipped ? null : overflowOf(box, content, scale);
    if (overflow) m.overflow = overflow;
    if (!isFrame) {
      const text = textSamples(el, stage, style);
      if (text.length) m.text = text;
    }
    nodes[id] = m;
  }
  return { slideId, stage: { width, height }, nodes };
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Rects of a frame's flow children (their own overflow is reported on them). Free layers
 * (absolutely positioned) don't count: they're placed on purpose, and a sticker hanging past
 * its card's corner is a design, not a frame too small for its content. Leaving the slide
 * is still caught, by lint's off-canvas rule.
 */
function childRects(el: HTMLElement, style: (el: Element) => CSSStyleDeclaration): DOMRect[] {
  return [...el.children].flatMap((c) =>
    c.getClientRects().length && style(c).position !== "absolute"
      ? [c.getBoundingClientRect()]
      : [],
  );
}

/** Words measured per element; beyond this, text is far past any lint word limit anyway. */
const MAX_WORDS = 2000;

/** Edges of something drawn, in viewport pixels. */
interface Extent {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Extents of everything an element draws. Vertical extents come from block-level boxes only:
 * text ranges and inline boxes cover the font's full ascent+descent, which is taller than the
 * line box whenever line-height < ~1.2 (normal for headings), and would read as overflow.
 * Words still count horizontally (e.g. a long unbreakable word), but whitespace never does:
 * the space at a soft wrap "hangs" past the line end and would read as a few px too wide.
 */
function contentRects(el: HTMLElement, style: (el: Element) => CSSStyleDeclaration): Extent[] {
  const box = el.getBoundingClientRect();
  const horizontalOnly = (r: DOMRect): Extent => ({
    left: r.left,
    right: r.right,
    top: box.top,
    bottom: box.top,
  });
  const rects: Extent[] = [];
  for (const child of el.querySelectorAll("*")) {
    // Inline boxes include hanging spaces; their text is measured word by word below.
    if (style(child).display === "inline") continue;
    const r = child.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) rects.push(r);
  }
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  let words = 0;
  for (let n = walker.nextNode(); n && words < MAX_WORDS; n = walker.nextNode()) {
    for (const word of n.nodeValue?.matchAll(/\S+/g) ?? []) {
      if (++words > MAX_WORDS) break;
      range.setStart(n, word.index);
      range.setEnd(n, word.index + word[0].length);
      const r = range.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) rects.push(horizontalOnly(r));
    }
  }
  return rects;
}

function overflowOf(box: DOMRect, rects: Extent[], scale: number): { x: number; y: number } | null {
  if (rects.length === 0) return null;
  let [left, top, right, bottom] = [box.left, box.top, box.right, box.bottom];
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  const x = (box.left - left + (right - box.right)) / scale;
  const y = (box.top - top + (bottom - box.bottom)) / scale;
  return x > 0.5 || y > 0.5 ? { x: round(x), y: round(y) } : null;
}

/** Distinct (color, background, size, weight) combinations of the text inside `el`. */
function textSamples(
  el: HTMLElement,
  stage: HTMLElement,
  style: (el: Element) => CSSStyleDeclaration,
): TextSample[] {
  const samples = new Map<string, TextSample>();
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const range = el.ownerDocument.createRange();
  for (let n = walker.nextNode(); n && samples.size < MAX_TEXT_SAMPLES; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || !n.nodeValue?.trim()) continue;
    const s = style(parent);
    // Where this text is actually drawn: gradients are sampled under it, not everywhere.
    range.selectNodeContents(n);
    const drawn = range.getBoundingClientRect();
    const behind = backgroundsBehind(parent, stage, style, drawn);
    const sample: TextSample = {
      color: s.color,
      background: worstBackground(s.color, behind?.colors ?? null),
      ...(behind?.gradient && { gradient: true }),
      fontSize: Number.parseFloat(s.fontSize) || 0,
      fontWeight: fontWeight(s.fontWeight),
    };
    const key = `${sample.color}|${sample.background}|${sample.gradient}|${sample.fontSize}|${sample.fontWeight}`;
    if (!samples.has(key)) samples.set(key, sample);
  }
  return [...samples.values()];
}

/** Most background combinations to consider per text run (gradients multiply them). */
const MAX_BACKGROUNDS = 48;

/**
 * Every opaque color that can sit behind text drawn at `drawn`: each background down to the
 * stage, composited. Gradients contribute the stretch under the text (`gradient-sample.ts`).
 * `gradient` says whether one took part. `null` when an image is involved: contrast can't be
 * computed.
 */
function backgroundsBehind(
  from: Element,
  stage: HTMLElement,
  style: (el: Element) => CSSStyleDeclaration,
  drawn: DOMRect,
): { colors: Rgba[]; gradient: boolean } | null {
  const opaque = (stack: readonly Rgba[]) => stack.some((c) => c[3] >= 1);
  let stacks: Rgba[][] = [[]]; // each stack lists layers top-first
  let gradient = false;
  for (let el: Element | null = from; el; el = el === stage ? null : el.parentElement) {
    const s = style(el);
    const base = parseCssColor(s.backgroundColor || "transparent");
    if (!base) return null;
    const options = layerOptions(s.backgroundImage, base, el, s, drawn);
    if (!options) return null;
    if (s.backgroundImage && s.backgroundImage !== "none") gradient = true;
    stacks = stacks
      .flatMap((stack) => (opaque(stack) ? [stack] : options.map((o) => [...stack, ...o])))
      .slice(0, MAX_BACKGROUNDS);
    if (stacks.every(opaque)) break;
  }
  return { colors: stacks.map((stack) => flattenLayers(stack.filter((c) => c[3] > 0))), gradient };
}

/**
 * One element's possible paint (top-first layers): the gradient colors under the text over
 * its background color. A turned (rotated) box is sampled whole: its gradient runs in its
 * own frame, which the upright rects here don't describe.
 */
function layerOptions(
  image: string,
  base: Rgba,
  el: Element,
  s: CSSStyleDeclaration,
  drawn: DOMRect,
): Rgba[][] | null {
  if (!image || image === "none") return [[base]];
  if (/url\(/i.test(image)) return null;
  const gradient = parseGradient(image);
  if (!gradient) return null;
  const box = el.getBoundingClientRect();
  const upright = isUpright(s.transform);
  const scale = el instanceof HTMLElement && el.offsetWidth > 0 ? box.width / el.offsetWidth : 1;
  const area: Area = {
    left: (drawn.left - box.left) / scale,
    top: (drawn.top - box.top) / scale,
    right: (drawn.right - box.left) / scale,
    bottom: (drawn.bottom - box.top) / scale,
  };
  const width = box.width / scale;
  const height = box.height / scale;
  const usable = upright && drawn.width > 0 && width > 0 && height > 0;
  const ranges = usable ? rangesUnder(gradient, width, height, area) : [[0, 1] as [number, number]];
  return samplesIn(gradient, ranges).map((sample) => [sample, base]);
}

/** The candidate background with the lowest contrast against this text color. */
function worstBackground(color: string, backgrounds: Rgba[] | null): string | null {
  const fg = parseCssColor(color);
  if (!fg || !backgrounds?.length) return null;
  let worst: { ratio: number; bg: Rgba } | null = null;
  for (const bg of backgrounds) {
    const ratio = contrastRatio(compositeOver(fg, bg), bg);
    if (!worst || ratio < worst.ratio) worst = { ratio, bg };
  }
  return worst ? toRgbString(worst.bg) : null;
}

/** No transform, or only moved/scaled (the stage fitted to the window): not rotated. */
function isUpright(transform: string): boolean {
  if (!transform || transform === "none") return true;
  const m = /^matrix\(([^)]*)\)$/.exec(transform);
  if (!m) return false;
  const [, b, c] = (m[1] ?? "").split(",").map(Number);
  return b === 0 && c === 0;
}

function fontWeight(value: string): number {
  if (value === "bold") return 700;
  if (value === "normal" || value === "") return 400;
  return Number.parseInt(value, 10) || 400;
}
