/**
 * Phase 3, round 4 acceptance (align and distribute): the inspector's alignment bar and
 * Figma's Alt shortcuts line up free layers on screen, space three evenly, and align a single
 * layer within its frame; each is one transaction. Layers in a flow get no alignment bar.
 * Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** The root column: Title (flow) and Board, a free frame with three stickers of different sizes. */
async function build(agent: Client) {
  const sticker = (id: string, x: number, y: number, size: string) => ({
    id,
    name: id,
    type: "text",
    props: { content: id, style: size },
    width: "hug", // real widths (text fills its frame by default; the unit tests cover that)
    position: { x, y },
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Align", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", padding: 60, gap: 24 },
        children: [
          { id: "title", name: "Title", type: "text", props: { content: "Title" } },
          {
            id: "board",
            name: "Board",
            height: 600,
            layout: { mode: "absolute", padding: 20 },
            style: { fill: "$color.surface" },
            children: [
              sticker("Red", 40, 30, "$text.h3"),
              sticker("Green", 500, 200, "$text.h1"),
              sticker("Blue", 1100, 90, "$text.body"),
            ],
          },
        ],
      },
    },
  });
}

const row = (id: string) => page.locator(`.layers [data-layer-id="${id}"]`);
const bar = () => page.getByRole("toolbar", { name: "Align" });

async function select(...ids: string[]) {
  for (const [i, id] of ids.entries()) {
    await row(id)
      .getByRole("button", { name: h.stored(id).name as string, exact: true })
      .click({ modifiers: i === 0 ? [] : ["Control"] });
  }
}

/** Screen boxes, keyed by layer. */
async function box(id: string) {
  const b = await page.locator(`.editor-canvas [data-node-id="${id}"]`).boundingBox();
  if (!b) throw new Error(`${id} not shown`);
  return b;
}

/** Run `action` and wait for its one transaction to land. */
async function oneStep(action: () => Promise<void>) {
  const before = h.userTransactions();
  await action();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}
const undo = () => oneStep(() => page.keyboard.press("Control+z"));

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='Blue']" });
  page = h.page;
  await page.getByRole("tab", { name: "Layers" }).click();
  await row("Blue").waitFor();
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: align and distribute", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await h.synced();
  });

  it("aligns left edges from the bar, and vertical centers with Alt+V", async () => {
    await select("Red", "Green", "Blue");
    await oneStep(() => bar().getByRole("button", { name: "Align left" }).click());
    const left = (await box("Red")).x;
    expect(Math.abs((await box("Green")).x - left)).toBeLessThan(1);
    expect(Math.abs((await box("Blue")).x - left)).toBeLessThan(1);
    await undo();

    await oneStep(() => page.keyboard.press("Alt+v"));
    const middle = async (id: string) => {
      const b = await box(id);
      return b.y + b.height / 2;
    };
    expect(Math.abs((await middle("Green")) - (await middle("Red")))).toBeLessThan(1);
    expect(Math.abs((await middle("Blue")) - (await middle("Red")))).toBeLessThan(1);
    await undo();
  });

  it("distributes three layers so the gaps between them are equal", async () => {
    await select("Red", "Green", "Blue");
    const before = { red: await box("Red"), blue: await box("Blue") };
    await oneStep(() => bar().getByRole("button", { name: "Distribute horizontally" }).click());
    const [red, green, blue] = [await box("Red"), await box("Green"), await box("Blue")];
    const gap1 = green.x - (red.x + red.width);
    const gap2 = blue.x - (green.x + green.width);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(1.5);
    expect(Math.abs(red.x - before.red.x)).toBeLessThan(1); // the outer ones stay
    expect(Math.abs(blue.x - before.blue.x)).toBeLessThan(1);
    await undo();
  });

  it("aligns a single layer within its frame (Alt+D: right)", async () => {
    await select("Green");
    await oneStep(() => page.keyboard.press("Alt+d"));
    const green = await box("Green");
    const board = await box("board");
    // Flush with the board's right edge: free layers align to the frame, not its padding.
    expect(Math.abs(green.x + green.width - (board.x + board.width))).toBeLessThan(1);
    expect(await bar().getByRole("button", { name: "Distribute horizontally" }).isDisabled()).toBe(
      true,
    );
    await undo();
  });

  it("shows no alignment bar for layers in a flow", async () => {
    await select("title");
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Title");
    expect(await bar().count()).toBe(0);
    const sent = h.userTransactions();
    await page.keyboard.press("Alt+a");
    await h.synced();
    expect(h.userTransactions()).toBe(sent);
  });

  it("produces no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
