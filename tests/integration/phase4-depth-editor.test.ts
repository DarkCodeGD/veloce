/**
 * Phase 4 acceptance (2.5D in the editor, D112): a person gives the slide a perspective and a
 * layer a depth in the inspector, each one undoable edit, and the layer is drawn nearer
 * (bigger). Dragging that deep layer keeps it under the cursor: the drag divides the drawn
 * movement by the depth's magnification before it becomes `position`. Real Chromium against
 * the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Depth", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "absolute" },
        children: [
          {
            id: "card",
            name: "Card",
            type: "shape",
            width: 200,
            height: 200,
            position: { x: 560, y: 340 },
            props: { shape: "rect", fill: "$color.primary" },
          },
        ],
      },
    },
  });
}

const input = (name: string) => page.getByRole("spinbutton", { name, exact: true });
async function centre(id: string) {
  const b = await page.locator(`.editor-canvas [data-node-id="${id}"]`).boundingBox();
  if (!b) throw new Error(`${id} not on the canvas`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, width: b.width };
}
const scale = () =>
  page
    .locator(".editor-canvas .slide-surface")
    .evaluate((el) => el.getBoundingClientRect().width / 1920);

async function oneStep(action: () => Promise<void>) {
  const before = h.userTransactions();
  await action();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='card']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 4: 2.5D in the editor", { timeout: 60_000 }, () => {
  it("sets the slide's perspective and a layer's depth in the inspector", async () => {
    const s = await scale();
    await oneStep(async () => {
      await input("Perspective").fill("1000");
      await input("Perspective").press("Enter");
    });
    expect(h.latestDeck().slides[0]?.root.perspective).toBe(1000);

    await page.getByRole("tab", { name: "Layers" }).click();
    await page.getByRole("button", { name: "Card", exact: true }).click();
    await oneStep(async () => {
      await input("Depth").fill("200");
      await input("Depth").press("Enter");
    });
    expect(h.stored("card").depth).toBe(200);
    // Depth 200 in perspective 1000: drawn 1.25× (200 → 250 slide pixels).
    await expect.poll(async () => (await centre("card")).width / s).toBeCloseTo(250, 0);
  });

  it("keeps a deep layer under the cursor while it's dragged", async () => {
    const s = await scale();
    const from = await centre("card");
    const to = { x: from.x + 250 * s, y: from.y + 125 * s };
    await oneStep(async () => {
      await page.keyboard.down("Alt"); // no snapping: the exact drawn delta
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 10 });
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.keyboard.up("Alt");
    });
    // 250 drawn pixels at 1.25× is 200 of position; the card ends where the cursor let go.
    expect(h.stored("card").position).toEqual({ x: 760, y: 440 });
    const now = await centre("card");
    expect(Math.abs(now.x - to.x)).toBeLessThan(2);
    expect(Math.abs(now.y - to.y)).toBeLessThan(2);
  });
});
