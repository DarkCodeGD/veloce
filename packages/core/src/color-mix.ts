/**
 * Colors in between (D114): how a color track travels from one keyframe to the next.
 *
 * Interpolated in **OKLab**, with alpha premultiplied, like CSS `color-mix()` and gradients
 * by default. OKLab is built so equal steps look equal: red to green passes through a warm
 * yellow-brown, not the muddy grey that mixing the raw sRGB numbers gives, and a fade to
 * `transparent` keeps its hue instead of darkening on the way out.
 */
import type { Rgba } from "./measure.js";

/** `a` at `t` 0, `b` at `t` 1 (clamped: a color can't overshoot). Channels 0–255, alpha 0–1. */
export function mixColors(a: Rgba, b: Rgba, t: number): Rgba {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const alpha = a[3] + (b[3] - a[3]) * t;
  if (alpha <= 0) return [0, 0, 0, 0];
  const la = toOklab(a);
  const lb = toOklab(b);
  // Premultiplied: each color counts as much as it's visible.
  const channel = (i: 0 | 1 | 2) => (la[i] * a[3] + (lb[i] * b[3] - la[i] * a[3]) * t) / alpha;
  const [r, g, bl] = fromOklab([channel(0), channel(1), channel(2)]);
  return [r, g, bl, alpha];
}

/** `#rrggbb`, or `#rrggbbaa` when not opaque: a color every document field accepts. */
export function rgbaToHex(color: Rgba): string {
  const hex = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  const alpha = Math.min(1, Math.max(0, color[3]));
  return `#${hex(color[0])}${hex(color[1])}${hex(color[2])}${alpha < 1 ? hex(alpha * 255) : ""}`;
}

type Lab = [number, number, number];

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, c * 255));
};

/** Björn Ottosson's OKLab, from sRGB through linear light and the LMS cone responses. */
function toOklab([r8, g8, b8]: Rgba): Lab {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
