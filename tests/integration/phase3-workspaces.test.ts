/**
 * Phase 3 acceptance (round 5, D90): the Design workspace's panels resize and collapse, by
 * dragging their edge, from the keyboard and from the View menu, and the layout is
 * remembered across reloads. Driven in real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Panels" } });
  for (const id of ["s1", "s2"]) {
    await agent.callTool({
      name: "upsert_slide",
      arguments: {
        slide: { id, children: [{ id: `${id}t`, type: "text", props: { content: id } }] },
      },
    });
  }
}

const READY = ".editor-canvas [data-node-id='s1t']";
const splitter = (name: string) => page.getByRole("separator", { name });
const width = async (selector: string) => (await page.locator(selector).boundingBox())?.width ?? 0;
const leftWidth = () => width(".left-panel");
const inspectorWidth = () => width(".inspector-panel");
const visible = (selector: string) => page.locator(selector).isVisible();
const position = () => page.locator(".deck-position").textContent();

/** Drags a splitter sideways by `dx` pixels. */
async function drag(name: string, dx: number) {
  const box = await splitter(name).boundingBox();
  if (!box) throw new Error(`no ${name} splitter`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

async function fromView(command: string) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: command, exact: true }).click();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: READY });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: workspace panels", { timeout: 60_000 }, () => {
  it("resizes the side panels by their edges, and remembers them after a reload", async () => {
    expect(await leftWidth()).toBe(248);
    expect(await inspectorWidth()).toBe(300);
    await drag("Resize left panel", 40);
    await expect.poll(leftWidth).toBe(288); // 20% of the 1440px window: its cap
    await drag("Resize left panel", -48);
    await expect.poll(leftWidth).toBe(240);
    await drag("Resize inspector", -40); // the inspector grows to the left
    await expect.poll(inspectorWidth).toBe(340);
    expect(await splitter("Resize inspector").getAttribute("aria-valuenow")).toBe("340");

    await page.reload();
    await page.locator(READY).waitFor();
    expect(await leftWidth()).toBe(240);
    expect(await inspectorWidth()).toBe(340);
  });

  it("collapses a panel dragged past half its size, and brings it back as it was", async () => {
    await drag("Resize left panel", -200);
    await expect.poll(() => visible(".left-panel")).toBe(false);
    const reveal = page.getByRole("button", { name: "Show left panel" });
    await reveal.click();
    await expect.poll(leftWidth).toBe(240);
    expect(await reveal.count()).toBe(0);
    // Double-click: the preset size.
    await splitter("Resize left panel").dblclick();
    await expect.poll(leftWidth).toBe(248);
  });

  it("resizes from the keyboard without the arrows changing slides", async () => {
    await splitter("Resize inspector").focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(inspectorWidth).toBe(356);
    await page.keyboard.press("Home");
    await expect.poll(inspectorWidth).toBe(260);
    expect(await position()).toBe("1 / 2");
    await page.keyboard.press("Enter");
    await expect.poll(() => visible(".inspector-panel")).toBe(false);
    await page.keyboard.press("Enter");
    await expect.poll(inspectorWidth).toBe(260);
    await splitter("Resize inspector").dblclick();
    await expect.poll(inspectorWidth).toBe(300);
  });

  it("shows and hides panels from View, Ctrl+\\ and the left panel's tab keys", async () => {
    await page.locator(".stage-area").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+Backslash");
    await expect.poll(() => visible(".left-panel")).toBe(false);
    expect(await visible(".inspector-panel")).toBe(false);
    await page.keyboard.press("Control+Backslash");
    await expect.poll(() => visible(".left-panel")).toBe(true);
    expect(await visible(".inspector-panel")).toBe(true);

    await fromView("Inspector");
    await expect.poll(() => visible(".inspector-panel")).toBe(false);
    await page.getByRole("button", { name: "Show inspector" }).click();
    await expect.poll(() => visible(".inspector-panel")).toBe(true);

    // Asking for a tab opens the left panel on it.
    await fromView("Left panel");
    await expect.poll(() => visible(".left-panel")).toBe(false);
    await page.keyboard.press("Alt+2");
    await expect.poll(() => visible(".left-panel")).toBe(true);
    expect(await page.getByRole("tab", { name: "Layers" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("never scrolls the page itself: everything scrolls inside its panel", async () => {
    const overflow = () =>
      page.evaluate(() => {
        const root = document.documentElement;
        return [root.scrollHeight - innerHeight, root.scrollWidth - innerWidth];
      });
    try {
      // A short window: the inspector's content runs far below it, and must stay inside.
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect.poll(overflow).toEqual([0, 0]);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await expect.poll(overflow).toEqual([0, 0]);
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });

  it("collapses speaker notes from their header, giving the canvas the room", async () => {
    const header = page.getByRole("button", { name: "Speaker notes" });
    const notes = page.getByRole("textbox", { name: "Speaker notes" });
    const canvas = async () => (await page.locator(".editor-canvas").boundingBox())?.height ?? 0;
    const before = await canvas();
    expect(await header.getAttribute("aria-expanded")).toBe("true");
    await header.click();
    await expect.poll(() => notes.isVisible()).toBe(false);
    await expect.poll(canvas).toBeGreaterThan(before + 40);
    await fromView("Speaker notes");
    await expect.poll(() => notes.isVisible()).toBe(true);
    expect(h.pageErrors).toEqual([]);
  });
});
