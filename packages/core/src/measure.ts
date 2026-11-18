/**
 * Layout measurements and color math.
 *
 * The renderer measures a slide in a real browser and reports what it saw in these shapes
 * (bounds in stage pixels, overflow, the colors text is actually drawn in). `lintDeck` turns
 * them into issues an agent can fix. Everything here is plain data, so measurements can cross
 * process boundaries (render worker → doc-server → MCP) as JSON.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One distinct way text is drawn inside an element (an element may mix several). */
export interface TextSample {
  /** CSS color of the text, e.g. `"rgb(17, 19, 24)"`. */
  color: string;
  /** Effective opaque background behind it; `null` when it's an image/gradient (not checkable). */
  background: string | null;
  /** Font size in stage pixels. */
  fontSize: number;
  fontWeight: number;
}

export interface NodeMeasurement {
  /** Bounding box in stage pixels (includes rotation, so it's the box the node visually covers). */
  bounds: Rect;
  /** How many pixels the content spills past the box on each axis, when it does. */
  overflow?: { x: number; y: number };
  /** For elements that draw text. */
  text?: TextSample[];
}

export interface SlideMeasurement {
  slideId: string;
  stage: { width: number; height: number };
  /** Keyed by node ID. Hidden nodes are absent. */
  nodes: Record<string, NodeMeasurement>;
}

// ── Color math (WCAG 2.x) ─────────────────────────────────────────────────────────────

/** sRGB channels 0–255 and alpha 0–1. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN = /^rgba?\(\s*([^)]*)\)$/i;

/**
 * Parse the color formats browsers report from `getComputedStyle` and themes use:
 * `#rgb[a]`, `#rrggbb[aa]`, `rgb(r, g, b)`, `rgba(r, g, b, a)`, `rgb(r g b / a)`, `transparent`.
 * Returns `null` for anything else (named colors, `color(…)`, gradients).
 */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim();
  if (text.toLowerCase() === "transparent") return [0, 0, 0, 0];
  const hex = HEX.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  const args = RGB_FN.exec(text)?.[1];
  if (args === undefined) return null;
  const parts = args.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const channel = (s: string) =>
    s.endsWith("%") ? (Number.parseFloat(s) / 100) * 255 : Number.parseFloat(s);
  const alpha = (s: string | undefined) =>
    s === undefined ? 1 : s.endsWith("%") ? Number.parseFloat(s) / 100 : Number.parseFloat(s);
  const rgba = [channel(parts[0] ?? ""), channel(parts[1] ?? ""), channel(parts[2] ?? "")];
  const a = alpha(parts[3]);
  if (![...rgba, a].every(Number.isFinite)) return null;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return [
    clamp(rgba[0] ?? 0, 255),
    clamp(rgba[1] ?? 0, 255),
    clamp(rgba[2] ?? 0, 255),
    clamp(a, 1),
  ];
}

/** Paint `top` over `bottom` (source-over). */
export function compositeOver(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3] + bottom[3] * (1 - top[3]);
  if (a === 0) return [0, 0, 0, 0];
  const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
  return [mix(0), mix(1), mix(2), a];
}

/**
 * Flatten background layers, nearest first (element, its parent, …, the slide), into the
 * color you'd actually see. Layers below the first opaque one don't matter.
 */
export function flattenLayers(layers: readonly Rgba[], base: Rgba = [255, 255, 255, 1]): Rgba {
  let color = base;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer) color = compositeOver(layer, color);
  }
  return color;
}

export function toRgbString([r, g, b, a]: Rgba): string {
  const round = (v: number) => Math.round(v);
  return a >= 1
    ? `rgb(${round(r)}, ${round(g)}, ${round(b)})`
    : `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${Number(a.toFixed(3))})`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: Rgba): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two opaque colors: 1 (none) to 21 (black on white). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}
