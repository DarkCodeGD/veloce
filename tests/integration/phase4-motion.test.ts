/**
 * Phase 4 (motion slot, D103): motion is drawn on top of a layer's rest position. Real
 * Chromium geometry for the CSS the renderer composes (`nodeBoxCss` with a motion), so the
 * order of the transform is proven by where pixels land, not by string comparison:
 * a move goes along the frame's axes even when the layer is rotated, scaling keeps a
 * centred anchor centred, and scaleX stretches along the layer's own axis.
 *
 * Needs headless Chromium (skipped locally without it, required in CI).
 */
import { element, type MotionState, type Node } from "@veloce/core";
import { nodeBoxCss } from "@veloce/renderer";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

async function launch(): Promise<Browser | null> {
  try {
    return await chromium.launch();
  } catch {
    if (process.env.VELOCE_REQUIRE_BROWSER) throw new Error("Browser tests required");
    return null;
  }
}
const browser = await launch();
let page: Page;

beforeAll(async () => {
  if (browser) page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
});
afterAll(async () => {
  await browser?.close();
});

/** A 200×100 layer in a 1000×800 frame, drawn with the renderer's CSS; its on-screen box. */
async function drawnBox(node: Node, motion?: MotionState, parent: "stack" | "free" = "free") {
  const css = nodeBoxCss(
    node,
    { mode: "stack", align: "start" },
    { width: 200, height: 100 },
    motion,
  );
  const style = Object.entries(css)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  await page.setContent(
    `<div id="frame" style="position:relative;display:flex;flex-direction:column;align-items:flex-start;width:1000px;height:800px;margin:0">
       ${parent === "stack" ? '<div style="height:300px;flex:none"></div>' : ""}
       <div id="layer" style="${style};background:#f0f"></div>
     </div>`,
  );
  return page.evaluate(() => {
    const frame = document.getElementById("frame")?.getBoundingClientRect();
    const r = document.getElementById("layer")?.getBoundingClientRect();
    if (!frame || !r) throw new Error("not drawn");
    return {
      cx: r.left + r.width / 2 - frame.left,
      cy: r.top + r.height / 2 - frame.top,
      width: r.width,
      height: r.height,
    };
  });
}

const sticker = element(
  "text",
  {},
  {
    id: "s",
    rotation: 30,
    positioning: "free",
    anchor: { x: "center", y: "center" },
    position: { x: 0, y: 0 },
  },
);

describe.skipIf(browser === null)("Phase 4: motion on top of the rest position", () => {
  it("keeps a rotated, centre-anchored layer centred while it scales and turns", async () => {
    const rest = await drawnBox(sticker);
    expect(rest.cx).toBeCloseTo(500, 1);
    expect(rest.cy).toBeCloseTo(400, 1);
    for (const motion of [{ scale: 2 }, { rotate: 60 }, { scale: 0.3, rotate: -45 }]) {
      const moved = await drawnBox(sticker, motion);
      expect(moved.cx).toBeCloseTo(500, 1);
      expect(moved.cy).toBeCloseTo(400, 1);
    }
  });

  it("moves along the frame's axes, by exactly x and y stage pixels, whatever the rotation", async () => {
    const moved = await drawnBox(sticker, { x: 50, y: 20 });
    expect(moved.cx).toBeCloseTo(550, 1);
    expect(moved.cy).toBeCloseTo(420, 1);

    // A layer in a stack's flow moves the same way, from wherever the flow put it.
    const inFlow = element("text", {}, { id: "f", rotation: 30 });
    const rest = await drawnBox(inFlow, undefined, "stack");
    const shifted = await drawnBox(inFlow, { x: -30, y: 15 }, "stack");
    expect(shifted.cx - rest.cx).toBeCloseTo(-30, 1);
    expect(shifted.cy - rest.cy).toBeCloseTo(15, 1);
  });

  it("stretches along the layer's own axis: scaleX on a layer turned 90° grows it vertically", async () => {
    const upright = element(
      "text",
      {},
      { id: "u", rotation: 90, positioning: "free", position: { x: 300, y: 300 } },
    );
    const rest = await drawnBox(upright);
    expect(rest.width).toBeCloseTo(100, 1); // 200×100 turned a quarter: 100 wide, 200 tall
    expect(rest.height).toBeCloseTo(200, 1);
    const stretched = await drawnBox(upright, { scaleX: 2 });
    expect(stretched.width).toBeCloseTo(100, 1);
    expect(stretched.height).toBeCloseTo(400, 1);
    expect(stretched.cx).toBeCloseTo(rest.cx, 1); // around its centre
    expect(stretched.cy).toBeCloseTo(rest.cy, 1);
  });

  it("fades with the layer's own opacity and blurs without moving the box", async () => {
    const faded = element("text", {}, { id: "o", opacity: 0.5, positioning: "free" });
    const css = nodeBoxCss(faded, { mode: "stack" }, { width: 200, height: 100 }, { opacity: 0.4 });
    expect(css.opacity).toBe("0.2");
    const rest = await drawnBox(faded);
    const blurred = await drawnBox(faded, { blur: 12 });
    expect(blurred).toEqual(rest); // filter doesn't change layout or the box
  });
});
