/**
 * Turning document values (colors, paints, tokens) into CSS, the same way in every plugin.
 * Tokens become `var(--v-…)` references, so a theme switch restyles without re-rendering.
 */
import {
  type Color,
  colorCss,
  type Paint,
  type Radius,
  type ShadowValue,
  type Space,
  type Stroke,
  shadowToCss,
  tokenCssVar,
} from "@veloce/core";

/** Asset ID → URL, as provided by `ElementContext.assetUrl`. */
export type AssetUrlResolver = (assetId: string) => string;

/** A document color as CSS: tokens (at an opacity too, `$color.x/30`) become theme variables. */
export function cssColor(color: Color): string {
  return colorCss(color);
}

/** Pixels or a `$space.*` / `$radius.*` token. */
export function cssLength(value: Space | Radius): string {
  return typeof value === "number" ? `${value}px` : tokenCssVar(value);
}

export function cssShadow(value: ShadowValue): string {
  return typeof value === "string" ? tokenCssVar(value) : shadowToCss(value);
}

export function cssBorder(stroke: Stroke): string {
  return `${stroke.width}px ${stroke.style ?? "solid"} ${cssColor(stroke.color)}`;
}

/** A value for the CSS `background` shorthand. */
export function cssPaint(paint: Paint, assetUrl: AssetUrlResolver): string {
  if (typeof paint === "string") return cssColor(paint);
  switch (paint.type) {
    case "linear-gradient": {
      // Offsets 0 and 1 sit at `start` and `end` along CSS's gradient line (D88); CSS pads
      // past the outer stops itself.
      const start = paint.start ?? 0;
      const end = paint.end ?? 1;
      const along = start === 0 && end === 1 ? undefined : (o: number) => start + o * (end - start);
      return `linear-gradient(${paint.angle ?? 180}deg, ${gradientStops(paint.stops, along)})`;
    }
    case "radial-gradient": {
      const { x, y } = paint.center ?? { x: 0.5, y: 0.5 };
      // farthest-side: offset 1 reaches the box edges, so a centered gradient ends exactly at
      // an ellipse shape's outline (CSS's default, farthest-corner, ends outside it). A set
      // `radius` gives the ellipse's radii as percentages of the box (D88).
      const size = paint.radius
        ? `${pct(paint.radius.x)} ${pct(paint.radius.y)}`
        : "ellipse farthest-side";
      return `radial-gradient(${size} at ${pct(x)} ${pct(y)}, ${gradientStops(paint.stops)})`;
    }
    case "conic-gradient": {
      const { x, y } = paint.center ?? { x: 0.5, y: 0.5 };
      return `conic-gradient(from ${paint.angle ?? 0}deg at ${pct(x)} ${pct(y)}, ${gradientStops(paint.stops)})`;
    }
    case "image": {
      const url = cssUrl(assetUrl(paint.asset.slice("asset:".length)));
      const fit = paint.fit ?? "cover";
      if (fit === "tile") return `${url} repeat`;
      return `${url} center / ${fit === "fill" ? "100% 100%" : fit} no-repeat`;
    }
  }
}

/**
 * A slide background: `paint` over the theme's background color. A slide is never see-through,
 * so a translucent color, a gradient fading to transparent or a letterboxed image shows the
 * theme behind it, never whatever the page under the slide happens to be (white).
 */
export function cssSlideBackground(paint: Paint, assetUrl: AssetUrlResolver): string {
  const base = cssColor("$color.background");
  if (paint === "$color.background") return base;
  const css = cssPaint(paint, assetUrl);
  // Only the last layer may be a plain color: a color paint becomes a one-color image layer.
  const layer = typeof paint === "string" ? `linear-gradient(${css}, ${css})` : css;
  return `${layer}, ${base}`;
}

function gradientStops(
  stops: ReadonlyArray<{ offset: number; color: Color }>,
  along?: (offset: number) => number,
): string {
  return stops
    .map((s) => `${cssColor(s.color)} ${pct(along ? along(s.offset) : s.offset)}`)
    .join(", ");
}

/** A fraction as a CSS percentage, without float dust (`0.3 * 100` is `30.000000000000004`). */
function pct(fraction: number): string {
  return `${Math.round(fraction * 1e6) / 1e4 + 0}%`;
}

/** `url("…")` with the URL safely quoted. */
export function cssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}
