/**
 * Built-in `vector` element (D127 §1): any shape from SVG path data (icons, logos, an
 * agent's drawings), fitted into the layer's box like any layer.
 *
 * It draws in pixels: the path is moved from its viewBox into the box (`fitViewBox`), then
 * - the fill is a plain box painted with CSS (`cssPaint`: colors, tokens, every gradient,
 *   image fills) and clipped with CSS `clip-path: path(...)`, so a gradient looks the same on
 *   a path as on a rect. The painted box covers the drawing's area, not the whole layer, so a
 *   gradient spans the drawing.
 * - the stroke is an SVG path on top, centered on the outline as in SVG, so a 2 px stroke is
 *   2 px however the box is stretched.
 * Nothing needs a document-wide ID (no SVG `clipPath`), so the same deck can render in
 * thumbnails, the presenter view and export side by side. Path data is checked by core's
 * strict parser (PathDataSchema) before it gets here, and set only as an attribute on
 * elements made with `createElementNS`.
 */
import {
  type Bounds,
  defaultViewBox,
  fitViewBox,
  formatPathData,
  PaintSchema,
  PathDataSchema,
  type PathFit,
  type PathSegment,
  parsePathData,
  pathBounds,
  StrokeSchema,
  transformPath,
  translate,
  ViewBoxSchema,
} from "@veloce/core";
import { applySvgStroke, cssPaint, defineElement, svgElement, z } from "@veloce/plugin-api";
import { watchBoxSize } from "./box-size.js";

export const VectorPropsSchema = z.strictObject({
  d: PathDataSchema,
  viewBox: ViewBoxSchema.optional(),
  fit: z
    .enum(["contain", "stretch"])
    .optional()
    .describe(
      'How the drawing fits the box: "contain" (default) keeps its proportions, centered; "stretch" fills the box both ways',
    ),
  fill: PaintSchema.optional().describe(
    'A color, gradient or image. Default "$color.text"; "transparent" for an outline-only drawing',
  ),
  fillRule: z
    .enum(["nonzero", "evenodd"])
    .optional()
    .describe(
      'Which parts count as inside: "nonzero" (default) or "evenodd" (an inner loop cuts a hole, like the middle of an "O")',
    ),
  stroke: StrokeSchema.optional(),
  cap: z
    .enum(["round", "butt", "square"])
    .optional()
    .describe('The stroke\'s open ends: "round" (default), "butt" or "square"'),
  join: z
    .enum(["round", "miter", "bevel"])
    .optional()
    .describe('The stroke\'s corners: "round" (default), "miter" (sharp) or "bevel"'),
});
export type VectorProps = z.infer<typeof VectorPropsSchema>;

export const VECTOR_DEFAULT_FILL = "$color.text";

// ── Geometry (pure) ───────────────────────────────────────────────────────────────────

/** What a vector draws in a box of `width` × `height` pixels. */
export interface VectorGeometry {
  /** Where the fill is painted: the drawing's area in the box. */
  area: Bounds;
  /** The outline in pixels, relative to `area` (for the fill's clip). */
  clip: string;
  /** The outline in pixels, relative to the box (for the stroke). */
  outline: string;
}

/** Parsed path data, remembered for the last `d` (updates rarely change it). */
export function pathParser(): (d: string) => PathSegment[] {
  let last: { d: string; segments: PathSegment[] } | null = null;
  return (d) => {
    if (last?.d !== d) {
      const parsed = parsePathData(d);
      last = { d, segments: parsed.ok ? parsed.segments : [] };
    }
    return last.segments;
  };
}

export function vectorGeometry(
  segments: readonly PathSegment[],
  width: number,
  height: number,
  p: Pick<VectorProps, "viewBox" | "fit">,
): VectorGeometry {
  const viewBox = p.viewBox ?? defaultViewBox(pathBounds(segments));
  const fit: PathFit = p.fit ?? "contain";
  const m = fitViewBox(viewBox, width, height, fit);
  const scaleX = m[0];
  const scaleY = m[3];
  const area = {
    x: m[4] + viewBox.x * scaleX,
    y: m[5] + viewBox.y * scaleY,
    width: viewBox.width * scaleX,
    height: viewBox.height * scaleY,
  };
  const inBox = transformPath(segments, m);
  return {
    area,
    clip: formatPathData(transformPath(inBox, translate(-area.x, -area.y)), 2),
    outline: formatPathData(inBox, 2),
  };
}

// ── Drawing ───────────────────────────────────────────────────────────────────────────

const AI_DOCS = `# vector

Any shape from SVG path data: icons, logos, badges, arrows that bend, blobs, maps, an illustration's parts. Sized and placed like any layer; the drawing fits its box.

**Props**
- \`d\` (required): SVG path data, the \`d\` of an SVG \`<path>\`: \`M\` move, \`L\`/\`H\`/\`V\` lines, \`C\`/\`S\` cubic curves, \`Q\`/\`T\` quadratic curves, \`A\` arcs, \`Z\` close; lowercase is relative. Up to 20 000 characters.
- \`viewBox\`: the coordinates the path is drawn in, \`{ "x": 0, "y": 0, "width": 24, "height": 24 }\`. Default: the path's own bounds (the drawing fills the box edge to edge). Give it when the path was drawn on a canvas with margins, like a 24-unit icon, so the margins are kept.
- \`fit\`: \`"contain"\` (default: keeps the proportions, centered in the box) or \`"stretch"\` (fills the box both ways).
- \`fill\`: a color (\`"$color.accent"\`, \`"$color.primary/40"\`), a gradient or an image, like a shape's fill. Default \`"$color.text"\`. \`"transparent"\` for an outline-only drawing.
- \`fillRule\`: \`"evenodd"\` makes an inner loop a hole (the middle of an "O", a ring); default \`"nonzero"\`.
- \`stroke\`: \`{ "color": "$color.text", "width": 2, "style"?: "solid" | "dashed" | "dotted" }\`, centered on the outline, in pixels whatever the box size. \`cap\` (\`"round"\` default, \`"butt"\`, \`"square"\`) and \`join\` (\`"round"\` default, \`"miter"\`, \`"bevel"\`) shape its ends and corners.

**Example:** a lightning-bolt logo mark
\`{ "type": "vector", "width": 120, "height": 120, "props": { "d": "M13 2 L3 14 H12 L11 22 L21 10 H12 Z", "viewBox": { "x": 0, "y": 0, "width": 24, "height": 24 }, "fill": "$color.accent" } }\`

**Example:** an outline icon (a check mark) drawn with a stroke
\`{ "type": "vector", "width": 48, "height": 48, "props": { "d": "M4 12 L9 17 L20 6", "viewBox": { "x": 0, "y": 0, "width": 24, "height": 24 }, "fill": "transparent", "stroke": { "color": "$color.primary", "width": 3 } } }\`

**Example:** a ring (a hole with evenodd)
\`{ "type": "vector", "width": 200, "height": 200, "props": { "d": "M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z M20 50 A30 30 0 1 0 80 50 A30 30 0 1 0 20 50 Z", "fillRule": "evenodd", "fill": "$color.primary" } }\`

**Importing an SVG file:** don't translate it by hand. Put \`{ "svg": "<svg …>…</svg>", "width": 200 }\` wherever a node goes (upsert_slide's children, node.insert in apply_ops): it's imported as one vector, or as a Free frame of them when it has several colors, sized to the width or height you give, keeping its proportions. Paths, basic shapes, colors, gradients and transforms come through; scripts, text, images and links are left out, and the result says what. \`currentColor\` becomes \`"$color.text"\`, so icons follow the theme.

**Tips:** Draw in a simple coordinate space (0–24 or 0–100) and set \`viewBox\` to it. Straight lines and arrows between two points are \`line\`; rectangles, ellipses, stars, polygons and block arrows are \`shape\` (they have settings instead of path data). The same icon used several times: save it as a component.`;

export const vectorElement = defineElement<VectorProps>({
  type: "vector",
  title: "Vector",
  description: "Any shape from SVG path data: icons, logos and drawings, with any fill.",
  propsSchema: VectorPropsSchema,
  defaultProps: {
    // A heart in a 24-unit square.
    d: "M12 21C12 21 2 15 2 8.5C2 5.4 4.4 3 7.4 3C9.3 3 11 4 12 5.6C13 4 14.7 3 16.6 3C19.6 3 22 5.4 22 8.5C22 15 12 21 12 21Z",
    viewBox: { x: 0, y: 0, width: 24, height: 24 },
    fill: "$color.primary",
  },
  defaultSize: { width: 200, height: 200 },
  deterministic: true,
  aiDocs: AI_DOCS,
  mount(container, props, ctx) {
    const paint = document.createElement("div");
    paint.className = "v-vector";
    paint.style.position = "absolute";
    const svg = svgElement("svg");
    svg.setAttribute("aria-hidden", "true");
    Object.assign(svg.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      overflow: "visible", // a centered stroke reaches half its width past the box
      pointerEvents: "none",
    });
    const path = svgElement("path");
    svg.append(path);
    container.append(paint, svg);

    const parse = pathParser();
    let current = props;
    const draw = () => {
      const { width, height } = box.size();
      const p = current;
      const g = vectorGeometry(parse(p.d), width, height, p);
      const rule = p.fillRule ?? "nonzero";

      const fill = p.fill ?? VECTOR_DEFAULT_FILL;
      const s = paint.style;
      s.display = fill === "transparent" ? "none" : "";
      s.left = `${g.area.x}px`;
      s.top = `${g.area.y}px`;
      s.width = `${g.area.width}px`;
      s.height = `${g.area.height}px`;
      s.background = cssPaint(fill, ctx.assetUrl);
      s.clipPath = `path(${rule}, ${JSON.stringify(g.clip)})`;

      if (p.stroke) {
        svg.style.display = "";
        path.setAttribute("d", g.outline);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke-linecap", p.cap ?? "round");
        path.setAttribute("stroke-linejoin", p.join ?? "round");
        applySvgStroke(path, p.stroke); // after the cap: dotted needs round ends
      } else {
        svg.style.display = "none";
      }
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
        paint.remove();
        svg.remove();
      },
    };
  },
});
