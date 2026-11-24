/**
 * Phase 4 acceptance (morph match key, D109): a person sets a layer's morph key in the
 * inspector, the same field agents set over MCP, and Duplicate slide keys every copy by its
 * original, so the two slides pair up for morph without anyone typing a key. Real Chromium
 * against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { morphPairs } from "@veloce/core";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Morph", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          {
            id: "logo",
            name: "Logo",
            type: "shape",
            width: 200,
            height: 200,
            props: { shape: "ellipse" },
          },
          {
            id: "title",
            name: "Title",
            type: "text",
            props: { content: "Hello", style: "$text.h1" },
          },
        ],
      },
    },
  });
}

async function oneStep(action: () => Promise<void>) {
  const before = h.userTransactions();
  await action();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='logo']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 4: morph match key", { timeout: 60_000 }, () => {
  it("sets and clears a layer's morph key in the inspector, as one undoable edit", async () => {
    await page.getByRole("tab", { name: "Layers" }).click();
    await page.getByRole("button", { name: "Logo", exact: true }).click();
    const field = page.getByLabel("Morph key");
    expect(await field.getAttribute("placeholder")).toBe("Auto");
    await oneStep(async () => {
      await field.fill("  brand  "); // spaces at the ends are trimmed, not refused
      await field.press("Enter");
    });
    expect(h.stored("logo").matchKey).toBe("brand");
    await oneStep(async () => {
      await field.fill("");
      await field.press("Enter");
    });
    expect(h.stored("logo").matchKey).toBeUndefined();
    await oneStep(async () => {
      await field.fill("brand");
      await field.press("Enter");
    });
  });

  it("Duplicate slide pairs every copy with its original, keys or not", async () => {
    await oneStep(async () => {
      await page.getByRole("button", { name: "Slide", exact: true }).click();
      await page.getByRole("menuitem", { name: "Duplicate slide" }).click();
    });
    const [original, copy] = h.latestDeck().slides;
    if (!original || !copy) throw new Error("no copy");
    const pairs = morphPairs(original, copy).map((p) => [p.from.id, p.to.matchKey, p.by]);
    expect(pairs).toEqual([
      ["logo", "brand", "key"], // the key the person typed carries over
      ["title", "title", "key"], // no key: the copy is keyed by the original's ID
    ]);
  });
});
