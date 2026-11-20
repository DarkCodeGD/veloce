/**
 * Phase 3 acceptance (D85): a grid places each layer in its cell on both axes. `justify`
 * (Horizontal) joins `align` (Vertical), so a 200px logo can sit centred in its column.
 * Real Chromium against the real server; each change is one transaction.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** A 3-column grid: a 200×100 logo, a tall 300px block (setting the row's height), a third. */
async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Grid" } });
  const shape = (id: string, width: number | "fill", height: number) => ({
    id,
    name: id,
    type: "shape",
    width,
    height,
    props: { shape: "rect", fill: "$color.primary" },
  });
  const result = await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          {
            id: "cells",
            name: "Cells",
            layout: { mode: "grid", columns: 3, gap: 40 },
            children: [
              shape("logo", 200, 100),
              shape("tall", "fill", 300),
              shape("third", 200, 100),
            ],
          },
        ],
      },
    },
  });
  if (result.isError) throw new Error(JSON.stringify(result.content));
}

const layer = (id: string) => page.locator(`.editor-canvas [data-node-id="${id}"]`);
async function box(id: string) {
  const b = await layer(id).boundingBox();
  if (!b) throw new Error(`${id} not on the canvas`);
  return b;
}
async function choose(field: string, option: string) {
  const before = h.userTransactions();
  await page.getByRole("combobox", { name: field }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='logo']" });
  page = h.page;
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByRole("button", { name: "Cells", exact: true }).click();
  await page.locator(".inspector-head strong", { hasText: "Cells" }).waitFor();
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe.skipIf(problem)("grid cell alignment (D85)", () => {
  it("a fixed-width layer starts at its cell's left, top", async () => {
    const grid = await box("cells");
    const logo = await box("logo");
    expect(Math.abs(logo.x - grid.x)).toBeLessThan(1.5);
    expect(Math.abs(logo.y - grid.y)).toBeLessThan(1.5);
  });

  it("Horizontal: Center centres it in its column", async () => {
    await choose("Horizontal", "Center");
    expect(h.stored("cells").layout).toMatchObject({ mode: "grid", justify: "center" });
    expect(h.changes.at(-1)?.label).toBe("Change horizontal alignment");
    // The tall block fills its column, so its width is the column's.
    const grid = await box("cells");
    const column = (await box("tall")).width;
    await expect
      .poll(async () => {
        const logo = await box("logo");
        return Math.round(logo.x + logo.width / 2 - (grid.x + column / 2)) + 0; // never -0
      })
      .toBe(0);
  });

  it("Vertical: Bottom puts it at the row's bottom, and undo puts it back", async () => {
    await choose("Vertical", "Bottom");
    expect(h.stored("cells").layout).toMatchObject({ justify: "center", align: "end" });
    const tall = await box("tall");
    await expect
      .poll(async () => {
        const logo = await box("logo");
        return Math.round(logo.y + logo.height - (tall.y + tall.height)) + 0; // never -0
      })
      .toBe(0);

    await page.keyboard.press("Control+z");
    await expect.poll(() => (h.stored("cells").layout as { align?: string }).align).toBeUndefined();
    await expect
      .poll(async () => Math.round((await box("logo")).y - (await box("tall")).y))
      .toBe(0);
  });

  it("raised no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
