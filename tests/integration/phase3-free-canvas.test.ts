/**
 * Phase 3 acceptance (D83, free canvas): slides made by hand start Free, the slide's own layout
 * is edited in the Slide section, and structure is opted into with Add auto layout
 * (Ctrl+Alt+A). An agent's stack slide turns Free without a pixel moving; going back to a
 * stack re-arranges the layers, says so, and its toast's Undo puts them back. Real Chromium
 * against the real server; every gesture is one transaction.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** An agent's slide: a centred column of Title, Subtitle and Footer. */
async function build(agent: Client) {
  const text = (id: string, content: string) => ({
    id,
    name: content,
    type: "text",
    props: { content, style: "$text.h2" },
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Canvas" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", padding: 80, gap: 40, justify: "center" },
        children: [text("title", "Title"), text("sub", "Subtitle"), text("foot", "Footer")],
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
const root = (slide = 0) => h.latestDeck().slides[slide]?.root;
/** With nothing selected, the inspector's only Mode field is the slide's (its Layout section). */
const slideMode = () => page.getByRole("combobox", { name: "Mode" });
const toast = () => page.locator(".toast").last();

async function sent(n: number) {
  await expect.poll(() => h.userTransactions()).toBe(n);
  await h.synced();
}
async function pickMode(option: RegExp) {
  await slideMode().click();
  await page.getByRole("option", { name: option }).click();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='foot']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe.skipIf(problem)("free canvas (D83)", () => {
  beforeEach(async () => {
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".inspector-head").count()).toBe(0);
  });

  it("an agent's stack slide turns Free from the Slide section, nothing moving", async () => {
    const before = { title: await box("title"), sub: await box("sub"), foot: await box("foot") };
    const n = h.userTransactions();
    await pickMode(/Free/);
    await sent(n + 1);
    expect(root()?.layout).toEqual({ mode: "absolute" });
    for (const id of ["title", "sub", "foot"] as const) {
      expect(h.stored(id).position).toBeDefined();
      const now = await box(id);
      for (const k of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(now[k] - before[id][k]), `${id}.${k}`).toBeLessThan(1);
      }
    }
  });

  it("Ctrl+Alt+A turns free layers into a stack, in their on-screen order", async () => {
    await layer("foot").click();
    await layer("title").click({ modifiers: ["Shift"] });
    const n = h.userTransactions();
    await page.keyboard.press("Control+Alt+a");
    await sent(n + 1);
    expect(h.changes.at(-1)?.label).toBe("Add auto layout");
    const stack = root()?.children.find((c) => c.kind === "frame");
    expect(stack).toMatchObject({ name: "Auto layout", layout: { mode: "stack" } });
    // Title is above Footer on screen, so it comes first whatever the selection order.
    expect(h.childIds(stack?.id ?? "")).toEqual(["title", "foot"]);
    expect(h.stored("title").position).toBeUndefined();
    await expect
      .poll(() => page.locator(".inspector-head strong").textContent())
      .toBe("Auto layout");

    await page.keyboard.press("Control+z");
    await sent(n + 2);
    expect(h.childIds(root()?.id ?? "")).toEqual(["title", "sub", "foot"]);
    expect(h.stored("title").position).toBeDefined();
  });

  it("back to a stack re-arranges the layers, says so, and the toast's Undo restores them", async () => {
    const positions = () => ["title", "sub", "foot"].map((id) => h.stored(id).position);
    const free = positions();
    const n = h.userTransactions();
    await pickMode(/Stack/);
    await sent(n + 1);
    expect(root()?.layout).toMatchObject({ mode: "stack" });
    expect(positions()).toEqual([undefined, undefined, undefined]);
    await expect.poll(() => toast().textContent()).toMatch(/Layers now flow in a stack/);

    await toast().getByRole("button", { name: "Undo" }).click();
    await sent(n + 2);
    expect(root()?.layout).toEqual({ mode: "absolute" });
    expect(positions()).toEqual(free);
  });

  it("a slide made in the editor starts Free", async () => {
    const n = h.userTransactions();
    await page.getByRole("button", { name: "New slide" }).click();
    await sent(n + 1);
    expect(h.latestDeck().slides).toHaveLength(2);
    expect(root(1)?.layout).toEqual({ mode: "absolute" });
    await expect.poll(() => slideMode().textContent()).toMatch(/Free/);
  });

  it("raised no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
