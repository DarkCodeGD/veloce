/**
 * SVG path data, strictly (D127 §3): the grammar agents already write (`M 0 0 L 10 10 Z`),
 * parsed into absolute segments, measured and written back out. Pure, no DOM: it runs in the
 * server (MCP input, SVG import), the editor and export alike.
 *
 * Parsing is the security boundary for paths: only the path grammar gets through, numbers
 * are finite, and size is capped, so whatever reaches an SVG `d` attribute is a path and
 * nothing else.
 *
 * Shorthands are expanded as they're read: `H`/`V` become `L`, `S`/`T` become `C`/`Q` with
 * the reflected control point, relative commands become absolute. Arcs stay arcs (`A`):
 * `arcToCubics` turns one into curves when something needs them (bounds, later morphing).
 */

/** Characters in one path's data. An icon is ~200, a detailed logo a few thousand. */
export const MAX_PATH_LENGTH = 20_000;
/** Commands in one path, after implicit repeats are counted. */
export const MAX_PATH_COMMANDS = 4_000;

export interface PathPoint {
  x: number;
  y: number;
}

/** One absolute segment. `Z` closes back to the subpath's start. */
export type PathSegment =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | {
      type: "A";
      rx: number;
      ry: number;
      rotation: number;
      largeArc: boolean;
      sweep: boolean;
      x: number;
      y: number;
    }
  | { type: "Z" };

export type PathParse =
  | { ok: true; segments: PathSegment[] }
  | {
      ok: false;
      /** What's wrong, for a person or an agent: names what was found and where. */
      message: string;
      /** Character index of the problem in the input. */
      at: number;
    };

/** How many numbers each command takes (arcs' two flags count as numbers here). */
const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

const isCommand = (c: string) => /^[MLHVCSQTAZ]$/i.test(c);
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** Parse path data. Never throws: a problem comes back with its position. */
export function parsePathData(d: string): PathParse {
  if (typeof d !== "string") return { ok: false, message: "Path data must be a string", at: 0 };
  if (d.length > MAX_PATH_LENGTH) {
    return {
      ok: false,
      message: `Path data is ${d.length} characters; the limit is ${MAX_PATH_LENGTH}`,
      at: MAX_PATH_LENGTH,
    };
  }
  const segments: PathSegment[] = [];
  let i = 0;
  const fail = (message: string, at = i): PathParse => ({ ok: false, message, at });

  const skipSeparators = () => {
    while (i < d.length && (isSpace(d[i] as string) || d[i] === ",")) i++;
  };
  const skipSpaces = () => {
    while (i < d.length && isSpace(d[i] as string)) i++;
  };
  /** A number, or an arc flag (a lone 0 or 1, which may run into the next number). */
  const readNumber = (flag: boolean): number | null => {
    skipSeparators();
    if (flag) {
      const c = d[i];
      if (c === "0" || c === "1") {
        i++;
        return c === "1" ? 1 : 0;
      }
      return null;
    }
    const match = NUMBER.exec(d.slice(i, i + 64));
    if (!match) return null;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return null;
    i += match[0].length;
    return value;
  };

  // The pen, the subpath's start, and the last control point (for S and T).
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubic: PathPoint | null = null;
  let lastQuad: PathPoint | null = null;
  let commands = 0;

  skipSpaces();
  if (i === d.length) return fail('Path data is empty: start with a move, e.g. "M 0 0"');
  if (d[i] !== "M" && d[i] !== "m") {
    return fail(`A path starts with a move ("M x y"), not "${d[i]}"`);
  }

  while (i < d.length) {
    skipSpaces();
    if (i >= d.length) break;
    const letter = d[i] as string;
    if (!isCommand(letter)) {
      return fail(`"${letter}" isn't a path command (M, L, H, V, C, S, Q, T, A or Z)`);
    }
    i++;
    const upper = letter.toUpperCase();
    const relative = letter !== upper;
    const arity = ARITY[upper] as number;
    let first = true;

    // A command repeats while numbers follow it (after a move, the repeats are lines).
    do {
      if (++commands > MAX_PATH_COMMANDS) {
        return fail(`Path has more than ${MAX_PATH_COMMANDS} commands; simplify it`);
      }
      const n: number[] = [];
      for (let k = 0; k < arity; k++) {
        const value = readNumber(upper === "A" && (k === 3 || k === 4));
        if (value === null) {
          const found = d[i] === undefined ? "the end" : `"${d[i]}"`;
          const what = upper === "A" && (k === 3 || k === 4) ? "a flag (0 or 1)" : "a number";
          return fail(
            `"${letter}" takes ${arity} numbers${upper === "A" ? " (rx ry rotation large-arc sweep x y)" : ""}; found ${found} where ${what} should be`,
          );
        }
        n.push(value);
      }
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      const type = upper === "M" && !first ? "L" : upper;
      switch (type) {
        case "M":
          x = ox + (n[0] as number);
          y = oy + (n[1] as number);
          startX = x;
          startY = y;
          segments.push({ type: "M", x, y });
          lastCubic = lastQuad = null;
          break;
        case "L":
          x = ox + (n[0] as number);
          y = oy + (n[1] as number);
          segments.push({ type: "L", x, y });
          lastCubic = lastQuad = null;
          break;
        case "H":
          x = ox + (n[0] as number);
          segments.push({ type: "L", x, y });
          lastCubic = lastQuad = null;
          break;
        case "V":
          y = oy + (n[0] as number);
          segments.push({ type: "L", x, y });
          lastCubic = lastQuad = null;
          break;
        case "C":
        case "S": {
          const [x1, y1]: [number, number] =
            type === "C"
              ? [ox + (n[0] as number), oy + (n[1] as number)]
              : lastCubic
                ? [2 * x - lastCubic.x, 2 * y - lastCubic.y]
                : [x, y];
          const rest = type === "C" ? n.slice(2) : n;
          const x2 = ox + (rest[0] as number);
          const y2 = oy + (rest[1] as number);
          x = ox + (rest[2] as number);
          y = oy + (rest[3] as number);
          segments.push({ type: "C", x1, y1, x2, y2, x, y });
          lastCubic = { x: x2, y: y2 };
          lastQuad = null;
          break;
        }
        case "Q":
        case "T": {
          const reflected: PathPoint = lastQuad
            ? { x: 2 * x - lastQuad.x, y: 2 * y - lastQuad.y }
            : { x, y };
          const x1: number = type === "Q" ? ox + (n[0] as number) : reflected.x;
          const y1: number = type === "Q" ? oy + (n[1] as number) : reflected.y;
          const rest = type === "Q" ? n.slice(2) : n;
          x = ox + (rest[0] as number);
          y = oy + (rest[1] as number);
          segments.push({ type: "Q", x1, y1, x, y });
          lastQuad = { x: x1, y: y1 };
          lastCubic = null;
          break;
        }
        case "A": {
          x = ox + (n[5] as number);
          y = oy + (n[6] as number);
          segments.push({
            type: "A",
            rx: Math.abs(n[0] as number),
            ry: Math.abs(n[1] as number),
            rotation: n[2] as number,
            largeArc: n[3] === 1,
            sweep: n[4] === 1,
            x,
            y,
          });
          lastCubic = lastQuad = null;
          break;
        }
        case "Z":
          x = startX;
          y = startY;
          segments.push({ type: "Z" });
          lastCubic = lastQuad = null;
          break;
      }
      first = false;
      skipSeparators();
      // Z takes no numbers: a number right after it is an error, caught as a non-command.
    } while (arity > 0 && i < d.length && /[\d.+-]/.test(d[i] as string));
  }
  return { ok: true, segments };
}

/** Path data written back out: absolute, compact, numbers rounded to `precision` places. */
export function formatPathData(segments: readonly PathSegment[], precision = 3): string {
  const f = (n: number) => {
    const s = Number(n.toFixed(precision)).toString();
    return s === "-0" ? "0" : s;
  };
  return segments
    .map((s): string => {
      switch (s.type) {
        case "M":
        case "L":
          return `${s.type}${f(s.x)} ${f(s.y)}`;
        case "C":
          return `C${f(s.x1)} ${f(s.y1)} ${f(s.x2)} ${f(s.y2)} ${f(s.x)} ${f(s.y)}`;
        case "Q":
          return `Q${f(s.x1)} ${f(s.y1)} ${f(s.x)} ${f(s.y)}`;
        case "A":
          return `A${f(s.rx)} ${f(s.ry)} ${f(s.rotation)} ${s.largeArc ? 1 : 0} ${s.sweep ? 1 : 0} ${f(s.x)} ${f(s.y)}`;
        default:
          return "Z";
      }
    })
    .join("");
}

// ── Arcs as curves ────────────────────────────────────────────────────────────────────

type Cubic = Extract<PathSegment, { type: "C" }>;

/**
 * One arc from `from` as cubic curves, at most a quarter turn each (SVG 1.1 F.6: endpoint
 * to center parameterization, radii scaled up when too small). A zero radius is a line.
 */
export function arcToCubics(from: PathPoint, arc: Extract<PathSegment, { type: "A" }>): Cubic[] {
  const { x: x2, y: y2, largeArc, sweep } = arc;
  let { rx, ry } = arc;
  const { x: x1, y: y1 } = from;
  if ((x1 === x2 && y1 === y2) || rx === 0 || ry === 0) {
    return x1 === x2 && y1 === y2 ? [] : [{ type: "C", x1, y1, x2, y2, x: x2, y: y2 }];
  }
  const phi = (arc.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // Step 1: the midpoint in the arc's own axes.
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  // Radii too small to reach: scale them up just enough.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  // Step 2: the center in the arc's axes.
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const root = Math.sqrt(Math.max(0, num / den)) * (largeArc === sweep ? -1 : 1);
  const cxp = (root * rx * y1p) / ry;
  const cyp = (-root * ry * x1p) / rx;
  // Step 3: the center, and the start and sweep angles.
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number) => {
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    return { x: cx + cos * ex - sin * ey, y: cy + sin * ex + cos * ey };
  };
  const tangent = (t: number) => {
    const ex = -rx * Math.sin(t);
    const ey = ry * Math.cos(t);
    return { x: cos * ex - sin * ey, y: sin * ex + cos * ey };
  };
  const out: Cubic[] = [];
  for (let p = 0; p < parts; p++) {
    const a = theta1 + p * step;
    const b = a + step;
    const p0 = point(a);
    const p3 = p === parts - 1 ? { x: x2, y: y2 } : point(b);
    const t0 = tangent(a);
    const t3 = tangent(b);
    out.push({
      type: "C",
      x1: p0.x + k * t0.x,
      y1: p0.y + k * t0.y,
      x2: p3.x - k * t3.x,
      y2: p3.y - k * t3.y,
      x: p3.x,
      y: p3.y,
    });
  }
  return out;
}

// ── Bounds ────────────────────────────────────────────────────────────────────────────

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a 1-D cubic Bézier turns (its derivative's roots in 0…1). */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/**
 * The exact box the path's outline covers (curve extrema included, not their control
 * points), or null for a path that draws nothing (a lone move).
 */
export function pathBounds(segments: readonly PathSegment[]): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const cubic = (p0: PathPoint, c: Cubic) => {
    add(c.x, c.y);
    for (const t of cubicExtrema(p0.x, c.x1, c.x2, c.x)) {
      add(cubicAt(p0.x, c.x1, c.x2, c.x, t), cubicAt(p0.y, c.y1, c.y2, c.y, t));
    }
    for (const t of cubicExtrema(p0.y, c.y1, c.y2, c.y)) {
      add(cubicAt(p0.x, c.x1, c.x2, c.x, t), cubicAt(p0.y, c.y1, c.y2, c.y, t));
    }
  };
  let pen: PathPoint = { x: 0, y: 0 };
  let start: PathPoint = pen;
  let pending: PathPoint | null = null; // a move draws nothing until something follows it
  let drew = false;
  for (const s of segments) {
    if (s.type === "M") {
      pen = start = { x: s.x, y: s.y };
      pending = pen;
      continue;
    }
    if (pending) {
      add(pending.x, pending.y);
      pending = null;
    }
    drew = true;
    switch (s.type) {
      case "L":
        add(s.x, s.y);
        pen = { x: s.x, y: s.y };
        break;
      case "C":
        cubic(pen, s);
        pen = { x: s.x, y: s.y };
        break;
      case "Q": {
        // A quadratic is a cubic with its control points two thirds of the way.
        const c: Cubic = {
          type: "C",
          x1: pen.x + (2 / 3) * (s.x1 - pen.x),
          y1: pen.y + (2 / 3) * (s.y1 - pen.y),
          x2: s.x + (2 / 3) * (s.x1 - s.x),
          y2: s.y + (2 / 3) * (s.y1 - s.y),
          x: s.x,
          y: s.y,
        };
        cubic(pen, c);
        pen = { x: s.x, y: s.y };
        break;
      }
      case "A": {
        let from = pen;
        for (const c of arcToCubics(pen, s)) {
          cubic(from, c);
          from = { x: c.x, y: c.y };
        }
        add(s.x, s.y);
        pen = { x: s.x, y: s.y };
        break;
      }
      case "Z":
        pen = start;
        break;
    }
  }
  if (!drew) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
