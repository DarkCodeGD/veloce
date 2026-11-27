/**
 * Built-in `shape` element: rectangles (optionally rounded), ellipses, and the outline shapes
 * of D127: triangle, polygon, star, block arrow and chevron. Every kind fills with any paint
 * and strokes inside its outline, and stretches with its box.
 */
import {
  PaintSchema,
  type PathSegment,
  RadiusSchema,
  SHAPE_DEFAULTS,
  SHAPE_KINDS,
  StrokeSchema,
  shapeOutline,
} from "@veloce/core";
import {
  type AssetUrlResolver,
  applySvgStroke,
  cssBorder,
  cssLength,
  cssPaint,
  defineElement,
  definePlugin,
  svgElement,
  z,
} from "@veloce/plugin-api";

/** A setting that only some kinds read: the inspector shows it for those (D127 §5). */
const only = (...kinds: string[]) => ({ when: { shape: kinds } });

export const ShapePropsSchema = z.strictObject({
  shape: z.enum(SHAPE_KINDS),
  /** Color, gradient or image. Default: `"$color.primary"`. */
  fill: PaintSchema.optional(),
  stroke: StrokeSchema.optional(),
  /** Corner radius (rect only). Default: 0. */
  radius: RadiusSchema.optional().meta(only("rect")),
  sides: z
    .number()
    .int()
    .min(3)
    .max(60)
    .optional()
    .describe(`Polygon: how many sides (default ${SHAPE_DEFAULTS.sides})`)
    .meta(only("polygon")),
  points: z
    .number()
    .int()
    .min(3)
    .max(60)
    .optional()
    .describe(`Star: how many points (default ${SHAPE_DEFAULTS.points})`)
    .meta(only("star")),
  innerRadius: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      `Star: how far in the inner corners are, 0–1 of the outer (default ${SHAPE_DEFAULTS.innerRadius}; lower is spikier)`,
    )
    .meta(only("star")),
  headLength: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(`Arrow: the head's length, 0–1 of the width (default ${SHAPE_DEFAULTS.headLength})`)
    .meta(only("arrow")),
  shaftWidth: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      `Arrow: the shaft's thickness, 0–1 of the height (default ${SHAPE_DEFAULTS.shaftWidth})`,
    )
    .meta(only("arrow")),
  depth: z
    .number()
    .min(0)
    .max(0.5)
    .optional()
    .describe(
      `Chevron: how deep its notch and point are, 0–0.5 of the width (default ${SHAPE_DEFAULTS.depth})`,
    )
    .meta(only("chevron")),
});
export type ShapeProps = z.infer<typeof ShapePropsSchema>;

const AI_DOCS = `# shape

Filled shapes for backgrounds, cards, dividers, badges, diagrams and decorative accents. Every kind stretches to its box.

**Props**
- \`shape\`: \`"rect"\`, \`"ellipse"\`, \`"triangle"\`, \`"polygon"\` (\`sides\`: 3–60), \`"star"\` (\`points\`: 3–60, \`innerRadius\`: 0–1, lower is spikier), \`"arrow"\` (a block arrow pointing right: \`headLength\` 0–1 of the width, \`shaftWidth\` 0–1 of the height; point it elsewhere with the layer's \`rotation\`), \`"chevron"\` (a process step pointing right: \`depth\` 0–0.5)
- \`fill\`: a color (\`"$color.primary"\`, or at an opacity: \`"$color.primary/30"\`), \`"transparent"\`, a gradient \`{ "type": "linear-gradient", "angle": 135, "stops": [{ "offset": 0, "color": "$color.primary" }, { "offset": 1, "color": "$color.secondary" }] }\` (also \`"radial-gradient"\` with \`center\`, and \`"conic-gradient"\`, an angular sweep, with \`angle\` and \`center\`; see get_docs("layout")), or an image \`{ "type": "image", "asset": "asset:<sha256>" }\`
- \`stroke\`: \`{ "color": "$color.border", "width": 2, "style"?: "solid" | "dashed" | "dotted" }\`
- \`radius\`: rounded corners for rect (\`"$radius.md"\` or pixels)

**Example:** a thin accent bar
\`{ "type": "shape", "width": 120, "height": 8, "props": { "shape": "rect", "fill": "$color.accent", "radius": "$radius.full" } }\`

**Example:** a 5-point star
\`{ "type": "shape", "width": 160, "height": 160, "props": { "shape": "star", "points": 5, "innerRadius": 0.45, "fill": "$color.accent" } }\`

**Example:** a row of process steps: chevrons in a stack row with a small negative gap, each with its label in a text layer on top.

**Lines and arrows** with two ends are the \`line\` element; free-form drawings and icons from path data are \`vector\`.

**Tip:** To put content on a card, use a frame with \`style.fill\` instead of stacking a shape behind text. Frames lay out their children.`;

export const shapeElement = defineElement<ShapeProps>({
  type: "shape",
  title: "Shape",
  description:
    "Rectangles, ellipses, triangles, polygons, stars, block arrows and chevrons, with any fill.",
  propsSchema: ShapePropsSchema,
  defaultProps: { shape: "rect", fill: "$color.primary" },
  defaultSize: { width: 200, height: 200 },
  deterministic: true,
  aiDocs: AI_DOCS,
  mount(container, props, ctx) {
    const el = document.createElement("div");
    el.className = "v-shape";
    container.append(el);
    // The stroke of an outline shape: an SVG polygon over the fill (rect and ellipse use a
    // CSS border instead). Made on first need, kept while the shape is an outline kind.
    let outline: { svg: SVGSVGElement; polygon: SVGPolygonElement } | null = null;
    const render = (p: ShapeProps) => {
      const corners = outlinePoints(p);
      applyShapeStyle(el, p, ctx.assetUrl, corners);
      if (corners && p.stroke) {
        outline ??= makeOutline(container);
        drawOutline(outline, corners, p);
      } else if (outline) {
        outline.svg.remove();
        outline = null;
      }
    };
    render(props);
    return {
      update: render,
      seek: () => {},
      dispose: () => {
        el.remove();
        outline?.svg.remove();
        outline = null;
      },
    };
  },
});

export const shapePlugin = definePlugin({
  manifest: {
    id: "veloce.shape",
    name: "Shape",
    version: "0.1.0",
    description: "Built-in shape element.",
    license: "Apache-2.0",
  },
  elements: [shapeElement],
});

type Corners = ReadonlyArray<{ x: number; y: number }>;

/** An outline kind's corners in the unit box (all of them have straight edges), or null. */
function outlinePoints(p: ShapeProps): Corners | null {
  const outline = shapeOutline(p.shape, p);
  if (!outline) return null;
  return outline.flatMap((s: PathSegment) =>
    s.type === "M" || s.type === "L" ? [{ x: s.x, y: s.y }] : [],
  );
}

/** The CSS clip of an outline: percentages, so it stretches with the box. */
const clipPolygon = (corners: Corners) =>
  `polygon(${corners.map((c) => `${pct(c.x)} ${pct(c.y)}`).join(", ")})`;
const pct = (v: number) => `${Math.round(v * 100_000) / 1000}%`;

function applyShapeStyle(
  el: HTMLElement,
  p: ShapeProps,
  assetUrl: AssetUrlResolver,
  corners: Corners | null,
): void {
  const s = el.style;
  s.cssText = "";
  s.boxSizing = "border-box";
  s.width = "100%";
  s.height = "100%";
  s.background = cssPaint(p.fill ?? "$color.primary", assetUrl);
  if (corners) {
    s.clipPath = clipPolygon(corners);
    return;
  }
  if (p.stroke) s.border = cssBorder(p.stroke);
  s.borderRadius = p.shape === "ellipse" ? "50%" : cssLength(p.radius ?? 0);
}

function makeOutline(container: HTMLElement) {
  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  Object.assign(svg.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    overflow: "visible",
    pointerEvents: "none",
  });
  const polygon = svgElement("polygon");
  polygon.setAttribute("fill", "none");
  svg.append(polygon);
  container.append(svg);
  return { svg, polygon };
}

/**
 * The stroke sits inside the outline, as a rect's border does: drawn twice as wide and
 * clipped to the shape, so exactly its inner half shows.
 */
function drawOutline(
  outline: { svg: SVGSVGElement; polygon: SVGPolygonElement },
  corners: Corners,
  p: ShapeProps,
): void {
  outline.polygon.setAttribute("points", corners.map((c) => `${c.x},${c.y}`).join(" "));
  outline.polygon.setAttribute("stroke-linejoin", "round");
  applySvgStroke(outline.polygon, p.stroke, 2);
  outline.svg.style.clipPath = clipPolygon(corners);
}
