/**
 * Which colors of a gradient are behind a piece of text, for contrast lint.
 *
 * A gradient that fades from a strong color to transparent is a strong color at one end and
 * the background at the other; text sitting at the faded end is readable even though the
 * strong end would fail. So instead of testing every stop, this works out the stretch of the
 * gradient (its `t` range, 0 = first stop, 1 = last) that the text's box covers, and samples
 * only that: linear by projecting the box's corners on the gradient line, radial by the
 * nearest and farthest points from the centre, conic by the angles the box spans.
 *
 * The geometry is parsed from the computed `background-image` (what Chromium reports for the
 * CSS the renderer writes in `cssPaint`), so tokens and opacities are already resolved.
 * Pure functions: no DOM.
 */
import { CSS_COLOR_FN, parseCssColor, type Rgba } from "@veloce/core";

export interface ParsedGradient {
  kind: "linear" | "radial" | "conic";
  /** Linear: direction in degrees (0 = towards the top). Conic: where offset 0 starts. */
  angle: number;
  /** Radial and conic centre, as fractions of the box. */
  center: { x: number; y: number };
  /** Radial: the ellipse's radii as fractions of the box, when sized (else farthest-side). */
  radius?: { x: number; y: number };
  /** Sorted by position (0–1). */
  stops: Array<{ color: Rgba; at: number }>;
}

/** Edges of an area, in pixels from the painted box's top-left corner. */
export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const DEG = Math.PI / 180;

/** One CSS gradient, as `getComputedStyle(el).backgroundImage` reports it, or null. */
export function parseGradient(css: string): ParsedGradient | null {
  const head = /^\s*(linear|radial|conic)-gradient\((.*)\)\s*$/is.exec(css);
  if (!head) return null;
  const kind = head[1]?.toLowerCase() as ParsedGradient["kind"];
  const body = head[2] ?? "";
  // The prelude is whatever comes before the first color.
  CSS_COLOR_FN.lastIndex = 0;
  const first = CSS_COLOR_FN.exec(body);
  CSS_COLOR_FN.lastIndex = 0;
  if (!first) return null;
  const prelude = body.slice(0, first.index);

  let angle = kind === "linear" ? 180 : 0;
  const deg = /(-?[\d.]+)deg/.exec(prelude);
  if (deg) angle = Number(deg[1]);
  else if (kind === "linear") {
    const side = /to\s+(top|right|bottom|left)\b/.exec(prelude)?.[1];
    if (side) angle = { top: 0, right: 90, bottom: 180, left: 270 }[side] ?? 180;
  }
  const at = /at\s+(-?[\d.]+)%\s+(-?[\d.]+)%/.exec(prelude);
  const center = at ? { x: Number(at[1]) / 100, y: Number(at[2]) / 100 } : { x: 0.5, y: 0.5 };
  // A sized ellipse: "60% 40% at …" (D88).
  const sized = kind === "radial" ? /^\s*(?:ellipse\s+)?([\d.]+)%\s+([\d.]+)%/.exec(prelude) : null;
  const radius = sized ? { x: Number(sized[1]) / 100, y: Number(sized[2]) / 100 } : undefined;

  // Each color, and its position if one follows it ("rgb(…) 40%").
  const raw: Array<{ color: Rgba; at: number | null }> = [];
  for (const match of body.matchAll(CSS_COLOR_FN)) {
    const color = parseCssColor(match[0]);
    if (!color) return null;
    const after = body.slice((match.index ?? 0) + match[0].length);
    const position = /^\s*(-?[\d.]+)%/.exec(after);
    raw.push({ color, at: position ? Number(position[1]) / 100 : null });
  }
  if (raw.length === 0) return null;
  // Missing positions: first 0, last 1, the rest spread evenly (as CSS does).
  const stops = raw.map((s, i) => ({
    color: s.color,
    at: s.at ?? (raw.length === 1 ? 0 : i / (raw.length - 1)),
  }));
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]?.at ?? 0;
    const stop = stops[i];
    if (stop && stop.at < prev) stop.at = prev; // CSS clamps out-of-order stops forward
  }
  return radius ? { kind, angle, center, radius, stops } : { kind, angle, center, stops };
}

/**
 * The stretches of the gradient (`t` ranges, 0–1) under `area`, on a box `width` × `height`.
 * Usually one range; a conic one can wrap past its start into two.
 */
export function rangesUnder(
  g: ParsedGradient,
  width: number,
  height: number,
  area: Area,
): Array<[number, number]> {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  // Only the part of the area on the painted box shows the gradient.
  const a = {
    left: Math.max(0, Math.min(width, area.left)),
    right: Math.max(0, Math.min(width, area.right)),
    top: Math.max(0, Math.min(height, area.top)),
    bottom: Math.max(0, Math.min(height, area.bottom)),
  };
  const corners = [
    [a.left, a.top],
    [a.right, a.top],
    [a.left, a.bottom],
    [a.right, a.bottom],
  ] as const;
  const cx = g.center.x * width;
  const cy = g.center.y * height;

  if (g.kind === "linear") {
    // CSS: the gradient line runs through the centre at `angle`, long enough that its ends'
    // perpendiculars touch the corners.
    const dx = Math.sin(g.angle * DEG);
    const dy = -Math.cos(g.angle * DEG);
    const length = Math.abs(width * dx) + Math.abs(height * dy) || 1;
    const ts = corners.map(
      ([x, y]) => ((x - width / 2) * dx + (y - height / 2) * dy) / length + 0.5,
    );
    return [[clamp01(Math.min(...ts)), clamp01(Math.max(...ts))]];
  }

  if (g.kind === "radial") {
    // ellipse farthest-side: offset 1 is the ellipse touching the farthest side on each axis
    // (or the ellipse it was sized to).
    const rx = (g.radius ? g.radius.x * width : Math.max(cx, width - cx)) || 1;
    const ry = (g.radius ? g.radius.y * height : Math.max(cy, height - cy)) || 1;
    const t = (x: number, y: number) => Math.hypot((x - cx) / rx, (y - cy) / ry);
    const nearX = Math.min(Math.max(cx, a.left), a.right);
    const nearY = Math.min(Math.max(cy, a.top), a.bottom);
    return [[clamp01(t(nearX, nearY)), clamp01(Math.max(...corners.map(([x, y]) => t(x, y))))]];
  }

  // Conic: the angles the area spans around the centre (all of them if it contains it).
  if (a.left <= cx && cx <= a.right && a.top <= cy && cy <= a.bottom) return [[0, 1]];
  const turn = (x: number, y: number) => {
    const degrees = Math.atan2(x - cx, -(y - cy)) / DEG - g.angle; // clockwise from the top
    return (((degrees % 360) + 360) % 360) / 360;
  };
  const ts = corners.map(([x, y]) => turn(x, y)).sort((p, q) => p - q);
  // The area sits on one side of the centre, so it spans under half a turn: the arc is
  // everything except the largest gap between neighbouring corner angles.
  let gap = { size: (ts[0] ?? 0) + 1 - (ts[ts.length - 1] ?? 0), after: ts.length - 1 };
  for (let i = 0; i < ts.length - 1; i++) {
    const size = (ts[i + 1] ?? 0) - (ts[i] ?? 0);
    if (size > gap.size) gap = { size, after: i };
  }
  const start = ts[(gap.after + 1) % ts.length] ?? 0;
  const end = ts[gap.after] ?? 1;
  return start <= end
    ? [[start, end]]
    : [
        [start, 1],
        [0, end],
      ];
}

/** The gradient's color at `t` (straight interpolation between the stops around it). */
export function colorAt(g: ParsedGradient, t: number): Rgba {
  const { stops } = g;
  const first = stops[0] as { color: Rgba; at: number };
  if (t <= first.at) return first.color;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] as { color: Rgba; at: number };
    const b = stops[i] as { color: Rgba; at: number };
    if (t <= b.at) {
      const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
      const lerp = (x: number, y: number) => x + (y - x) * k;
      const [ar, ag, ab, aa] = a.color;
      const [br, bg, bb, ba] = b.color;
      return [lerp(ar, br), lerp(ag, bg), lerp(ab, bb), lerp(aa, ba)];
    }
  }
  return (stops[stops.length - 1] as { color: Rgba }).color;
}

/**
 * Colors to test contrast against within `ranges`: both ends, every stop inside, and points
 * between them (contrast can be worst mid-way when the text color sits between two stops).
 */
export function samplesIn(g: ParsedGradient, ranges: ReadonlyArray<[number, number]>): Rgba[] {
  const out: Rgba[] = [];
  for (const [from, to] of ranges) {
    const ts = [from, ...g.stops.map((s) => s.at).filter((t) => t > from && t < to), to];
    ts.forEach((t, i) => {
      out.push(colorAt(g, t));
      const next = ts[i + 1];
      if (next !== undefined && next > t) {
        for (const k of [0.25, 0.5, 0.75]) out.push(colorAt(g, t + (next - t) * k));
      }
    });
  }
  return out;
}
