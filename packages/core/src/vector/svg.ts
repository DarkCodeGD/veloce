/**
 * SVG import (D127 §4): an SVG file becomes `vector` layers, never inlined SVG. Only what
 * draws is read: shapes (`path`, `rect`, `circle`, `ellipse`, `line`, `polyline`,
 * `polygon`), groups and their transforms, fills (colors, linear and radial gradients),
 * strokes, opacity and the viewBox. Everything else (scripts, styles, links, images, text,
 * `use`, foreign content, filters, masks, event handlers) is left out, and the result says
 * what, so a person or an agent knows what's missing.
 *
 * The XML comes through core's own strict reader (`xml.ts`: no DOCTYPE, no entities), and
 * every path goes through the strict path parser and is written back out by us, so what
 * reaches the document is validated path data and plain colors, whatever the file held.
 *
 * Shapes in a row with the same look merge into one layer (an outline icon is one vector,
 * not five). One layer imports as a `vector`; several as a Free frame of them.
 */
import { createId } from "../ids.js";
import { parseCssColor } from "../measure.js";
import type { ElementNode, FrameNode } from "../schema/node.js";
import type { Paint, Stroke } from "../schema/paint.js";
import type { Color } from "../schema/primitives.js";
import {
  type Bounds,
  formatPathData,
  MAX_PATH_COMMANDS,
  MAX_PATH_LENGTH,
  type PathSegment,
  parsePathData,
  pathBounds,
} from "./path-data.js";
import { type Affine, compose, IDENTITY, transformPath } from "./transform.js";
import { localName, parseXml, type XmlElement } from "./xml.js";

export interface SvgImportOptions {
  /** The size to import at, in pixels; the drawing keeps its proportions inside it. */
  width?: number;
  height?: number;
  /** What `currentColor` becomes. Default `"$color.text"`, so icons follow the theme. */
  currentColor?: Color;
  /** The layer's name. Default: the SVG's `<title>`, else "SVG". */
  name?: string;
}

export type SvgImport =
  | {
      ok: true;
      /** A `vector`, or a Free frame of them. */
      node: ElementNode | FrameNode;
      /** What was left out, in words ("2 <text> elements (add text as text layers)"). */
      leftOut: string[];
    }
  | { ok: false; message: string; leftOut: string[] };

/** Whether pasted or sent text is an SVG (and not, say, HTML that mentions one). */
export function looksLikeSvg(text: string): boolean {
  const start = text.trimStart().slice(0, 2000);
  return /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(start);
}

// ── What's left out ─────────────────────────────────────────────────────────────────────

const REASONS: Record<string, string> = {
  script: "scripts never run in a deck",
  style: "style sheets (only inline styles are read)",
  text: "add text as text layers",
  image: "add images as image layers",
  use: "references to other shapes",
  foreignObject: "embedded web content",
  a: "links (their shapes are kept)",
  filter: "filters",
  mask: "masks",
  clipPath: "clip paths",
  pattern: "pattern fills",
  marker: "line markers",
  animate: "SVG animations (animate in Veloce instead)",
};

class LeftOut {
  private counts = new Map<string, number>();
  add(what: string) {
    this.counts.set(what, (this.counts.get(what) ?? 0) + 1);
  }
  list(): string[] {
    return [...this.counts].map(([what, n]) => (n > 1 ? `${what} (×${n})` : what));
  }
}

const describeElement = (name: string) => {
  const reason = REASONS[name];
  return reason ? `<${name}>: ${reason}` : `<${name}>`;
};

// ── Styles ──────────────────────────────────────────────────────────────────────────────

type PaintRef =
  | { kind: "none" }
  | { kind: "color"; rgba: [number, number, number, number] }
  | { kind: "current" }
  | { kind: "url"; id: string; fallback?: PaintRef };

interface Style {
  fill: PaintRef;
  fillOpacity: number;
  fillRule: "nonzero" | "evenodd";
  stroke: PaintRef;
  strokeOpacity: number;
  strokeWidth: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  dashed: boolean;
  /** Group opacity, multiplied down the tree. */
  opacity: number;
  /** `visibility: hidden`, inherited (a child can set it back to visible). */
  hidden: boolean;
}

/** SVG's own defaults (not Veloce's: a path with no fill set is black, its stroke none). */
const ROOT_STYLE: Style = {
  fill: { kind: "color", rgba: [0, 0, 0, 1] },
  fillOpacity: 1,
  fillRule: "nonzero",
  stroke: { kind: "none" },
  strokeOpacity: 1,
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
  dashed: false,
  opacity: 1,
  hidden: false,
};

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  lime: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  navy: "#000080",
  purple: "#800080",
  teal: "#008080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  gold: "#ffd700",
  brown: "#a52a2a",
};

function parsePaint(value: string, leftOut: LeftOut): PaintRef | null {
  const v = value.trim();
  const lower = v.toLowerCase();
  if (lower === "none" || lower === "transparent") return { kind: "none" };
  if (lower === "currentcolor") return { kind: "current" };
  const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/i.exec(v);
  if (url) {
    const fallback = url[2] ? parsePaint(url[2], leftOut) : null;
    return { kind: "url", id: url[1] ?? "", ...(fallback && { fallback }) };
  }
  const rgba = parseCssColor(NAMED[lower] ?? v);
  if (rgba) return { kind: "color", rgba: [...rgba] };
  leftOut.add(`the color "${v.slice(0, 40)}" (drawn black)`);
  return { kind: "color", rgba: [0, 0, 0, 1] };
}

const number = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(px)?\s*$/.exec(v);
  return m ? Number(m[1]) : null;
};
const fraction = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const pct = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))%\s*$/.exec(v);
  return pct ? Number(pct[1]) / 100 : number(v);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Presentation attributes, overridden by the `style` attribute's declarations. */
function properties(el: XmlElement): Map<string, string> {
  const props = new Map<string, string>();
  for (const [k, v] of el.attrs) props.set(k, v);
  const style = el.attrs.get("style");
  if (style) {
    for (const decl of style.split(";")) {
      const colon = decl.indexOf(":");
      if (colon < 0) continue;
      const key = decl.slice(0, colon).trim().toLowerCase();
      const value = decl
        .slice(colon + 1)
        .replace(/!important/i, "")
        .trim();
      if (key) props.set(key, value);
    }
  }
  return props;
}

function inherit(parent: Style, el: XmlElement, leftOut: LeftOut): Style {
  const p = properties(el);
  const s: Style = { ...parent, opacity: parent.opacity };
  const fill = p.get("fill");
  if (fill !== undefined && fill !== "inherit") s.fill = parsePaint(fill, leftOut) ?? s.fill;
  const stroke = p.get("stroke");
  if (stroke !== undefined && stroke !== "inherit") {
    s.stroke = parsePaint(stroke, leftOut) ?? s.stroke;
  }
  const fo = fraction(p.get("fill-opacity"));
  if (fo !== null) s.fillOpacity = clamp01(fo);
  const so = fraction(p.get("stroke-opacity"));
  if (so !== null) s.strokeOpacity = clamp01(so);
  const o = fraction(p.get("opacity"));
  if (o !== null) s.opacity = parent.opacity * clamp01(o);
  const sw = number(p.get("stroke-width"));
  if (sw !== null && sw >= 0) s.strokeWidth = sw;
  const rule = p.get("fill-rule");
  if (rule === "evenodd" || rule === "nonzero") s.fillRule = rule;
  const cap = p.get("stroke-linecap");
  if (cap === "butt" || cap === "round" || cap === "square") s.cap = cap;
  const join = p.get("stroke-linejoin");
  if (join === "miter" || join === "round" || join === "bevel") s.join = join;
  else if (join === "miter-clip" || join === "arcs") s.join = "miter";
  const dash = p.get("stroke-dasharray");
  if (dash !== undefined) s.dashed = dash.trim() !== "none" && dash.trim() !== "";
  const visibility = p.get("visibility");
  if (visibility === "hidden" || visibility === "collapse") s.hidden = true;
  else if (visibility === "visible") s.hidden = false;
  for (const attr of ["filter", "mask", "clip-path"]) {
    const v = p.get(attr);
    if (v && v !== "none") leftOut.add(REASONS[attr === "clip-path" ? "clipPath" : attr] ?? attr);
  }
  for (const attr of ["marker-start", "marker-mid", "marker-end", "marker"]) {
    const v = p.get(attr);
    if (v && v !== "none") leftOut.add(REASONS.marker ?? attr);
  }
  return s;
}

// ── Transforms ──────────────────────────────────────────────────────────────────────────

const deg = (a: number) => (a * Math.PI) / 180;

/** An SVG `transform` list, or null if it can't be read. */
function parseTransform(value: string): Affine | null {
  let m: Affine = IDENTITY;
  const re = /\s*([a-zA-Z]+)\s*\(([^)]*)\)\s*,?/y;
  let i = 0;
  const text = value.trim();
  while (i < text.length) {
    re.lastIndex = i;
    const match = re.exec(text);
    if (!match) return null;
    i = re.lastIndex;
    const args = (match[2] ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (!args.every(Number.isFinite)) return null;
    const [a = 0, b, c, d, e, f] = args;
    let t: Affine;
    switch (match[1]) {
      case "matrix":
        if (args.length !== 6) return null;
        t = [a, b ?? 0, c ?? 0, d ?? 0, e ?? 0, f ?? 0];
        break;
      case "translate":
        t = [1, 0, 0, 1, a, b ?? 0];
        break;
      case "scale":
        t = [a, 0, 0, b ?? a, 0, 0];
        break;
      case "rotate": {
        const cos = Math.cos(deg(a));
        const sin = Math.sin(deg(a));
        const r: Affine = [cos, sin, -sin, cos, 0, 0];
        const cx = b ?? 0;
        const cy = c ?? 0;
        t = compose([1, 0, 0, 1, cx, cy], compose(r, [1, 0, 0, 1, -cx, -cy]));
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(deg(a)), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(deg(a)), 0, 1, 0, 0];
        break;
      default:
        return null;
    }
    m = compose(m, t);
  }
  return m;
}

// ── Shapes ──────────────────────────────────────────────────────────────────────────────

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const GROUPS = new Set(["g", "svg", "a", "switch"]);
/** Never drawn on their own, and fine to skip quietly. */
const QUIET = new Set([
  "title",
  "desc",
  "metadata",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "symbol",
]);

function points(value: string | undefined): [number, number][] | null {
  if (!value) return null;
  const nums = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (nums.length < 4 || !nums.every(Number.isFinite)) return null;
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < nums.length; k += 2) out.push([nums[k] ?? 0, nums[k + 1] ?? 0]);
  return out;
}

/** A shape's outline in its own coordinates, or a reason it can't be read. */
function shapeSegments(name: string, el: XmlElement): PathSegment[] | string {
  const a = (k: string) => number(el.attrs.get(k));
  const lengths = (...keys: string[]) => {
    const values = keys.map((k) => a(k) ?? (el.attrs.has(k) ? Number.NaN : 0));
    return values.some(Number.isNaN) ? null : values;
  };
  const relative = `a <${name}> sized in % or other units (only plain numbers and px)`;
  switch (name) {
    case "path": {
      const d = el.attrs.get("d");
      if (!d) return [];
      const parsed = parsePathData(d);
      return parsed.ok ? parsed.segments : `a <path> with bad path data (${parsed.message})`;
    }
    case "rect": {
      const v = lengths("x", "y", "width", "height");
      if (!v) return relative;
      const [x = 0, y = 0, w = 0, h = 0] = v;
      if (w <= 0 || h <= 0) return [];
      let rx = a("rx");
      let ry = a("ry");
      rx ??= ry ?? 0;
      ry ??= rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (rx === 0 || ry === 0) {
        return [
          { type: "M", x, y },
          { type: "L", x: x + w, y },
          { type: "L", x: x + w, y: y + h },
          { type: "L", x, y: y + h },
          { type: "Z" },
        ];
      }
      const arc = (ex: number, ey: number): PathSegment => ({
        type: "A",
        rx: rx ?? 0,
        ry: ry ?? 0,
        rotation: 0,
        largeArc: false,
        sweep: true,
        x: ex,
        y: ey,
      });
      return [
        { type: "M", x: x + rx, y },
        { type: "L", x: x + w - rx, y },
        arc(x + w, y + ry),
        { type: "L", x: x + w, y: y + h - ry },
        arc(x + w - rx, y + h),
        { type: "L", x: x + rx, y: y + h },
        arc(x, y + h - ry),
        { type: "L", x, y: y + ry },
        arc(x + rx, y),
        { type: "Z" },
      ];
    }
    case "circle":
    case "ellipse": {
      const v = name === "circle" ? lengths("cx", "cy", "r") : lengths("cx", "cy", "rx", "ry");
      if (!v) return relative;
      const [cx = 0, cy = 0, r1 = 0, r2 = r1] = v;
      if (r1 <= 0 || r2 <= 0) return [];
      const half = (x: number): PathSegment => ({
        type: "A",
        rx: r1,
        ry: r2,
        rotation: 0,
        largeArc: false,
        sweep: true,
        x,
        y: cy,
      });
      return [{ type: "M", x: cx - r1, y: cy }, half(cx + r1), half(cx - r1), { type: "Z" }];
    }
    case "line": {
      const v = lengths("x1", "y1", "x2", "y2");
      if (!v) return relative;
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = v;
      return [
        { type: "M", x: x1, y: y1 },
        { type: "L", x: x2, y: y2 },
      ];
    }
    default: {
      // polyline, polygon
      const pts = points(el.attrs.get("points"));
      if (!pts) return [];
      const segs: PathSegment[] = pts.map(([x, y], k) => ({ type: k === 0 ? "M" : "L", x, y }));
      if (name === "polygon") segs.push({ type: "Z" });
      return segs;
    }
  }
}

// ── Gradients ───────────────────────────────────────────────────────────────────────────

interface GradientStop {
  offset: number;
  rgba: [number, number, number, number];
}

function collectGradients(root: XmlElement): Map<string, XmlElement> {
  const out = new Map<string, XmlElement>();
  const visit = (el: XmlElement) => {
    const name = localName(el.name);
    const id = el.attrs.get("id");
    if (id && (name === "linearGradient" || name === "radialGradient") && !out.has(id)) {
      out.set(id, el);
    }
    for (const child of el.children) visit(child);
  };
  visit(root);
  return out;
}

/** A gradient's own stops, or (once) those of the gradient its `href` points at. */
function stopsOf(
  el: XmlElement,
  gradients: Map<string, XmlElement>,
  leftOut: LeftOut,
): GradientStop[] {
  const own = el.children.filter((c) => localName(c.name) === "stop");
  let source = own;
  if (own.length === 0) {
    const href = (el.attrs.get("href") ?? el.attrs.get("xlink:href") ?? "").trim();
    const target = href.startsWith("#") ? gradients.get(href.slice(1)) : undefined;
    if (target) source = target.children.filter((c) => localName(c.name) === "stop");
  }
  let last = 0;
  return source.map((stop) => {
    const p = properties(stop);
    const offset = Math.max(last, clamp01(fraction(p.get("offset")) ?? 0));
    last = offset;
    const color = parsePaint(p.get("stop-color") ?? "black", leftOut);
    const rgba: [number, number, number, number] =
      color?.kind === "color" ? [...color.rgba] : [0, 0, 0, 1];
    rgba[3] *= clamp01(fraction(p.get("stop-opacity")) ?? 1);
    return { offset, rgba };
  });
}

/** A gradient attribute: its own, or the one its `href` gradient has. */
function gradientAttr(
  el: XmlElement,
  key: string,
  gradients: Map<string, XmlElement>,
): string | undefined {
  const own = el.attrs.get(key);
  if (own !== undefined) return own;
  const href = (el.attrs.get("href") ?? el.attrs.get("xlink:href") ?? "").trim();
  return href.startsWith("#") ? gradients.get(href.slice(1))?.attrs.get(key) : undefined;
}

// ── Colors out ──────────────────────────────────────────────────────────────────────────

const hex2 = (v: number) =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, "0");

function toColor(rgba: readonly number[], opacity: number): Color {
  const [r = 0, g = 0, b = 0, a = 1] = rgba;
  const alpha = clamp01(a * opacity);
  return alpha >= 1
    ? `#${hex2(r)}${hex2(g)}${hex2(b)}`
    : `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(alpha * 255)}`;
}

function currentColorAt(base: Color, opacity: number): Color {
  if (opacity >= 1) return base;
  if (base.startsWith("$color.") && !base.includes("/")) {
    return `${base}/${Math.round(opacity * 100)}` as Color;
  }
  const rgba = parseCssColor(base);
  return rgba ? toColor(rgba, opacity) : base;
}

// ── The import ──────────────────────────────────────────────────────────────────────────

interface Piece {
  segments: PathSegment[];
  fill: Paint | null;
  stroke: Stroke | null;
  /** Stroke width in the SVG's root units, for the layer's bounds. */
  strokeRoot: number;
  fillRule: "nonzero" | "evenodd";
  cap: Style["cap"];
  join: Style["join"];
  /** Pieces with the same key look the same and may share a layer. */
  key: string;
}

export function importSvg(text: string, options: SvgImportOptions = {}): SvgImport {
  const leftOut = new LeftOut();
  const xml = parseXml(text);
  if (!xml.ok) {
    return {
      ok: false,
      message: `Not a readable SVG: ${xml.message} (at character ${xml.at})`,
      leftOut: [],
    };
  }
  const root = xml.root;
  if (localName(root.name) !== "svg") {
    return { ok: false, message: `Expected an <svg> root, got <${root.name}>`, leftOut: [] };
  }

  const gradients = collectGradients(root);
  const currentColor = options.currentColor ?? "$color.text";
  const pieces: Piece[] = [];

  const paintOf = (
    ref: PaintRef,
    opacity: number,
    local: PathSegment[],
    forStroke: boolean,
  ): Paint | null => {
    switch (ref.kind) {
      case "none":
        return null;
      case "current":
        return currentColorAt(currentColor, opacity);
      case "color":
        return toColor(ref.rgba, opacity);
      case "url": {
        const el = gradients.get(ref.id);
        if (!el) {
          if (ref.fallback) return paintOf(ref.fallback, opacity, local, forStroke);
          leftOut.add("fills that point at missing or unsupported paint (pattern fills)");
          return null;
        }
        const stops = stopsOf(el, gradients, leftOut);
        if (stops.length === 0) return null;
        const solid = (stop: GradientStop) => toColor(stop.rgba, opacity);
        if (forStroke) {
          leftOut.add("gradient strokes (drawn in their first color)");
          return solid(stops[0] as GradientStop);
        }
        if (stops.length === 1) return solid(stops[0] as GradientStop);
        return gradientPaint(el, stops, opacity, local);
      }
    }
  };

  const gradientPaint = (
    el: XmlElement,
    stops: GradientStop[],
    opacity: number,
    local: PathSegment[],
  ): Paint | null => {
    const kept = stops.length > 16 ? thin(stops, 16) : stops;
    const ourStops = kept.map((s) => ({ offset: s.offset, color: toColor(s.rgba, opacity) }));
    const attr = (k: string) => gradientAttr(el, k, gradients);
    if (attr("gradientTransform")) leftOut.add("gradient transforms (drawn untransformed)");
    // Gradient coordinates → fractions of the shape's box, the way our paint measures.
    const userSpace = attr("gradientUnits") === "userSpaceOnUse";
    const box = pathBounds(local) ?? { x: 0, y: 0, width: 1, height: 1 };
    const fx = (v: number) => (userSpace ? (v - box.x) / (box.width || 1) : v);
    const fy = (v: number) => (userSpace ? (v - box.y) / (box.height || 1) : v);
    const read = (k: string, fallback: number) => fraction(attr(k)) ?? fallback;
    if (localName(el.name) === "radialGradient") {
      const cx = fx(read("cx", userSpace ? box.x + box.width / 2 : 0.5));
      const cy = fy(read("cy", userSpace ? box.y + box.height / 2 : 0.5));
      const r = read("r", userSpace ? Math.max(box.width, box.height) / 2 : 0.5);
      const rx = userSpace ? r / (box.width || 1) : r;
      const ry = userSpace ? r / (box.height || 1) : r;
      return {
        type: "radial-gradient",
        center: { x: round(cx, 4), y: round(cy, 4) },
        ...(rx > 0 && ry > 0 && rx <= 10 && ry <= 10
          ? { radius: { x: round(rx, 4), y: round(ry, 4) } }
          : {}),
        stops: ourStops,
      };
    }
    const x1 = fx(read("x1", userSpace ? box.x : 0));
    const y1 = fy(read("y1", userSpace ? box.y : 0));
    const x2 = fx(read("x2", userSpace ? box.x + box.width : 1));
    const y2 = fy(read("y2", userSpace ? box.y : 0));
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.hypot(dx, dy) < 1e-9) return toColor(kept.at(-1)?.rgba ?? [0, 0, 0, 1], opacity);
    // CSS angle: 0 = towards the top, 90 = right.
    const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    // Where (x1, y1) and (x2, y2) fall on CSS's gradient line through the box's center.
    const ux = Math.sin(deg(angle));
    const uy = -Math.cos(deg(angle));
    const length = Math.abs(ux) + Math.abs(uy);
    const along = (x: number, y: number) => ((x - 0.5) * ux + (y - 0.5) * uy) / length + 0.5;
    const start = round(along(x1, y1), 4);
    const end = round(along(x2, y2), 4);
    const inRange = (v: number) => v >= -10 && v <= 10;
    return {
      type: "linear-gradient",
      angle: round(angle, 2),
      ...(start !== 0 && inRange(start) ? { start } : {}),
      ...(end !== 1 && inRange(end) ? { end } : {}),
      stops: ourStops,
    };
  };

  const visit = (el: XmlElement, style: Style, ctm: Affine) => {
    const raw = el.name;
    const prefix = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : null;
    if (prefix && prefix !== "svg") return; // an editor's own data (Inkscape, Sodipodi)
    const name = localName(raw);
    if (QUIET.has(name)) return;
    for (const attr of el.attrs.keys()) {
      if (/^on/i.test(attr)) leftOut.add("event handlers (onclick, onload…)");
    }
    if (!GROUPS.has(name) && !SHAPES.has(name)) {
      leftOut.add(describeElement(name));
      return;
    }
    if (name === "a") leftOut.add(describeElement("a"));
    // display: none hides the whole subtree; visibility is inherited, and a child may undo it.
    if (properties(el).get("display") === "none") return;
    const own = inherit(style, el, leftOut);
    let m = ctm;
    const transform = el.attrs.get("transform");
    if (transform) {
      const t = parseTransform(transform);
      if (!t) {
        leftOut.add(`<${name}> with a transform that can't be read`);
        return;
      }
      m = compose(m, t);
    }
    if (name === "svg" && el !== root) {
      const x = number(el.attrs.get("x")) ?? 0;
      const y = number(el.attrs.get("y")) ?? 0;
      m = compose(m, [1, 0, 0, 1, x, y]);
      if (el.attrs.has("viewBox")) leftOut.add("the viewBox of a nested <svg> (drawn unscaled)");
    }
    if (GROUPS.has(name)) {
      for (const child of el.children) visit(child, own, m);
      return;
    }
    if (own.hidden) return;
    const local = shapeSegments(name, el);
    if (typeof local === "string") {
      leftOut.add(local);
      return;
    }
    if (local.length === 0) return;
    const fill =
      name === "line" ? null : paintOf(own.fill, own.fillOpacity * own.opacity, local, false);
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const strokeRoot = own.strokeWidth * scale;
    const strokeColor =
      own.stroke.kind === "none" || own.strokeWidth <= 0
        ? null
        : paintOf(own.stroke, own.strokeOpacity * own.opacity, local, true);
    const stroke: Stroke | null =
      typeof strokeColor === "string"
        ? {
            color: strokeColor,
            width: strokeRoot, // root units for now; pixels once the size is known
            ...(own.dashed ? { style: "dashed" as const } : {}),
          }
        : null;
    if (!fill && !stroke) return; // draws nothing
    const segments = transformPath(local, m);
    const gradient = typeof fill === "object" && fill !== null;
    pieces.push({
      segments,
      fill,
      stroke,
      strokeRoot: stroke ? strokeRoot : 0,
      fillRule: own.fillRule,
      cap: own.cap,
      join: own.join,
      // A gradient spans its own shape, so it never shares a layer.
      key: gradient
        ? `gradient-${pieces.length}`
        : JSON.stringify([fill, stroke, own.fillRule, own.cap, own.join]),
    });
  };

  visit(root, ROOT_STYLE, IDENTITY);

  // The SVG's coordinate box: its viewBox, else its size, else what it draws.
  const viewBox = rootViewBox(root, pieces);
  if (pieces.length === 0 || !viewBox) {
    return {
      ok: false,
      message: "Nothing in this SVG draws a shape Veloce can import (paths and basic shapes).",
      leftOut: leftOut.list(),
    };
  }

  // The size it lands at: asked for, else its own; the proportions stay.
  let scale = 1;
  if (options.width !== undefined && options.height !== undefined) {
    scale = Math.min(options.width / viewBox.width, options.height / viewBox.height);
  } else if (options.width !== undefined) scale = options.width / viewBox.width;
  else if (options.height !== undefined) scale = options.height / viewBox.height;
  else {
    const w = number(root.attrs.get("width"));
    if (w && w > 0) scale = w / viewBox.width;
  }

  const precision = Math.min(
    6,
    Math.max(2, Math.ceil(Math.log10(1000 / Math.max(viewBox.width, viewBox.height, 1e-6)) + 2)),
  );
  const layers = mergePieces(pieces, leftOut, precision);
  const name = options.name ?? "SVG";
  const vectorProps = (layer: Piece, d: string, box: Bounds, fit?: "stretch") => {
    const props: Record<string, unknown> = {
      d,
      viewBox: {
        x: round(box.x, precision),
        y: round(box.y, precision),
        width: round(box.width, precision),
        height: round(box.height, precision),
      },
      fill: layer.fill ?? "transparent",
      ...(layer.fillRule === "evenodd" ? { fillRule: "evenodd" } : {}),
    };
    if (layer.stroke) {
      props.stroke = {
        ...layer.stroke,
        width: round(Math.max(0.1, layer.stroke.width * scale), 2),
      };
      props.cap = layer.cap;
      props.join = layer.join;
    }
    if (fit) props.fit = fit;
    return props;
  };

  const width = round(viewBox.width * scale, 2);
  const height = round(viewBox.height * scale, 2);
  const only = layers.length === 1 ? layers[0] : undefined;
  if (only) {
    const d = formatPathData(only.segments, precision);
    return {
      ok: true,
      node: {
        id: createId("nd"),
        kind: "element",
        type: "vector",
        name,
        width,
        height,
        props: vectorProps(only, d, viewBox),
      },
      leftOut: leftOut.list(),
    };
  }

  const children: ElementNode[] = layers.map((layer, k) => {
    // The layer's box: what it draws, its stroke included, at least a pixel each way.
    const bounds = pathBounds(layer.segments) ?? { x: 0, y: 0, width: 0, height: 0 };
    const pad = layer.strokeRoot / 2;
    const min = 1 / scale;
    let bw = bounds.width + 2 * pad;
    let bh = bounds.height + 2 * pad;
    let bx = bounds.x - pad;
    let by = bounds.y - pad;
    if (bw < min) {
      bx -= (min - bw) / 2;
      bw = min;
    }
    if (bh < min) {
      by -= (min - bh) / 2;
      bh = min;
    }
    // Whole hundredths of a pixel on the slide; the viewBox follows them exactly.
    const x = round((bx - viewBox.x) * scale, 2);
    const y = round((by - viewBox.y) * scale, 2);
    const w = round(bw * scale, 2);
    const h = round(bh * scale, 2);
    const box = {
      x: viewBox.x + x / scale,
      y: viewBox.y + y / scale,
      width: w / scale,
      height: h / scale,
    };
    return {
      id: createId("nd"),
      kind: "element",
      type: "vector",
      name: `Path ${k + 1}`,
      position: { x, y },
      width: w,
      height: h,
      props: vectorProps(layer, formatPathData(layer.segments, precision), box, "stretch"),
    };
  });
  return {
    ok: true,
    node: {
      id: createId("nd"),
      kind: "frame",
      name,
      layout: { mode: "absolute" },
      width,
      height,
      children,
    },
    leftOut: leftOut.list(),
  };
}

const round = (v: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/** `n` stops spread over the list, the first and last kept. */
function thin<T>(items: T[], n: number): T[] {
  return Array.from(
    { length: n },
    (_, k) => items[Math.round((k * (items.length - 1)) / (n - 1))] as T,
  );
}

function rootViewBox(root: XmlElement, pieces: Piece[]): Bounds | null {
  const vb = (root.attrs.get("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && (vb[2] ?? 0) > 0 && (vb[3] ?? 0) > 0) {
    return { x: vb[0] ?? 0, y: vb[1] ?? 0, width: vb[2] ?? 1, height: vb[3] ?? 1 };
  }
  const w = number(root.attrs.get("width"));
  const h = number(root.attrs.get("height"));
  if (w && h && w > 0 && h > 0) return { x: 0, y: 0, width: w, height: h };
  // Neither: what it draws, strokes included.
  let box: Bounds | null = null;
  for (const p of pieces) {
    const b = pathBounds(p.segments);
    if (!b) continue;
    const pad = p.strokeRoot / 2;
    const next = {
      x: b.x - pad,
      y: b.y - pad,
      width: b.width + 2 * pad,
      height: b.height + 2 * pad,
    };
    box = box ? union(box, next) : next;
  }
  return box && box.width > 0 && box.height > 0 ? box : null;
}

const union = (a: Bounds, b: Bounds): Bounds => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

/**
 * Neighbours that look the same become one layer, as long as it stays within a path's
 * limits. One shape too big for a path on its own is left out.
 */
function mergePieces(pieces: Piece[], leftOut: LeftOut, precision: number): Piece[] {
  // Each piece is measured once, at the precision it'll be written with: a formatted path is
  // its segments' text run together, so a merge's size is the sum (linear, however many).
  const out: { piece: Piece; commands: number; length: number }[] = [];
  for (const piece of pieces) {
    const commands = piece.segments.length;
    const length = formatPathData(piece.segments, precision).length;
    if (commands > MAX_PATH_COMMANDS || length > MAX_PATH_LENGTH) {
      leftOut.add(
        `a shape too detailed for one path (simplify it to under ${MAX_PATH_COMMANDS} commands)`,
      );
      continue;
    }
    const last = out.at(-1);
    if (
      last &&
      last.piece.key === piece.key &&
      last.commands + commands <= MAX_PATH_COMMANDS &&
      last.length + length <= MAX_PATH_LENGTH
    ) {
      last.piece.segments.push(...piece.segments);
      last.piece.strokeRoot = Math.max(last.piece.strokeRoot, piece.strokeRoot);
      last.commands += commands;
      last.length += length;
      continue;
    }
    out.push({ piece: { ...piece, segments: [...piece.segments] }, commands, length });
  }
  return out.map((o) => o.piece);
}
