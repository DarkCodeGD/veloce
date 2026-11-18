/**
 * Phase 3 acceptance (deck structure): reordering slides by dragging their thumbnails, and
 * the clipboard (copy/cut/paste of layers, within and between slides and decks). Driven in
 * real Chromium against the real server; each action is one transaction.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** Four slides, each with a titled text (`t1`…`t4`). */
async function build(agent: Client) {
  await agent.callTool({
    name: "create_deck",
    arguments: { title: "Structure", theme: "midnight" },
  });
  for (const n of [1, 2, 3, 4]) {
    await agent.callTool({
      name: "upsert_slide",
      arguments: {
        slide: {
          id: `s${n}`,
          children: [
            {
              id: `t${n}`,
              name: `Title ${n}`,
              type: "text",
              props: { content: `Slide ${n}`, style: "$text.h1" },
            },
          ],
        },
      },
    });
  }
}

const order = () => h.latestDeck().slides.map((s) => s.id);
/** The layers on a slide (by position in the deck), as the server stores them. */
const rootChildren = (slide: number) =>
  (h.latestDeck().slides[slide]?.root.children ?? []) as Array<Record<string, unknown>>;
const thumb = (n: number) => page.locator(".thumb").nth(n);
const current = () => page.locator('.thumb[aria-current="true"] .thumb-number').textContent();

async function centreOf(n: number) {
  const b = await thumb(n).boundingBox();
  if (!b) throw new Error(`no thumbnail ${n}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height };
}

/** Press thumbnail `from` and move to `to` (screen point), button still down. */
async function grab(from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(80);
}

async function undo() {
  const before = h.userTransactions();
  await page.keyboard.press("Control+z");
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='t1']" });
  page = h.page;
  await page.locator(".thumb").nth(3).waitFor();
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: deck structure", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await page.mouse.up();
    await h.synced();
  });

  it("drags a slide to a new position: one transaction, selected, one undo step", async () => {
    expect(order()).toEqual(["s1", "s2", "s3", "s4"]);
    const before = h.userTransactions();
    const first = await centreOf(0);
    const third = await centreOf(2);
    // Into the lower half of slide 3: slide 1 goes after it.
    await grab(first, { x: third.x, y: third.y + third.h * 0.3 });
    expect(await page.locator(".rail-insertion").count()).toBe(1);
    expect(await page.locator(".thumb-row.is-dragged").count()).toBe(1);
    expect(h.userTransactions()).toBe(before);
    await page.mouse.up();
    await expect.poll(order).toEqual(["s2", "s3", "s1", "s4"]);
    expect(h.userTransactions()).toBe(before + 1);
    await h.synced();
    expect(await page.locator(".rail-insertion").count()).toBe(0);
    await expect.poll(current).toBe("3"); // the moved slide is selected, at its new place
    await undo();
    expect(order()).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("Esc cancels a slide drag; a click without moving just selects", async () => {
    const before = h.userTransactions();
    const second = await centreOf(1);
    const last = await centreOf(3);
    await grab(second, last);
    await page.keyboard.press("Escape");
    expect(await page.locator(".rail-insertion").count()).toBe(0);
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(h.userTransactions()).toBe(before);
    const fourth = await centreOf(3);
    await page.mouse.click(fourth.x, fourth.y);
    await expect.poll(current).toBe("4");
    expect(h.userTransactions()).toBe(before);
  });

  it("copies a layer to another slide with the system clipboard: fresh IDs, one transaction", async () => {
    await thumb(0).click();
    const t1 = page.locator('.editor-canvas [data-node-id="t1"]');
    await t1.click();
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Title 1");
    await page.keyboard.press("Control+c");
    await thumb(1).click();
    await expect.poll(current).toBe("2");
    const before = h.userTransactions();
    await page.keyboard.press("Control+v");
    await expect.poll(() => rootChildren(1).length).toBe(2);
    expect(h.userTransactions()).toBe(before + 1);
    const pasted = rootChildren(1)[1];
    expect(pasted?.id).not.toBe("t1");
    expect(pasted).toMatchObject({ name: "Title 1", props: { content: "Slide 1" } });
    await h.synced();
    // The copy is selected, ready to move.
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Title 1");
    await undo();
    expect(rootChildren(1)).toHaveLength(1);
  });

  it("cuts and pastes back as two undoable steps", async () => {
    await thumb(2).click();
    await page.locator('.editor-canvas [data-node-id="t3"]').click();
    const before = h.userTransactions();
    await page.keyboard.press("Control+x");
    await expect.poll(() => rootChildren(2).length).toBe(0);
    await h.synced();
    await page.keyboard.press("Control+v");
    await expect.poll(() => rootChildren(2).length).toBe(1);
    expect(h.userTransactions()).toBe(before + 2);
    expect(rootChildren(2)[0]).toMatchObject({ name: "Title 3" });
    await h.synced();
    await undo();
    await undo();
    expect(rootChildren(2).map((n) => n.id)).toEqual(["t3"]);
  });

  it("pastes text from another app as a new text layer", async () => {
    await thumb(3).click();
    await expect.poll(current).toBe("4");
    await page.keyboard.press("Escape");
    // What another app's copy looks like: plain text only.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "From elsewhere");
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
    });
    await expect.poll(() => rootChildren(3).length).toBe(2);
    expect(rootChildren(3)[1]).toMatchObject({
      type: "text",
      props: { content: "From elsewhere" },
    });
    await h.synced();
    await undo();
  });

  it("lists everyone's changes in the History tab, including the agent's from before it opened", async () => {
    await thumb(0).click(); // the History tab replaces the rail
    await page.getByRole("tab", { name: "History" }).click();
    // The panel's styles don't leak into the top bar (it once stacked Undo/Redo vertically).
    const bar = page.locator(".topbar");
    const undoBox = await bar.getByRole("button", { name: "Undo", exact: true }).boundingBox();
    const redoBox = await bar.getByRole("button", { name: "Redo", exact: true }).boundingBox();
    expect(redoBox?.y).toBe(undoBox?.y);
    const authors = () => page.locator(".history-author").allTextContents();
    // The agent built the deck before this tab connected: it's in the history anyway.
    expect(await authors()).toContain("Claude Code");
    const labels = () => page.locator(".history-label").allTextContents();

    // A new change of yours appears on top, live.
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await labels())[0]).toBe("Move slide 1 to position 2");
    expect((await authors())[0]).toBe("You");
    await undo();
    await expect.poll(async () => (await labels())[0]).toBe("Undo: Move slide 1 to position 2");

    // Filters.
    await page.getByRole("button", { name: "AI", exact: true }).click();
    expect(new Set(await authors())).toEqual(new Set(["Claude Code"]));
    await page.getByRole("button", { name: "You", exact: true }).click();
    expect(new Set(await authors())).toEqual(new Set(["You"]));
    await page.getByRole("button", { name: "All", exact: true }).click();

    // Clicking a change goes to the slide it touched.
    const third = page
      .locator(".history-entry")
      .filter({ has: page.locator(".history-chip", { hasText: /^Slide 3$/ }) })
      .last();
    await third.click();
    await page.getByRole("tab", { name: "Slides" }).click();
    await expect.poll(current).toBe("3");
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
