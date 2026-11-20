/**
 * Phase 3 acceptance (round 5, D62/D81): building a slide by hand. The tool bar's drawing
 * tools add a layer with a click (default size) or a drag (the drawn box); the Add menu
 * (Shift+A at the pointer, a right-click, the ➕ button) adds one by search; Hand pans. Every
 * addition is ONE `node.insert` transaction, lands in the frame and slot under the pointer,
 * and is selected; a new text layer starts typing. Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** The root column: a title, then a free "Board" frame (800×500) to draw in. */
async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Tools" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", padding: 80, gap: 40 },
        children: [
          { id: "title", type: "text", props: { content: "Title", style: "$text.h2" } },
          {
            id: "board",
            name: "Board",
            layout: { mode: "absolute" },
            width: 800,
            height: 500,
            style: { fill: "$color.surface" },
            children: [],
          },
        ],
      },
    },
  });
}

interface Point {
  x: number;
  y: number;
}

/** Slide pixels → screen pixels (the canvas fits the slide; it doesn't move in these tests). */
async function screen(p: Point): Promise<Point> {
  const r = await page.locator(".editor-canvas .slide-surface").evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, scale: b.width / 1920 };
  });
  return { x: r.x + p.x * r.scale, y: r.y + p.y * r.scale };
}
const scale = () =>
  page
    .locator(".editor-canvas .slide-surface")
    .evaluate((el) => el.getBoundingClientRect().width / 1920);

/** The board's top-left corner on the slide (it's laid out by the root stack). */
async function boardOrigin(): Promise<Point> {
  return page.evaluate(() => {
    const stage = document.querySelector(".editor-canvas .slide-surface") as HTMLElement;
    const board = document.querySelector(".editor-canvas [data-node-id='board']") as HTMLElement;
    const s = stage.getBoundingClientRect();
    const b = board.getBoundingClientRect();
    const k = s.width / 1920;
    return { x: (b.left - s.left) / k, y: (b.top - s.top) / k };
  });
}
/** A point inside the board, in slide pixels. */
const inBoard = async (x: number, y: number) => {
  const o = await boardOrigin();
  return { x: o.x + x, y: o.y + y };
};

const tool = (name: string) =>
  page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name, exact: true });
const addMenu = () => page.getByRole("combobox", { name: "Add a layer" });
const lastInsert = () => {
  const change = h.changes.at(-1);
  const op = change?.ops[0] as {
    op: string;
    parentId: string;
    index?: number;
    node: { id: string } & Record<string, unknown>;
  };
  return { change, op };
};
const selectedName = () => page.locator(".inspector-head strong").textContent();

async function waitForTransactions(n: number) {
  await expect.poll(() => h.userTransactions()).toBe(n);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='board']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe.skipIf(problem)("adding layers by hand (D62, D81)", () => {
  beforeEach(async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.mouse.move(5, 5);
  });

  it("shows the tools with their shortcuts; letters pick a tool, Esc goes back to Select", async () => {
    await expect.poll(() => tool("Select").getAttribute("aria-pressed")).toBe("true");
    expect(await tool("Rectangle").getAttribute("data-keys")).toBe("R");
    expect(await page.getByRole("button", { name: "Add…" }).getAttribute("data-keys")).toBe(
      "Shift+A",
    );
    await page.keyboard.press("t");
    await expect.poll(() => tool("Text").getAttribute("aria-pressed")).toBe("true");
    await expect.poll(() => page.locator(".editor-canvas.is-tool-draw").count()).toBe(1);
    await page.keyboard.press("o"); // the shape slot follows: Ellipse now
    await expect.poll(() => tool("Ellipse").getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Escape");
    await expect.poll(() => tool("Select").getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("r");
    await page.keyboard.press("Escape");
  });

  it("a click with a shape tool adds it there at its default size: one transaction, selected", async () => {
    const before = h.userTransactions();
    const bar = page.getByRole("toolbar", { name: "Tools" });
    const barBefore = await bar.boundingBox();
    await tool("Rectangle").click();
    const at = await screen(await inBoard(400, 250));
    await page.mouse.click(at.x, at.y);
    await waitForTransactions(before + 1);
    const { change, op } = lastInsert();
    expect(change?.label).toBe("Add rectangle");
    expect(change?.ops).toHaveLength(1);
    expect(op).toMatchObject({ op: "node.insert", parentId: "board" });
    expect(op.node).toMatchObject({ type: "shape", name: "Rectangle", width: 200, height: 200 });
    const pos = op.node.position as Point;
    expect(Math.abs(pos.x - 300)).toBeLessThanOrEqual(2); // centred on the click
    expect(Math.abs(pos.y - 150)).toBeLessThanOrEqual(2);
    await expect.poll(selectedName).toBe("Rectangle");
    await expect.poll(() => tool("Select").getAttribute("aria-pressed")).toBe("true"); // one layer per tool
    // The activity pill ("You · Add rectangle") showed up: the tools stay put, centred.
    await expect.poll(() => page.locator(".activity").count()).toBe(1);
    expect((await bar.boundingBox())?.x).toBe(barBefore?.x);
    const centre = ((barBefore?.x ?? 0) + (barBefore?.width ?? 0) / 2) / 1440;
    expect(Math.abs(centre - 0.5)).toBeLessThan(0.01);
  });

  it("a drag draws it: the drawn box, previewed live, Shift for a square", async () => {
    const before = h.userTransactions();
    await page.keyboard.press("o");
    const from = await screen(await inBoard(100, 60));
    const to = await screen(await inBoard(260, 180));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    // Live: the badge shows the size and the ellipse previews (nothing sent yet).
    await expect
      .poll(() => page.locator(".drag-badge").textContent())
      .toMatch(/^1[56]\d × 1[12]\d$/);
    expect(h.userTransactions()).toBe(before);
    await page.keyboard.down("Shift");
    await page.mouse.move(to.x + 1, to.y, { steps: 1 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await waitForTransactions(before + 1);
    const { op } = lastInsert();
    expect(op.parentId).toBe("board");
    expect(op.node).toMatchObject({ name: "Ellipse" });
    const w = op.node.width as number;
    expect(op.node.height).toBe(w); // Shift: square
    expect(Math.abs(w - 160)).toBeLessThanOrEqual(3 / (await scale()));
    const pos = op.node.position as Point;
    expect(Math.abs(pos.x - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(pos.y - 60)).toBeLessThanOrEqual(2);
    await expect.poll(selectedName).toBe("Ellipse");
    expect(await page.locator(".drag-badge").count()).toBe(0);
  });

  it("Esc while drawing cancels it: nothing added", async () => {
    const before = h.userTransactions();
    await page.keyboard.press("f");
    const from = await screen(await inBoard(500, 300));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 40, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.keyboard.press("Escape"); // and leave the tool
    await h.synced();
    expect(h.userTransactions()).toBe(before);
  });

  it("a text click in a stack goes into the slot under the pointer and starts typing", async () => {
    const before = h.userTransactions();
    await page.keyboard.press("t");
    // Between the title and the board: the root column's slot 1.
    const title = await page.locator(".editor-canvas [data-node-id='title']").boundingBox();
    if (!title) throw new Error("no title");
    await page.mouse.click(title.x + 100, title.y + title.height + 4);
    await waitForTransactions(before + 1);
    const { op } = lastInsert();
    expect(op).toMatchObject({ parentId: h.latestDeck().slides[0]?.root.id, index: 1 });
    expect(op.node).toMatchObject({ type: "text", props: { content: "Text" } });
    expect(op.node).not.toHaveProperty("position");
    // Typing replaces the placeholder.
    await expect
      .poll(() => page.locator(".editor-canvas [contenteditable='true']").count())
      .toBe(1);
    await page.keyboard.type("Hello");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => (h.stored(op.node.id).props as { content: unknown }).content)
      .toBe("Hello");
  });

  it("Shift+A opens the Add menu at the pointer; a search and Enter add it there", async () => {
    const before = h.userTransactions();
    const at = await screen(await inBoard(600, 380));
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press("Shift+A");
    await addMenu().waitFor();
    const box = await page.locator(".add-menu").boundingBox();
    expect(Math.abs((box?.x ?? 0) - at.x)).toBeLessThan(12); // opens at the pointer
    expect(await page.getByRole("option").allTextContents()).toEqual(
      expect.arrayContaining(["Text", "Frame", "Rectangle", "Ellipse", "Image…"]),
    );
    await page.keyboard.type("circ");
    await expect.poll(() => page.getByRole("option").allTextContents()).toEqual(["Ellipse"]);
    await page.keyboard.press("Enter");
    await waitForTransactions(before + 1);
    expect(await page.locator(".add-menu").count()).toBe(0);
    const { op } = lastInsert();
    expect(op.parentId).toBe("board");
    const pos = op.node.position as Point;
    expect(Math.abs(pos.x - 500)).toBeLessThanOrEqual(2); // centred on the pointer
    expect(Math.abs(pos.y - 280)).toBeLessThanOrEqual(2);
    // Next time, it's on top under Recent.
    await page.keyboard.press("Shift+A");
    await addMenu().waitFor();
    expect(
      await page.getByRole("group", { name: "Recent" }).getByRole("option").allTextContents(),
    ).toEqual(["Ellipse"]);
    await page.keyboard.press("Escape");
    expect(await page.locator(".add-menu").count()).toBe(0);
    expect(h.userTransactions()).toBe(before + 1);
  });

  it("a right-click opens it too; arrows and a click choose", async () => {
    const before = h.userTransactions();
    const at = await screen(await inBoard(150, 400));
    await page.mouse.click(at.x, at.y, { button: "right" });
    await addMenu().waitFor();
    await page.keyboard.press("ArrowDown");
    const active = page.locator(".add-menu-item.is-active");
    expect(await active.getAttribute("aria-selected")).toBe("true");
    await page.locator(".add-menu-item", { hasText: "Frame" }).first().click();
    await waitForTransactions(before + 1);
    const { op } = lastInsert();
    expect(op).toMatchObject({ parentId: "board", node: { kind: "frame", name: "Frame" } });
    await expect.poll(selectedName).toBe("Frame");
  });

  it("the ➕ button adds where a paste would: after the selected layer", async () => {
    const before = h.userTransactions();
    await page.getByRole("tab", { name: "Layers" }).click();
    await page.getByRole("button", { name: "Title", exact: true }).click();
    await page.getByRole("button", { name: "Add…" }).click();
    await addMenu().waitFor();
    await page.keyboard.type("rect");
    await expect.poll(() => page.getByRole("option").allTextContents()).toEqual(["Rectangle"]);
    await page.keyboard.press("Enter");
    await waitForTransactions(before + 1);
    const { op } = lastInsert();
    expect(op).toMatchObject({ parentId: h.latestDeck().slides[0]?.root.id, index: 1 });
    expect(op.node).not.toHaveProperty("position");
    // Focus went back to the ➕ button.
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
      "Add…",
    );
  });

  it("Hand pans with a plain drag, and grabs nothing", async () => {
    const before = h.userTransactions();
    await page.keyboard.press("h");
    await expect.poll(() => page.locator(".editor-canvas.can-pan").count()).toBe(1);
    const stage = page.locator(".editor-canvas .slide-surface");
    const start = await stage.boundingBox();
    const from = await screen(await inBoard(400, 250)); // right over a layer
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y + 30, { steps: 4 });
    await page.mouse.up();
    const end = await stage.boundingBox();
    expect(Math.round((end?.x ?? 0) - (start?.x ?? 0))).toBe(80);
    expect(h.userTransactions()).toBe(before);
    await page.keyboard.press("v");
    await page.keyboard.press("Shift+1"); // fit again
  });

  it("letters and Shift+A type normally in text fields", async () => {
    const notes = page.getByRole("textbox", { name: "Speaker notes" });
    await notes.click();
    await page.keyboard.type("tAh");
    expect(await notes.inputValue()).toBe("tAh");
    expect(await page.locator(".add-menu").count()).toBe(0);
    await expect.poll(() => tool("Select").getAttribute("aria-pressed")).toBe("true");
    await notes.fill("");
    await page.locator(".editor-canvas").click({ position: { x: 5, y: 5 } });
  });

  it("narrow windows fold the tools into one menu", async () => {
    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(() => page.getByRole("toolbar", { name: "Tools" }).isVisible()).toBe(false);
    await page.getByRole("button", { name: "Tools" }).click();
    await page.getByRole("menuitemradio", { name: /Text/ }).click();
    await expect.poll(() => page.locator(".editor-canvas.is-tool-draw").count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  it("raised no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
