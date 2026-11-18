/**
 * Built-in `image` element. Images are deck assets (`"asset:<sha256>"`), never remote URLs:
 * decks stay self-contained, work offline, and opening one never pings a third-party server.
 */
import { AssetRefSchema, PointSchema, parseAssetRef, RadiusSchema } from "@veloce/core";
import { cssLength, defineElement, definePlugin, z } from "@veloce/plugin-api";

export const ImagePropsSchema = z.strictObject({
  asset: AssetRefSchema,
  /** Describes the image for screen readers. Use "" for purely decorative images. */
  alt: z.string().max(1000),
  /** Default: `"cover"` (fill the box, cropping as needed). */
  fit: z.enum(["cover", "contain", "fill"]).optional(),
  /** Which part stays visible when cropping, as fractions (0–1). Default: center. */
  focus: PointSchema.optional(),
  radius: RadiusSchema.optional(),
});
export type ImageProps = z.infer<typeof ImagePropsSchema>;

const AI_DOCS = `# image

Photos, logos, screenshots and illustrations. The image must be a deck asset: add the file with add_asset (a local path or base64), then use the \`"asset:<sha256>"\` it returns. Remote URLs aren't supported.

**Props**
- \`asset\` (required): \`"asset:<sha256>"\`
- \`alt\` (required): what the image shows, for screen readers. Use \`""\` only for decoration.
- \`fit\`: \`"cover"\` (default, crops to fill), \`"contain"\` (whole image visible), \`"fill"\` (stretch)
- \`focus\`: \`{ "x": 0.5, "y": 0.2 }\` keeps the top-center visible when cropping (e.g. faces)
- \`radius\`: rounded corners

**Example**
\`{ "type": "image", "width": "fill", "height": 480, "props": { "asset": "asset:…", "alt": "Team at the launch event", "fit": "cover" } }\``;

export const imageElement = defineElement<ImageProps>({
  type: "image",
  title: "Image",
  description: "A picture from the deck's assets, with fit, focus point and alt text.",
  propsSchema: ImagePropsSchema,
  defaultProps: { asset: `asset:${"0".repeat(64)}`, alt: "" },
  defaultSize: { width: 400, height: 300 },
  deterministic: true,
  aiDocs: AI_DOCS,
  mount(container, props, ctx) {
    const img = document.createElement("img");
    img.className = "v-image";
    img.draggable = false;
    img.decoding = "async";
    container.append(img);
    const render = (p: ImageProps) => {
      const id = parseAssetRef(p.asset);
      const src = id ? ctx.assetUrl(id) : "";
      if (img.getAttribute("src") !== src) img.src = src;
      img.alt = p.alt;
      const s = img.style;
      s.cssText = "";
      s.display = "block";
      s.width = "100%";
      s.height = "100%";
      s.objectFit = p.fit ?? "cover";
      const { x, y } = p.focus ?? { x: 0.5, y: 0.5 };
      s.objectPosition = `${x * 100}% ${y * 100}%`;
      if (p.radius !== undefined) s.borderRadius = cssLength(p.radius);
    };
    render(props);
    return {
      update: render,
      seek: () => {},
      dispose: () => img.remove(),
    };
  },
});

export const imagePlugin = definePlugin({
  manifest: {
    id: "veloce.image",
    name: "Image",
    version: "0.1.0",
    description: "Built-in image element.",
    license: "Apache-2.0",
  },
  elements: [imageElement],
});
