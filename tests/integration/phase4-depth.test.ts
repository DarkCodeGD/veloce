/**
 * Phase 4 (2.5D, D112): a frame's `perspective` and a layer's `depth`, drawn with the
 * renderer's own CSS in real Chromium and checked by where pixels land:
 * - a layer at depth d in perspective p is drawn p / (p − d) times bigger, around the
 *   frame's centre (the vanishing point);
 * - moving its `position` moves it that many times further on screen, the factor the
 *   editor's drags divide by so a layer stays under the cursor (`toLayerSpace`);
 * - depth never re-sorts the stack: the layer order decides what's in front;
 * - motion's `z` adds to the rest depth.
 *
 * Needs headless Chromium (skipped locally without it, required in CI).
 */
import { element, frame, type MotionState, type Node } from "@veloce/core";
import { frameSpaceCss, nodeBoxCss } from "@veloce/renderer";
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

const css = (record: Record<string, string>) =>
  Object.entries(record)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

/** Free 200×100 layers in a 1000×800 absolute frame with `perspective`; their screen boxes. */
async function draw(
  perspective: number | undefined,
  layers: { node: Node; motion?: MotionState }[],
) {
  const space = frameSpaceCss(
    frame({ id: "f", layout: { mode: "absolute" }, ...(perspective && { perspective }) }),
  );
  const html = layers
    .map(({ node, motion }) => {
      const box = nodeBoxCss(node, { mode: "absolute" }, { width: 200, height: 100 }, motion);
      return `<div id="${node.id}" style="${css(box)};background:#f0f"></div>`;
    })
    .join("");
  await page.setContent(
    `<div id="frame" style="position:relative;width:1000px;height:800px;margin:0;${css(space)}">${html}</div>`,
  );
  return page.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((id) => {
          const f = document.getElementById("frame")?.getBoundingClientRect();
          const r = document.getElementById(id)?.getBoundingClientRect();
          if (!f || !r) throw new Error("not drawn");
          return [
            id,
            { cx: r.left + r.width / 2 - f.left, cy: r.top + r.height / 2 - f.top, width: r.width },
          ];
        }),
      ),
    layers.map((l) => l.node.id),
  );
}

/** A layer centred at (cx, cy) in the frame. */
const layer = (id: string, cx: number, cy: number, extra: Partial<Node> = {}) =>
  element("shape", { shape: "rect" }, { id, position: { x: cx - 100, y: cy - 50 }, ...extra });

describe.skipIf(browser === null)("Phase 4: 2.5D depth and perspective (D112)", () => {
  it("draws a nearer layer bigger, away from the vanishing point, by p / (p − depth)", async () => {
    // Frame centre (500, 400). 200 px from it at depth 200 in perspective 1000: 1.25×.
    const { near } = await draw(1000, [{ node: layer("near", 700, 400, { depth: 200 }) }]);
    expect(near?.width).toBeCloseTo(250, 1);
    expect(near?.cx).toBeCloseTo(750, 1);
    expect(near?.cy).toBeCloseTo(400, 1);
    const { far } = await draw(1000, [{ node: layer("far", 700, 400, { depth: -1000 }) }]);
    expect(far?.width).toBeCloseTo(100, 1); // twice as far: half the size, halfway in
    expect(far?.cx).toBeCloseTo(600, 1);
  });

  it("shows no depth without a perspective, and adds motion's z to the rest depth", async () => {
    const { flat } = await draw(undefined, [{ node: layer("flat", 700, 400, { depth: 200 }) }]);
    expect(flat?.width).toBeCloseTo(200, 1);
    const { both } = await draw(1000, [
      { node: layer("both", 500, 400, { depth: 300 }), motion: { z: 200 } },
    ]);
    expect(both?.width).toBeCloseTo(400, 1); // depth 500 in 1000: 2×
  });

  it("moves a layer at depth k times further on screen than its position moved", async () => {
    const before = (await draw(1000, [{ node: layer("a", 400, 300, { depth: 200 }) }])).a;
    const after = (await draw(1000, [{ node: layer("a", 500, 300, { depth: 200 }) }])).a;
    expect((after?.cx ?? 0) - (before?.cx ?? 0)).toBeCloseTo(125, 1);
  });

  it("keeps the layer order in front, whatever the depth", async () => {
    await draw(1000, [
      { node: layer("first", 500, 400, { depth: 400 }) }, // nearer, but earlier in the stack
      { node: layer("second", 500, 400, { depth: -400 }) },
    ]);
    const top = await page.evaluate(() => {
      const f = document.getElementById("frame")?.getBoundingClientRect();
      return f ? document.elementFromPoint(f.left + 500, f.top + 400)?.id : null;
    });
    expect(top).toBe("second");
  });
});
