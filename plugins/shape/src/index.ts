/**
 * Built-in `shape` element: rectangles (optionally rounded) and ellipses, filled with any paint.
 */
import { PaintSchema, RadiusSchema, StrokeSchema } from "@veloce/core";
import {
  type AssetUrlResolver,
  cssBorder,
  cssLength,
  cssPaint,
  defineElement,
  definePlugin,
  z,
} from "@veloce/plugin-api";

export const ShapePropsSchema = z.strictObject({
  shape: z.enum(["rect", "ellipse"]),
  /** Color, gradient or image. Default: `"$color.primary"`. */
  fill: PaintSchema.optional(),
  stroke: StrokeSchema.optional(),
  /** Corner radius (rect only). Default: 0. */
  radius: RadiusSchema.optional(),
});
export type ShapeProps = z.infer<typeof ShapePropsSchema>;

const AI_DOCS = `# shape

Rectangles and ellipses for backgrounds, cards, dividers, badges and decorative accents.

**Props**
- \`shape\`: \`"rect"\` or \`"ellipse"\`
- \`fill\`: a color (\`"$color.primary"\`, or at an opacity: \`"$color.primary/30"\`), \`"transparent"\`, a gradient \`{ "type": "linear-gradient", "angle": 135, "stops": [{ "offset": 0, "color": "$color.primary" }, { "offset": 1, "color": "$color.secondary" }] }\` (also \`"radial-gradient"\` with \`center\`, and \`"conic-gradient"\`, an angular sweep, with \`angle\` and \`center\`; see get_docs("layout")), or an image \`{ "type": "image", "asset": "asset:<sha256>" }\`
- \`stroke\`: \`{ "color": "$color.border", "width": 2, "style"?: "solid" | "dashed" | "dotted" }\`
- \`radius\`: rounded corners for rect (\`"$radius.md"\` or pixels)

**Example:** a thin accent bar
\`{ "type": "shape", "width": 120, "height": 8, "props": { "shape": "rect", "fill": "$color.accent", "radius": "$radius.full" } }\`

**Tip:** To put content on a card, use a frame with \`style.fill\` instead of stacking a shape behind text. Frames lay out their children.`;

export const shapeElement = defineElement<ShapeProps>({
  type: "shape",
  title: "Shape",
  description: "Rectangles and ellipses with color, gradient or image fills.",
  propsSchema: ShapePropsSchema,
  defaultProps: { shape: "rect", fill: "$color.primary" },
  defaultSize: { width: 200, height: 200 },
  deterministic: true,
  aiDocs: AI_DOCS,
  mount(container, props, ctx) {
    const el = document.createElement("div");
    el.className = "v-shape";
    container.append(el);
    const render = (p: ShapeProps) => applyShapeStyle(el, p, ctx.assetUrl);
    render(props);
    return {
      update: render,
      seek: () => {},
      dispose: () => el.remove(),
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

function applyShapeStyle(el: HTMLElement, p: ShapeProps, assetUrl: AssetUrlResolver): void {
  const s = el.style;
  s.cssText = "";
  s.boxSizing = "border-box";
  s.width = "100%";
  s.height = "100%";
  s.background = cssPaint(p.fill ?? "$color.primary", assetUrl);
  if (p.stroke) s.border = cssBorder(p.stroke);
  s.borderRadius = p.shape === "ellipse" ? "50%" : cssLength(p.radius ?? 0);
}
