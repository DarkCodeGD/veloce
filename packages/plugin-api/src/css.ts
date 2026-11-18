/**
 * Turning document values (colors, paints, tokens) into CSS, the same way in every plugin.
 * Tokens become `var(--v-…)` references, so a theme switch restyles without re-rendering.
 */
import {
  type Color,
  isTokenRef,
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

export function cssColor(color: Color): string {
  return isTokenRef(color) ? tokenCssVar(color) : color;
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
    case "linear-gradient":
      return `linear-gradient(${paint.angle ?? 180}deg, ${gradientStops(paint.stops)})`;
    case "radial-gradient": {
      const { x, y } = paint.center ?? { x: 0.5, y: 0.5 };
      // farthest-side: offset 1 reaches the box edges, so a centered gradient ends exactly at
      // an ellipse shape's outline (CSS's default, farthest-corner, ends outside it).
      return `radial-gradient(ellipse farthest-side at ${x * 100}% ${y * 100}%, ${gradientStops(paint.stops)})`;
    }
    case "image": {
      const url = cssUrl(assetUrl(paint.asset.slice("asset:".length)));
      const fit = paint.fit ?? "cover";
      if (fit === "tile") return `${url} repeat`;
      return `${url} center / ${fit === "fill" ? "100% 100%" : fit} no-repeat`;
    }
  }
}

function gradientStops(stops: ReadonlyArray<{ offset: number; color: Color }>): string {
  return stops.map((s) => `${cssColor(s.color)} ${s.offset * 100}%`).join(", ");
}

/** `url("…")` with the URL safely quoted. */
export function cssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}
