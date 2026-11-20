/**
 * Phase 3, round 4 acceptance (Layers panel drag and drop): drag rows to reorder, drop onto
 * a frame row to move a layer into it, pull a layer out of a frame by dragging left past its
 * last child, drop into a free frame without the layer moving on the slide, and Escape to
 * cancel. Real Chromium against the real server; every drop is exactly one transaction.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** The root column: Title, Card (a row of Left, Right), Board (free frame), Footer. */
async function build(agent: Client) {
  const text = (id: string, content: string) => ({
    id,
    name: content,
    type: "text",
    props: { content, style: "$text.h3" },
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Layers", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", padding: 60, gap: 24 },
        children: [
          text("title", "Title"),
          {
            id: "card",
            name: "Card",
            layout: { mode: "stack", direction: "row", gap: 24 },
            children: [text("left", "Left"), text("right", "Right")],
          },
          {
            id: "board",
            name: "Board",
            height: 360,
            layout: { mode: "absolute", padding: 20 },
            style: { fill: "$color.surface" },
            children: [],
          },
          text("foot", "Footer"),
        ],
      },
    },
  });
}

const rootId = () => h.latestDeck().slides[0]?.root.id ?? "";
const row = (id: string) => page.locator(`.layers [data-layer-id="${id}"]`);

/** A point over a row: `fraction` of the way down it, `x` px from the panel's left edge. */
async function over(id: string, fraction: number, x?: number) {
  const b = await row(id).boundingBox();
  const list = await page.locator(".layers").boundingBox();
  if (!b || !list) throw new Error(`row ${id} not shown`);
  return { x: x === undefined ? b.x + b.width / 2 : list.x + x, y: b.y + b.height * fraction };
}

/** Drag row `id` to `to` and release; resolves once the one transaction is in. */
async function dragRow(id: string, to: { x: number; y: number }) {
  const before = h.userTransactions();
  const from = await over(id, 0.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

async function undo() {
  const before = h.userTransactions();
  await page.keyboard.press("Control+z");
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='foot']" });
  page = h.page;
  await page.getByRole("tab", { name: "Layers" }).click();
  await row("foot").waitFor();
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: layers drag and drop", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await page.mouse.up();
    await h.synced();
  });

  it("reorders by dropping between rows, and selects what moved", async () => {
    await dragRow("foot", await over("title", 0.2));
    expect(h.childIds(rootId())).toEqual(["foot", "title", "card", "board"]);
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Footer");
    await undo();
    expect(h.childIds(rootId())).toEqual(["title", "card", "board", "foot"]);
  });

  it("drops into a frame from the middle of its row", async () => {
    await dragRow("title", await over("card", 0.5));
    expect(h.childIds("card")).toEqual(["left", "right", "title"]);
    expect(h.childIds(rootId())).toEqual(["card", "board", "foot"]);
    await undo();
    expect(h.childIds("card")).toEqual(["left", "right"]);
  });

  it("pulls a layer out of a frame by dragging left below its last child", async () => {
    // Below "Right" (the card's last child), at the panel's left edge: out, after Card.
    await dragRow("right", await over("right", 0.85, 6));
    expect(h.childIds("card")).toEqual(["left"]);
    expect(h.childIds(rootId())).toEqual(["title", "card", "right", "board", "foot"]);
    await undo();
    expect(h.childIds("card")).toEqual(["left", "right"]);
  });

  it("drops into a free frame without the layer moving on the slide", async () => {
    const layer = page.locator('.editor-canvas [data-node-id="foot"]');
    const before = await layer.boundingBox();
    const scale = await page
      .locator(".editor-canvas .slide-surface")
      .evaluate((el) => el.getBoundingClientRect().width / 1920);
    await dragRow("foot", await over("board", 0.5));
    expect(h.childIds("board")).toEqual(["foot"]);
    expect(h.stored("foot").position).toBeDefined();
    const after = await layer.boundingBox();
    // Same top-left corner (its width may change: it no longer fills a column).
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2 * scale + 1);
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2 * scale + 1);
    await undo();
    expect(h.stored("foot").position).toBeUndefined();
  });

  it("cancels with Escape, and a plain click still just selects", async () => {
    const sent = h.userTransactions();
    const from = await over("foot", 0.5);
    const to = await over("title", 0.2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect.poll(() => page.locator(".layer.is-drop-top").count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await h.synced();
    expect(h.userTransactions()).toBe(sent);
    expect(h.childIds(rootId())).toEqual(["title", "card", "board", "foot"]);
    expect(await page.locator(".layers.is-dragging").count()).toBe(0);

    await row("card").getByRole("button", { name: "Card", exact: true }).click();
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Card");
    expect(h.userTransactions()).toBe(sent);
  });

  it("selects a range with Shift+click and toggles one with Ctrl+click", async () => {
    const sent = h.userTransactions();
    const name = (id: string, label: string) =>
      row(id).getByRole("button", { name: label, exact: true });
    const count = () => page.locator(".inspector-head strong").textContent();
    // Title … Footer, with Card expanded: Title, Card, Left, Right, Board, Footer.
    await name("title", "Title").click();
    await name("foot", "Footer").click({ modifiers: ["Shift"] });
    await expect.poll(count).toBe("6 layers");
    // Shift again from the same anchor shrinks the range: Title … Left.
    await name("left", "Left").click({ modifiers: ["Shift"] });
    await expect.poll(count).toBe("3 layers");
    // Ctrl toggles single rows, without dragging anything.
    await name("board", "Board").click({ modifiers: ["Control"] });
    await expect.poll(count).toBe("4 layers");
    await name("card", "Card").click({ modifiers: ["Control"] });
    await expect.poll(count).toBe("3 layers");
    expect(await row("card").getAttribute("class")).not.toContain("is-selected");
    expect(await row("board").getAttribute("class")).toContain("is-selected");
    await h.synced();
    expect(h.userTransactions()).toBe(sent);
  });

  it("produces no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
