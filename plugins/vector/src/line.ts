/**
 * Built-in `line` element (D127 §1): a straight line between two ends, each a fraction of
 * the layer's box, with an optional head at each end. The box stays the layout's (stacks,
 * grids, `position`), so a line moves, aligns and animates like any layer.
 *
 * It draws in pixels, not a stretched viewBox: it reads its box size and computes the shaft
 * and heads itself, so heads never distort, a filled head's tip is exactly at the end (the
 * shaft stops at its base, so a round cap can't poke out), and nothing needs a document-wide
 * ID (no SVG markers).
 */
import { type Color, ColorSchema, PointSchema } from "@veloce/core";
import { cssColor, defineElement, svgElement, z } from "@veloce/plugin-api";
import { watchBoxSize } from "./box-size.js";

export const LINE_ENDS = ["none", "arrow", "triangle", "circle", "square", "bar"] as const;
export type LineEnd = (typeof LINE_ENDS)[number];

const EndSchema = z
  .enum(LINE_ENDS)
  .optional()
  .describe(
    '"none" (default), "arrow" (an open head), "triangle" (a filled head), "circle", "square" or "bar"; sized by the width',
  );

export const LinePropsSchema = z.strictObject({
  from: PointSchema.optional().describe(
    'Where it starts, as fractions of the box: { "x": 0, "y": 0.5 } (default) is the middle of the left edge',
  ),
  to: PointSchema.optional().describe(
    'Where it ends, as fractions of the box: { "x": 1, "y": 0.5 } (default) is the middle of the right edge',
  ),
  color: ColorSchema.optional().describe('Default "$color.text"'),
  width: z.number().positive().max(200).optional().describe("Thickness in pixels (default 4)"),
  dash: z.enum(["solid", "dashed", "dotted"]).optional().describe('Default "solid"'),
  cap: z
    .enum(["round", "butt", "square"])
    .optional()
    .describe('How a bare end is drawn: "round" (default), "butt" (cut flat) or "square"'),
  start: EndSchema,
  end: EndSchema,
});
export type LineProps = z.infer<typeof LinePropsSchema>;

// ── Geometry (pure) ───────────────────────────────────────────────────────────────────

interface Pt {
  x: number;
  y: number;
}

/** What a line draws in a box of `width` × `height` pixels. */
export interface LineGeometry {
  /** The shaft, shortened under filled heads; null when the heads cover it. */
  shaft: [Pt, Pt] | null;
  heads: LineHead[];
}
export type LineHead =
  | { kind: "polyline"; points: Pt[] } // arrow, bar: stroked
  | { kind: "polygon"; points: Pt[] } // triangle, square: filled
  | { kind: "circle"; center: Pt; radius: number }; // filled

export const LINE_DEFAULTS = {
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  color: "$color.text" as Color,
  width: 4,
} as const;

/** A head's length along the line, for a stroke `w` wide. */
export const headLength = (w: number) => Math.max(10, w * 3.5);

export function lineGeometry(width: number, height: number, p: LineProps): LineGeometry {
  const w = p.width ?? LINE_DEFAULTS.width;
  const from = p.from ?? LINE_DEFAULTS.from;
  const to = p.to ?? LINE_DEFAULTS.to;
  const a = { x: from.x * width, y: from.y * height };
  const b = { x: to.x * width, y: to.y * height };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-6) return { shaft: null, heads: [] };
  // Along the line (a → b) and across it.
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const px = -uy;
  const py = ux;

  // Two heads may not overlap: each gets at most half the line.
  const reach = Math.min(headLength(w), length / 2);
  const half = reach * 0.6; // half the head's width
  const at = (o: Pt, along: number, across: number): Pt => ({
    x: o.x + ux * along + px * across,
    y: o.y + uy * along + py * across,
  });

  const heads: LineHead[] = [];
  /** A head at `tip`, pointing `dir` (1: along the line, -1: back); how far the shaft stops short. */
  const head = (end: LineEnd | undefined, tip: Pt, dir: 1 | -1): number => {
    const back = (along: number, across: number) => at(tip, -dir * along, across);
    switch (end ?? "none") {
      case "none":
        return 0;
      case "arrow":
        heads.push({ kind: "polyline", points: [back(reach, half), tip, back(reach, -half)] });
        return 0;
      case "triangle":
        heads.push({ kind: "polygon", points: [tip, back(reach, half), back(reach, -half)] });
        return reach * 0.9; // under the base, so the shaft's cap stays inside the head
      case "circle": {
        const radius = Math.max(4, w * 1.6);
        heads.push({ kind: "circle", center: tip, radius });
        return 0;
      }
      case "square": {
        const r = Math.max(4, w * 1.5);
        heads.push({
          kind: "polygon",
          points: [at(tip, -r, -r), at(tip, r, -r), at(tip, r, r), at(tip, -r, r)],
        });
        return 0;
      }
      case "bar":
        heads.push({ kind: "polyline", points: [at(tip, 0, -half), at(tip, 0, half)] });
        return 0;
    }
  };
  const startCut = head(p.start, a, -1);
  const endCut = head(p.end, b, 1);
  const shaft: [Pt, Pt] | null =
    startCut + endCut >= length ? null : [at(a, startCut, 0), at(b, -endCut, 0)];
  return { shaft, heads };
}

// ── Drawing ───────────────────────────────────────────────────────────────────────────

const AI_DOCS = `# line

A straight line or arrow between two points: connectors in diagrams, timelines, dividers, callouts pointing at something.

**Props**
- \`from\`, \`to\`: its ends as fractions of the layer's box (\`{ "x": 0, "y": 0.5 }\` to \`{ "x": 1, "y": 0.5 }\` by default: left to right through the middle). A diagonal up-right: \`from\` \`{ "x": 0, "y": 1 }\`, \`to\` \`{ "x": 1, "y": 0 }\`. Size and place the box like any layer.
- \`start\`, \`end\`: a head at each end: \`"none"\` (default), \`"arrow"\` (open), \`"triangle"\` (filled), \`"circle"\`, \`"square"\`, \`"bar"\`. Heads scale with \`width\`.
- \`color\` (default \`"$color.text"\`), \`width\` (pixels, default 4), \`dash\` (\`"solid"\`, \`"dashed"\`, \`"dotted"\`), \`cap\` (\`"round"\`, \`"butt"\`, \`"square"\`).

**Example:** an arrow from one card to the next, in a stack row between them
\`{ "type": "line", "width": 120, "height": 24, "props": { "end": "triangle", "color": "$color.muted", "width": 3 } }\`

**Example:** a vertical timeline spine
\`{ "type": "line", "width": 8, "height": "fill", "props": { "from": { "x": 0.5, "y": 0 }, "to": { "x": 0.5, "y": 1 }, "color": "$color.border", "width": 2 } }\`

**Tips:** heads are drawn past nothing: the tip is exactly at the end, so leave the box a little room when a head ends at its edge. For a block arrow (a filled arrow shape with an outline), use \`shape\` with \`"shape": "arrow"\`.`;

export const lineElement = defineElement<LineProps>({
  type: "line",
  title: "Line",
  description: "A straight line or arrow between two points, with optional heads.",
  propsSchema: LinePropsSchema,
  defaultProps: { end: "triangle" },
  defaultSize: { width: 240, height: 40 },
  deterministic: true,
  aiDocs: AI_DOCS,
  mount(container, props, _ctx) {
    const svg = svgElement("svg");
    svg.setAttribute("aria-hidden", "true");
    Object.assign(svg.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      overflow: "visible",
      pointerEvents: "none",
    });
    container.append(svg);
    let current = props;
    const draw = () => {
      const { width, height } = box.size();
      drawLine(svg, width, height, current);
    };
    const box = watchBoxSize(container, draw);
    draw();
    return {
      update(next) {
        current = next;
        draw();
      },
      seek: () => {},
      dispose() {
        box.dispose();
        svg.remove();
      },
    };
  },
});

const round = (n: number) => Math.round(n * 100) / 100;
const pointsAttr = (points: readonly Pt[]) =>
  points.map((pt) => `${round(pt.x)},${round(pt.y)}`).join(" ");

function drawLine(svg: SVGSVGElement, width: number, height: number, p: LineProps): void {
  svg.replaceChildren();
  const { shaft, heads } = lineGeometry(width, height, p);
  const color = cssColor(p.color ?? LINE_DEFAULTS.color);
  const w = p.width ?? LINE_DEFAULTS.width;
  const stroked = (el: SVGElement) => {
    el.setAttribute("fill", "none");
    el.setAttribute("stroke-width", String(w));
    el.style.stroke = color;
  };
  if (shaft) {
    const line = svgElement("line");
    line.setAttribute("x1", String(round(shaft[0].x)));
    line.setAttribute("y1", String(round(shaft[0].y)));
    line.setAttribute("x2", String(round(shaft[1].x)));
    line.setAttribute("y2", String(round(shaft[1].y)));
    stroked(line);
    const dotted = p.dash === "dotted";
    line.setAttribute("stroke-linecap", dotted ? "round" : (p.cap ?? "round"));
    if (p.dash === "dashed") line.setAttribute("stroke-dasharray", `${3 * w} ${2 * w}`);
    if (dotted) line.setAttribute("stroke-dasharray", `0 ${2 * w}`);
    svg.append(line);
  }
  for (const head of heads) {
    if (head.kind === "circle") {
      const circle = svgElement("circle");
      circle.setAttribute("cx", String(round(head.center.x)));
      circle.setAttribute("cy", String(round(head.center.y)));
      circle.setAttribute("r", String(round(head.radius)));
      circle.style.fill = color;
      svg.append(circle);
    } else if (head.kind === "polygon") {
      const polygon = svgElement("polygon");
      polygon.setAttribute("points", pointsAttr(head.points));
      polygon.style.fill = color;
      // A touch of stroke rounds the corners, the way drawn arrowheads look.
      polygon.setAttribute("stroke-width", String(Math.min(w, 2)));
      polygon.setAttribute("stroke-linejoin", "round");
      polygon.style.stroke = color;
      svg.append(polygon);
    } else {
      const polyline = svgElement("polyline");
      polyline.setAttribute("points", pointsAttr(head.points));
      stroked(polyline);
      polyline.setAttribute("stroke-linecap", "round");
      polyline.setAttribute("stroke-linejoin", "round");
      svg.append(polyline);
    }
  }
}
