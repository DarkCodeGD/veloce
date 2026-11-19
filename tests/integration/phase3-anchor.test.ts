/**
 * Phase 3, round 4 acceptance (anchors, D57; frame edges and strokes, D58): a free layer pinned
 * to its frame's right edge
 * renders at the same inset whatever the frame's size or its own text; dragging it moves it
 * with the pointer (its position counts from the right); Pin X in the inspector switches the
 * anchor without moving it. Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** Two cards in a row (600 and 900 wide), each with a badge pinned 16px from its top-right. */
async function build(agent: Client) {
  const card = (id: string, width: number, badge: string, label: string, stroke = 0) => ({
    id,
    name: id,
    width,
    height: 300,
    layout: { mode: "stack", padding: 24 },
    style: {
      fill: "$color.surface",
      ...(stroke ? { stroke: { color: "$color.primary", width: stroke } } : {}),
    },
    children: [
      { id: `${id}-title`, type: "text", props: { content: "Plan", style: "$text.h3" } },
      {
        id: badge,
        name: badge,
        type: "text",
        props: { content: label, style: "$text.small" },
        width: "hug",
        positioning: "free",
        anchor: { x: "end" },
        position: { x: 16, y: 16 },
      },
    ],
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Pins", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", direction: "row", padding: 60, gap: 40, align: "start" },
        children: [card("small", 600, "Hot", "New"), card("wide", 900, "Sale", "Limited offer", 6)],
      },
    },
  });
}

const layer = (id: string) => page.locator(`.editor-canvas [data-node-id="${id}"]`);
async function box(id: string) {
  const b = await layer(id).boundingBox();
  if (!b) throw new Error(`${id} not on the canvas`);
  return b;
}
const scale = () =>
  page
    .locator(".editor-canvas .slide-surface")
    .evaluate((el) => el.getBoundingClientRect().width / 1920);

/** How far the badge's right edge is inside its card's right edge, in slide pixels. */
async function rightInset(badge: string, card: string) {
  const [b, c, s] = [await box(badge), await box(card), await scale()];
  return (c.x + c.width - (b.x + b.width)) / s; // the card's padding plays no part
}

async function select(name: string) {
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe(name);
}

async function oneStep(action: () => Promise<void>) {
  const before = h.userTransactions();
  await action();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}
const undo = () => oneStep(() => page.keyboard.press("Control+z"));

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='Sale']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: anchors", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await page.keyboard.up("Alt");
    await h.synced();
  });

  it("pins badges to the top-right corner of cards of any width", async () => {
    expect(await rightInset("Hot", "small")).toBeCloseTo(16, 0);
    expect(await rightInset("Sale", "wide")).toBeCloseTo(16, 0); // longer text, wider card
    const s = await scale();
    const [hot, small] = [await box("Hot"), await box("small")];
    expect((hot.y - small.y) / s).toBeCloseTo(16, 0);
  });

  it("draws strokes without moving content: the stroked card's title still sits at its padding", async () => {
    const s = await scale();
    for (const id of ["small", "wide"]) {
      const [title, card] = [await box(`${id}-title`), await box(id)];
      expect((title.x - card.x) / s, id).toBeCloseTo(24, 0);
      expect((title.y - card.y) / s, id).toBeCloseTo(24, 0);
    }
  });

  it("drags a right-pinned layer with the pointer", async () => {
    await select("Hot");
    const before = await box("Hot");
    const s = await scale();
    const from = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await oneStep(async () => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.keyboard.down("Alt"); // no snapping
      await page.mouse.move(from.x - 60, from.y, { steps: 8 });
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.keyboard.up("Alt");
    });
    const after = await box("Hot");
    expect(after.x - before.x).toBeCloseTo(-60, 0);
    // 60 screen pixels further from the right edge, in slide pixels.
    expect(h.stored("Hot")).toMatchObject({ anchor: { x: "end" } });
    expect((h.stored("Hot").position?.x ?? 0) - 16).toBeCloseTo(60 / s, -0.5);
    await undo();
  });

  it("switches Pin X without moving the layer, and shows what X measures", async () => {
    await select("Sale");
    await expect
      .poll(() => page.locator(".inspector label", { hasText: "From right" }).count())
      .toBe(1);
    const before = await box("Sale");
    await oneStep(async () => {
      await page.getByRole("combobox", { name: "Pin X" }).click();
      await page.getByRole("option", { name: "Left" }).click();
    });
    expect(h.stored("Sale").anchor).toBeUndefined();
    expect(h.stored("Sale").position?.x).toBeGreaterThan(400); // now counted from the left
    const after = await box("Sale");
    expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);

    await oneStep(async () => {
      await page.getByRole("combobox", { name: "Pin X" }).click();
      await page.getByRole("option", { name: "Center" }).click();
    });
    expect(h.stored("Sale").anchor).toEqual({ x: "center" });
    const centered = await box("Sale");
    expect(Math.abs(centered.x - before.x)).toBeLessThan(1.5);
    await undo();
    await undo();
    expect(h.stored("Sale")).toMatchObject({ anchor: { x: "end" }, position: { x: 16, y: 16 } });
  });

  it("produces no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
