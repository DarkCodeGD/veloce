/**
 * Phase 3 acceptance (round 5, D93): versions. Save the deck under a name, let an "agent"
 * rewrite it, look at the saved version read-only, restore it as one undoable change, and
 * delete it (asked twice). The version lives in the deck's file. Real Chromium, real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createSlide, element } from "@veloce/core";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Versions" } });
  for (const [id, words] of [
    ["s1", "Our plan"],
    ["s2", "The numbers"],
  ] as const) {
    await agent.callTool({
      name: "upsert_slide",
      arguments: {
        slide: { id, children: [{ id: `${id}t`, type: "text", props: { content: words } }] },
      },
    });
  }
}

const READY = ".editor-canvas [data-node-id='s1t']";
const position = () => page.locator(".deck-position").textContent();
const toast = () => page.locator(".toast").last().textContent();
const dialog = (name: string) => page.getByRole("dialog", { name });

async function fromFile(command: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: command }).click();
}

/** An agent replaces the whole deck with one slide. */
async function agentRewrites() {
  const deck = await h.workspace.get(h.latestDeck().id);
  const result = deck.apply({
    origin: "agent:claude",
    label: "Rework the deck",
    ops: [
      ...deck.deck.slides.map((s) => ({ op: "slide.remove" as const, id: s.id })),
      {
        op: "slide.insert" as const,
        index: 0,
        slide: createSlide({
          id: "new",
          children: [element("text", { content: "Brand new" }, { id: "newt" })],
        }),
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  await expect.poll(position).toBe("1 / 1");
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: READY });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: versions", { timeout: 60_000 }, () => {
  it("shows an empty list that leads to saving one", async () => {
    await fromFile("Versions…");
    await expect.poll(() => dialog("Versions").textContent()).toContain("No versions yet.");
    await dialog("Versions").getByRole("button", { name: "Save version…" }).click();
    await dialog("Save version").waitFor();
    await page.keyboard.press("Escape");
  });

  it("saves a version under a name, into the deck's file", async () => {
    await fromFile("Save version…");
    const name = dialog("Save version").getByRole("textbox", { name: "Name" });
    expect(await name.inputValue()).toBe("Version 1");
    await name.fill("Before AI");
    await page.keyboard.press("Enter");
    await expect.poll(toast).toBe('Saved version "Before AI"');
    const deck = await h.workspace.get(h.latestDeck().id);
    expect(deck.savedVersions().map((v) => v.name)).toEqual(["Before AI"]);
    // Written at once, not after the autosave pause.
    expect(deck.bundle().versions?.map((v) => v.name)).toEqual(["Before AI"]);
  });

  it("shows a saved version read-only, and restores it as one undoable change", async () => {
    await agentRewrites();
    await fromFile("Versions…");
    const versions = dialog("Versions");
    const option = versions.getByRole("option", { name: /Before AI/ });
    expect(await option.getAttribute("aria-selected")).toBe("true");
    expect(await option.textContent()).toContain("2 slides");
    // Its slides, drawn read-only (the deck itself has one slide now).
    const preview = versions.getByRole("region", { name: "Slides of “Before AI”" });
    await expect.poll(() => preview.locator(".versions-slide").count()).toBe(2);
    await expect.poll(() => preview.textContent()).toContain("Our plan");

    await versions.getByRole("button", { name: "Restore this version" }).click();
    await expect.poll(() => dialog("Versions").count()).toBe(0);
    await expect.poll(position).toBe("1 / 2");
    await expect.poll(toast).toBe('Restored "Before AI"Undo'); // with its Undo button
    expect(h.latestDeck().slides.map((s) => s.id)).toEqual(["s1", "s2"]);

    // Undo brings the agent's version back: a restore is an ordinary change of yours.
    await page.locator(".stage-area").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => h.latestDeck().slides.map((s) => s.id)).toEqual(["new"]);
  });

  it("deletes a version only when asked twice", async () => {
    await fromFile("Versions…");
    const versions = dialog("Versions");
    const remove = versions.getByRole("button", { name: /^Delete/ });
    await remove.click();
    expect(await remove.textContent()).toBe("Delete “Before AI” for good");
    const deck = await h.workspace.get(h.latestDeck().id);
    expect(deck.savedVersions()).toHaveLength(1);
    await remove.click();
    await expect.poll(() => versions.textContent()).toContain("No versions yet.");
    expect(deck.savedVersions()).toEqual([]);
    await page.keyboard.press("Escape");
    expect(h.pageErrors).toEqual([]);
  });
});
