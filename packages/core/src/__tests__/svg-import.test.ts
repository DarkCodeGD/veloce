/**
 * SVG import (D127 §4): hostile files are refused or defused, real ones (an icon set's icon,
 * a design tool's export) become vector layers with only validated data in them.
 */
import { describe, expect, it } from "vitest";
import type { ElementNode, FrameNode } from "../schema/node.js";
import { PaintSchema, StrokeSchema } from "../schema/paint.js";
import { parsePathData } from "../vector/path-data.js";
import { PathDataSchema } from "../vector/schema.js";
import { importSvg, looksLikeSvg, type SvgImportOptions } from "../vector/svg.js";
import { MAX_SVG_DEPTH, MAX_SVG_LENGTH, parseXml } from "../vector/xml.js";

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

function imported(text: string, options?: SvgImportOptions) {
  const r = importSvg(text, options);
  if (!r.ok) throw new Error(r.message);
  return r;
}
const vector = (text: string, options?: SvgImportOptions) => {
  const r = imported(text, options);
  expect(r.node.kind).toBe("element");
  return { ...r, node: r.node as ElementNode };
};
const frameOf = (text: string, options?: SvgImportOptions) => {
  const r = imported(text, options);
  expect(r.node.kind).toBe("frame");
  return { ...r, node: r.node as FrameNode };
};

/** Every vector in the result carries only data our schemas accept. */
function expectValid(node: ElementNode | FrameNode) {
  const vectors = node.kind === "frame" ? (node.children as ElementNode[]) : [node];
  for (const v of vectors) {
    expect(v.type).toBe("vector");
    expect(PathDataSchema.safeParse(v.props.d).success).toBe(true);
    expect(PaintSchema.safeParse(v.props.fill).success).toBe(true);
    if (v.props.stroke) expect(StrokeSchema.safeParse(v.props.stroke).success).toBe(true);
  }
}

describe("hostile SVGs (D127 §4)", () => {
  it("refuses a DOCTYPE: no entity can be declared, so none can expand or fetch", () => {
    const laughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">]>
<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1" stroke="&lol2;"/></svg>`;
    const r = importSvg(laughs);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/DOCTYPE/);
    const xxe = `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>`;
    expect(importSvg(xxe).ok).toBe(false);
  });

  it("refuses an entity it doesn't know, and decodes the built-in ones", () => {
    const r = importSvg(svg('<path d="M0 0 L10 10" fill="&secret;"/>'));
    expect(!r.ok && r.message).toMatch(/&secret;/);
    const ok = parseXml('<svg a="&lt;&amp;&#65;&#x42;"/>');
    expect(ok.ok && ok.root.attrs.get("a")).toBe("<&AB");
  });

  it("caps size and depth", () => {
    expect(parseXml(" ".repeat(MAX_SVG_LENGTH + 1)).ok).toBe(false);
    const deep = `${"<g>".repeat(MAX_SVG_DEPTH + 1)}${"</g>".repeat(MAX_SVG_DEPTH + 1)}`;
    const r = parseXml(`<svg>${deep}</svg>`);
    expect(!r.ok && r.message).toMatch(/levels deep/);
  });

  it("leaves out scripts, handlers, links and foreign content, keeps the drawing, says what", () => {
    const r = vector(
      svg(`<script>if (a<b) { fetch("https://evil.example") }</script>
      <style>path { fill: red }</style>
      <a href="javascript:alert(1)"><path d="M0 0 H100 V100 H0 Z" onclick="alert(1)" fill="#336699"/></a>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
      <image href="https://evil.example/x.png"/><use href="#p"/><text>Hello</text>`),
    );
    expect(r.node.props.d).toBe("M0 0L100 0L100 100L0 100Z");
    expect(r.leftOut.join(" | ")).toMatch(/<script>.*scripts never run/);
    for (const what of [
      "<style>",
      "event handlers",
      "<a>",
      "<foreignObject>",
      "<image>",
      "<use>",
      "<text>",
    ]) {
      expect(r.leftOut.join(" | ")).toContain(what);
    }
    // Nothing from the file but the path and the color reaches the document.
    const json = JSON.stringify(r.node);
    for (const bad of ["javascript", "alert", "evil", "onclick", "<"]) {
      expect(json).not.toContain(bad);
    }
  });

  it("merges thousands of same-colored shapes fast, into paths within the limits", () => {
    const body = Array.from(
      { length: 6000 },
      (_, k) =>
        `<path d="M${k % 100}.123456 ${Math.floor(k / 100)}.123456 h0.5 v0.5 z" fill="#123"/>`,
    ).join("");
    const started = performance.now();
    const r = frameOf(svg(body));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(r.node.children.length).toBeGreaterThan(1); // split where a path would get too long
    for (const child of r.node.children as ElementNode[]) {
      expect(String(child.props.d).length).toBeLessThanOrEqual(20_000);
    }
    expectValid(r.node);
  });

  it("explains a file that isn't XML, or that draws nothing", () => {
    expect(importSvg("<svg><path></svg>").ok).toBe(false);
    expect(importSvg("hello").ok).toBe(false);
    const empty = importSvg(svg("<text>Only words</text>"));
    expect(!empty.ok && empty.message).toMatch(/Nothing in this SVG/);
    expect(!empty.ok && empty.leftOut).toEqual(["<text>: add text as text layers"]);
  });
});

describe("importing real SVGs (D127 §4)", () => {
  // Lucide's "rocket"-style shape: stroked, no fill, currentColor, set on the root.
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    class="lucide lucide-check"><path d="M20 6 9 17l-5-5"/><circle cx="12" cy="12" r="10"/></svg>`;

  it("an outline icon is one vector that follows the theme, at the size asked for", () => {
    const r = vector(icon, { width: 96 });
    expect(r.leftOut).toEqual([]);
    expect(r.node).toMatchObject({ width: 96, height: 96, name: "SVG" });
    expect(r.node.props).toMatchObject({
      viewBox: { x: 0, y: 0, width: 24, height: 24 },
      fill: "transparent",
      stroke: { color: "$color.text", width: 8 }, // 2 units at 4× is 8 px
      cap: "round",
      join: "round",
    });
    expectValid(r.node);
    // Its own size when none is asked for; currentColor can be any color.
    expect(vector(icon, { currentColor: "$color.primary" }).node).toMatchObject({
      width: 24,
      props: { stroke: { color: "$color.primary", width: 2 } },
    });
  });

  it("a multi-color logo is a Free frame of vectors, each where it was", () => {
    const r = frameOf(
      svg(
        `<rect x="10" y="10" width="30" height="20" fill="#ff0000"/>
         <circle cx="70" cy="70" r="10" fill="#0000ff" stroke="#000" stroke-width="4"/>`,
      ),
      { width: 200 },
    );
    expect(r.node).toMatchObject({ layout: { mode: "absolute" }, width: 200, height: 200 });
    const [rect, dot] = r.node.children as ElementNode[];
    expect(rect).toMatchObject({ position: { x: 20, y: 20 }, width: 60, height: 40 });
    expect(rect?.props).toMatchObject({ fill: "#ff0000", fit: "stretch" });
    // The stroke's half width is inside the box: 70 − 10 − 2 = 58 → 116 px.
    expect(dot).toMatchObject({ position: { x: 116, y: 116 }, width: 48, height: 48 });
    expect(dot?.props).toMatchObject({ stroke: { color: "#000000", width: 8 } });
    expect(dot?.props.viewBox).toEqual({ x: 58, y: 58, width: 24, height: 24 });
    expectValid(r.node);
  });

  it("merges neighbours that look the same, keeps apart the ones that don't", () => {
    const r = frameOf(
      svg(
        `<path d="M0 0 H10 V10 Z" fill="#111"/><path d="M20 0 H30 V10 Z" fill="#111"/>
         <path d="M40 0 H50 V10 Z" fill="#222"/>`,
      ),
    );
    expect(r.node.children).toHaveLength(2);
    expect((r.node.children[0] as ElementNode).props.d).toBe("M0 0L10 0L10 10ZM20 0L30 0L30 10Z");
  });

  it("draws every basic shape as a path", () => {
    const d = (body: string) => String(vector(svg(body)).node.props.d);
    expect(d('<rect x="0" y="0" width="10" height="10" rx="2"/>')).toMatch(
      /^M2 0L8 0A2 2 0 0 1 10 2/,
    );
    expect(d('<ellipse cx="50" cy="50" rx="40" ry="20"/>')).toBe(
      "M10 50A40 20 0 0 1 90 50A40 20 0 0 1 10 50Z",
    );
    expect(d('<polygon points="0,0 10,0 5,8"/>')).toBe("M0 0L10 0L5 8Z");
    expect(d('<polyline points="0 0 10 0 5 8" fill="none" stroke="#000"/>')).toBe("M0 0L10 0L5 8");
    const line = vector(svg('<line x1="0" y1="0" x2="10" y2="10" stroke="#000"/>')).node;
    expect(line.props).toMatchObject({ d: "M0 0L10 10", fill: "transparent" }); // lines don't fill
  });

  it("applies group transforms, nested ones in order", () => {
    const r = vector(
      svg('<g transform="translate(10 20)"><g transform="scale(2)"><path d="M0 0 L5 5"/></g></g>'),
    );
    expect(r.node.props.d).toBe("M10 20L20 30");
    const turned = vector(
      svg('<path transform="rotate(90 50 50)" d="M50 0 A50 50 0 0 1 100 50"/>'),
    );
    const segments = parsePathData(String(turned.node.props.d));
    expect(segments.ok && segments.segments.slice(1).every((s) => s.type === "C")).toBe(true);
  });

  it("turns opacity into alpha, and keeps a theme color a token at an opacity", () => {
    const r = vector(
      svg('<g opacity="0.5"><path d="M0 0 H10 V10 Z" fill="#ff0000" fill-opacity="0.5"/></g>'),
    );
    expect(r.node.props.fill).toBe("#ff000040"); // 25%
    const current = vector(svg('<path d="M0 0 H10 V10 Z" fill="currentColor" opacity=".3"/>'));
    expect(current.node.props.fill).toBe("$color.text/30");
    const styled = vector(
      svg(
        '<path d="M0 0 H10 V10 Z" fill="#000" style="fill: rgb(0, 128, 255); fill-rule: evenodd"/>',
      ),
    );
    expect(styled.node.props).toMatchObject({ fill: "#0080ff", fillRule: "evenodd" });
  });

  it("turns gradients into our paint, in the shape's own box (Figma's user-space ones too)", () => {
    const bbox = vector(
      svg(`<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="100%" stop-color="#00f" stop-opacity="0.5"/></linearGradient></defs>
      <rect width="100" height="50" fill="url(#g)"/>`),
    );
    expect(bbox.node.props.fill).toEqual({
      type: "linear-gradient",
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff80" },
      ],
    });
    // Figma: userSpaceOnUse, top to bottom across a shape at (10, 10) 80 × 40.
    const figma = vector(
      svg(`<rect x="10" y="10" width="80" height="40" fill="url(#f)"/>
      <defs><linearGradient id="f" x1="50" y1="10" x2="50" y2="50" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111"/><stop offset="1" stop-color="#eee"/></linearGradient></defs>`),
    );
    expect(figma.node.props.fill).toMatchObject({ type: "linear-gradient", angle: 180 });
    expect(figma.node.props.fill).not.toHaveProperty("start");
    const radial = vector(
      svg(`<radialGradient id="r" cx="0.3" cy="0.3" r="0.5"><stop stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
      <circle cx="50" cy="50" r="50" fill="url(#r)"/>`),
    );
    expect(radial.node.props.fill).toMatchObject({
      type: "radial-gradient",
      center: { x: 0.3, y: 0.3 },
      radius: { x: 0.5, y: 0.5 },
    });
    expectValid(radial.node);
  });

  it("skips what isn't shown and an editor's own data, quietly", () => {
    const r = vector(
      svg(`<title>Logo</title><desc>x</desc><metadata/>
      <sodipodi:namedview xmlns:sodipodi="x" pagecolor="#fff"/>
      <path d="M0 0 H10 V10 Z" display="none"/>
      <g visibility="hidden"><path d="M0 0 H20 V20 Z"/><path d="M0 0 H30 V30 Z" visibility="visible" fill="#123456"/></g>`),
    );
    expect(r.leftOut).toEqual([]);
    expect(r.node.props).toMatchObject({ d: "M0 0L30 0L30 30Z", fill: "#123456" });
  });

  it("tells pasted SVG text from other text", () => {
    expect(looksLikeSvg(icon)).toBe(true);
    expect(
      looksLikeSvg('<?xml version="1.0"?>\n<!-- made in X -->\n<svg viewBox="0 0 1 1"/>'),
    ).toBe(true);
    expect(looksLikeSvg("<div><svg/></div>")).toBe(false);
    expect(looksLikeSvg("Use an <svg> for icons")).toBe(false);
  });
});
