/**
 * Document layout → CSS. Pure functions returning `{ property: value }` records, so the mapping
 * is unit-testable without a browser.
 *
 * Frames are CSS flexbox (`stack`), CSS grid (`grid`) or a positioning context (`absolute`).
 * A node's size depends on its parent's layout: `"fill"` means "take the free space" along a
 * stack's main axis but "stretch" across it.
 *
 * Sizing values:
 * - a number: fixed pixels,
 * - `"fill"`: take the available space,
 * - `"hug"`: fit the content (never stretched; otherwise placed by the parent's `align`),
 * - `"auto"` (the node didn't say and its plugin has no default): fit the content along a
 *   stack's main axis, follow the parent's `align` across it (like CSS `auto`).
 */
import {
  type AnchorEdge,
  type FrameNode,
  isFreeLayer,
  type Layout,
  type MotionState,
  type Node,
  type Padding,
  resolveMotion,
  type Sizing,
  type Space,
} from "@veloce/core";
import {
  type AssetUrlResolver,
  cssBorder,
  cssLength,
  cssPaint,
  cssShadow,
} from "@veloce/plugin-api";

export type CssRecord = Record<string, string>;
export type ResolvedSizing = Sizing | "auto";

const FLEX_ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const FLEX_JUSTIFY = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  "space-between": "space-between",
  "space-around": "space-around",
  "space-evenly": "space-evenly",
};

export function paddingSides(padding: Padding | undefined): [string, string, string, string] {
  const len = (v: Space | undefined) => (v === undefined ? "0px" : cssLength(v));
  if (padding === undefined) return ["0px", "0px", "0px", "0px"];
  if (typeof padding === "number" || typeof padding === "string") {
    const v = len(padding);
    return [v, v, v, v];
  }
  if ("x" in padding || "y" in padding) {
    const p = padding as { x?: Space; y?: Space };
    return [len(p.y), len(p.x), len(p.y), len(p.x)];
  }
  const p = padding as { top?: Space; right?: Space; bottom?: Space; left?: Space };
  return [len(p.top), len(p.right), len(p.bottom), len(p.left)];
}

/** CSS a frame applies to lay out its own children. */
export function frameLayoutCss(layout: Layout): CssRecord {
  const padding = paddingSides(layout.padding).join(" ");
  switch (layout.mode) {
    case "stack":
      return {
        display: "flex",
        "flex-direction": layout.direction ?? "column",
        "flex-wrap": layout.wrap ? "wrap" : "nowrap",
        gap: layout.gap === undefined ? "0px" : cssLength(layout.gap),
        padding,
        "align-items": FLEX_ALIGN[layout.align ?? "stretch"],
        "justify-content": FLEX_JUSTIFY[layout.justify ?? "start"],
      };
    case "grid": {
      const gap = layout.gap === undefined ? "0px" : cssLength(layout.gap);
      return {
        display: "grid",
        "grid-template-columns": `repeat(${layout.columns}, minmax(0, 1fr))`,
        "column-gap": gap,
        "row-gap": layout.rowGap === undefined ? gap : cssLength(layout.rowGap),
        padding,
        "align-items": FLEX_ALIGN[layout.align ?? "stretch"],
        "justify-items": FLEX_ALIGN[layout.justify ?? "stretch"],
      };
    }
    case "absolute":
      // Free children are measured from the frame's edges; padding only spaces a flow.
      return { display: "block", padding: "0px" };
  }
}

/**
 * A frame's 3D space (2.5D, D112): `perspective` puts its children's depth and 3D turns in
 * view, with the vanishing point at its centre. Without `preserve-3d`, each child is drawn
 * in its own plane and painted in layer order, so depth never re-sorts the stack.
 */
export function frameSpaceCss(node: FrameNode): CssRecord {
  return node.perspective === undefined ? {} : { perspective: `${node.perspective}px` };
}

/** A frame's visual style: fill, stroke, corner radius, shadow, clipping. */
export function frameStyleCss(node: FrameNode, assetUrl: AssetUrlResolver): CssRecord {
  const css: CssRecord = {};
  const style = node.style;
  if (!style) return css;
  if (style.fill !== undefined) css.background = cssPaint(style.fill, assetUrl);
  // Strokes are drawn inside the frame's edge without taking room (Figma): an inset outline,
  // not a border, so adding a stroke never moves or squeezes the content.
  if (style.stroke !== undefined) {
    css.outline = cssBorder(style.stroke);
    css["outline-offset"] = `${-style.stroke.width}px`;
  }
  if (style.radius !== undefined) css["border-radius"] = cssLength(style.radius);
  if (style.shadow !== undefined) css["box-shadow"] = cssShadow(style.shadow);
  if (style.clip) css.overflow = "hidden";
  return css;
}

/**
 * Size and placement of a node inside its parent. `parent` is the parent frame's layout,
 * or `null` for a slide's root frame (which always fills the stage).
 *
 * `motion` draws the node away from that rest position (D83 §5, D103): it only changes the
 * node's `transform`, `opacity` and `filter` (see `drawnCss`), never its layout.
 */
export function nodeBoxCss(
  node: Node,
  parent: Layout | null,
  size: { width: ResolvedSizing; height: ResolvedSizing },
  motion?: MotionState,
): CssRecord {
  const css: CssRecord = { "box-sizing": "border-box", "min-width": "0", "min-height": "0" };
  if (node.hidden) css.display = "none";
  /** A centred anchor's shift back by half the box's own size, if any. */
  let shift: string | null = null;

  if (parent === null) {
    Object.assign(css, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
    });
  } else if (isFreeLayer(node, parent)) {
    // Free layers (every child of an absolute frame, `positioning: "free"` ones in stacks and
    // grids) sit at their own position. Absolutely positioned children don't take part in
    // flexbox or grid placement, so the flow closes up around them.
    // Measured from the frame's edges, not its padding (which only spaces the flow), with
    // `anchor` picking the edge on each axis (core's anchor.ts): start → left/top,
    // end → right/bottom (inward), center → from the frame's middle.
    const x = node.position?.x ?? 0;
    const y = node.position?.y ?? 0;
    css.position = "absolute";
    const h = anchorCss(node.anchor?.x ?? "start", x, ["left", "right"]);
    const v = anchorCss(node.anchor?.y ?? "start", y, ["top", "bottom"]);
    Object.assign(css, h.css, v.css);
    if (h.center || v.center) {
      shift = `translate(${h.center ? "-50%" : "0"}, ${v.center ? "-50%" : "0"})`;
    }
    css.width = absoluteSize(size.width, h.inset, "max-content");
    css.height = absoluteSize(size.height, v.inset, "auto");
  } else {
    css.position = "relative";
    switch (parent.mode) {
      case "stack": {
        const row = (parent.direction ?? "column") === "row";
        const [main, cross] = row ? (["width", "height"] as const) : (["height", "width"] as const);
        const align = parent.align ?? "stretch";
        Object.assign(css, mainAxis(main, size[main]), crossAxis(cross, size[cross], align));
        // Main-axis "auto"/"hug" items may still shrink to fit (down to their min-content size).
        if (size[main] === "hug" || size[main] === "auto") css[`min-${main}`] = "auto";
        break;
      }
      case "grid":
        Object.assign(
          css,
          gridAxis("width", size.width, parent.justify ?? "stretch"),
          gridAxis("height", size.height, parent.align ?? "stretch"),
        );
        break;
      case "absolute":
        break; // unreachable: every child of an absolute frame is free (handled above)
    }
  }
  return Object.assign(css, drawnCss(node, shift, motion));
}

/** The properties motion may change (`SlideRenderer.setMotion` rewrites only these). */
export const MOTION_PROPERTIES = ["transform", "opacity", "filter"] as const;

/**
 * How a node is drawn on top of its layout: its rotation, a centred anchor's `shift`, its
 * opacity, and its motion. Only properties that aren't at their default are returned, so a
 * node at rest gets exactly the CSS it had before motion existed.
 *
 * The transform reads right to left (the rightmost function applies first, all about the
 * box's centre): scale and the 3D flips act along the layer's own axes, then its rotation
 * (its own plus the motion's), then the motion's move along the frame's axes, then the
 * anchor's shift, a plain translate. So a rotated sticker moves where you'd expect, scales
 * along its own edges and stays centred on its anchor, the order motion tools use.
 */
export function drawnCss(node: Node, shift: string | null, motion?: MotionState): CssRecord {
  const m = resolveMotion(motion);
  const css: CssRecord = {};
  const parts: string[] = [];
  if (shift) parts.push(shift);
  // Depth (2.5D, D112) rests where the document puts it; motion's `z` moves it from there.
  const z = (node.depth ?? 0) + m.z;
  if (z !== 0) {
    parts.push(`translate3d(${num(m.x)}px, ${num(m.y)}px, ${m.z === 0 ? z : num(z)}px)`);
  } else if (m.x !== 0 || m.y !== 0) parts.push(`translate(${num(m.x)}px, ${num(m.y)}px)`);
  // Values from the document alone stay exact (a node at rest gets the CSS it always had).
  const rotation = (node.rotation ?? 0) + m.rotate;
  if (rotation !== 0) parts.push(`rotate(${m.rotate === 0 ? rotation : num(rotation)}deg)`);
  if (m.rotateY !== 0) parts.push(`rotateY(${num(m.rotateY)}deg)`);
  if (m.rotateX !== 0) parts.push(`rotateX(${num(m.rotateX)}deg)`);
  const sx = m.scale * m.scaleX;
  const sy = m.scale * m.scaleY;
  if (sx !== 1 || sy !== 1)
    parts.push(sx === sy ? `scale(${num(sx)})` : `scale(${num(sx)}, ${num(sy)})`);
  if (parts.length > 0) css.transform = parts.join(" ");

  const opacity = (node.opacity ?? 1) * m.opacity;
  if (opacity < 1) css.opacity = m.opacity === 1 ? String(opacity) : num(opacity);
  if (m.blur > 0) css.filter = `blur(${num(m.blur)}px)`;
  return css;
}

/** A number for CSS: at most 4 decimals, so strings stay short and stable across frames. */
function num(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

/** One axis of a free layer's placement for its anchor edge. */
function anchorCss(
  edge: AnchorEdge,
  offset: number,
  [start, end]: [string, string],
): { css: CssRecord; center: boolean; inset: number } {
  if (edge === "end") return { css: { [end]: `${offset}px` }, center: false, inset: offset };
  // Centred: from the frame's middle; "fill" stays inside on both sides of the shifted centre.
  if (edge === "center") {
    return {
      css: { [start]: `calc(50% + ${offset}px)` },
      center: true,
      inset: 2 * Math.abs(offset),
    };
  }
  return { css: { [start]: `${offset}px` }, center: false, inset: offset };
}

/** Free layers' sizes: `"fill"` takes the frame minus the layer's inset from its anchored edge. */
function absoluteSize(v: ResolvedSizing, inset: number, fit: string): string {
  if (typeof v === "number") return `${v}px`;
  if (v === "fill") return `calc(100% - ${inset}px)`;
  return fit;
}

function mainAxis(axis: "width" | "height", v: ResolvedSizing): CssRecord {
  if (typeof v === "number") return { flex: `0 0 ${v}px`, [axis]: `${v}px` };
  if (v === "fill") return { flex: "1 1 0px" };
  return { flex: "0 1 auto" };
}

type Align = keyof typeof FLEX_ALIGN;

/** Hug fits its content and follows the parent's `align`; only "stretch" falls back to start. */
function crossAxis(axis: "width" | "height", v: ResolvedSizing, parentAlign: Align): CssRecord {
  if (typeof v === "number") return { [axis]: `${v}px` };
  if (v === "fill") return { "align-self": "stretch" };
  if (v === "hug") {
    return parentAlign === "stretch"
      ? { "align-self": "flex-start", [axis]: "fit-content" }
      : { [axis]: "fit-content" };
  }
  return {}; // auto: follow the parent's align-items
}

function gridAxis(axis: "width" | "height", v: ResolvedSizing, parentAlign: Align): CssRecord {
  const self = axis === "width" ? "justify-self" : "align-self";
  if (typeof v === "number") return { [axis]: `${v}px` };
  if (v === "fill") return { [self]: "stretch" };
  if (v === "hug") return parentAlign === "stretch" ? { [self]: "start" } : {};
  return {};
}

/** Replace an element's inline style with `css`. `setProperty` per declaration means a value
 *  can never smuggle in extra declarations. */
export function applyCss(el: HTMLElement, css: CssRecord): void {
  el.style.cssText = "";
  for (const [property, value] of Object.entries(css)) el.style.setProperty(property, value);
}
