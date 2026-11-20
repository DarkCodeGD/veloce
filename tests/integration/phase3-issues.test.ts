/**
 * Phase 3 acceptance (lint in the editor, D73): the issues agents get show in an Issues tab,
 * worded for people, with badges on the tab, the thumbnails and the layers. Clicking an issue
 * goes to its slide and selects its layers; fixing it clears it. Driven in real Chromium
 * against the real server (started without a renderer, so only structural checks run).
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

/** s1 is fine, s2 is empty, s3 has a 60-word text: two warnings. */
async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Issues" } });
  const slides = [
    { id: "s1", children: [{ id: "t1", type: "text", props: { content: "Fine" } }] },
    { id: "s2", children: [] },
    {
      id: "s3",
      name: "Wordy",
      children: [{ id: "long", type: "text", props: { content: words(60) } }],
    },
  ];
  for (const slide of slides) await agent.callTool({ name: "upsert_slide", arguments: { slide } });
}

const tab = (name: RegExp) => page.getByRole("tab", { name });
/** The Issues tab's badge, as read aloud ("2 problems"; the "problems" part is sr-only). */
const badge = () => page.locator(".tabs .tab-badge").textContent();
/** The slide on the canvas, from the top bar ("3 / 3"): the rail isn't shown on other tabs. */
const current = async () => (await page.locator(".deck-position").textContent())?.split(" / ")[0];

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='t1']" });
  page = h.page;
  await page.locator(".thumb").nth(2).waitFor();
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: Issues tab", { timeout: 60_000 }, () => {
  it("badges the tab and the thumbnails of slides with problems", async () => {
    await expect.poll(badge).toBe("2 problems");
    expect(await page.locator(".tabs .tab-badge").evaluate((b) => b.firstChild?.textContent)).toBe(
      "2",
    );
    const thumbBadges = await page
      .locator(".thumb")
      .evaluateAll((thumbs) =>
        thumbs.map((t) => t.querySelector(".thumb-issues")?.textContent ?? ""),
      );
    expect(thumbBadges).toEqual(["", "1", "1"]);
    expect(await page.locator(".thumb").nth(2).getAttribute("aria-label")).toBe(
      "Slide 3: Wordy, 1 problem",
    );
    // Inactive tabs show only their icon: the name is still there for screen readers.
    const label = page.locator(".tabs button").filter({ hasText: "History" }).locator(".tab-label");
    expect(await label.boundingBox()).toMatchObject({ width: 1, height: 1 });
  });

  it("lists issues by slide in people's words, and says why layout checks are off", async () => {
    await tab(/^Issues/).click();
    await expect.poll(() => page.locator(".issues-summary").textContent()).toBe("2 warnings");
    expect(await page.locator(".issues-note").textContent()).toMatch(
      /Layout checks .* are off: the server was started without a renderer\./,
    );
    expect(await page.locator(".issues-slide").allTextContents()).toEqual([
      "Slide 2",
      "Slide 3 · Wordy",
    ]);
    const wordy = page.locator(".issue").filter({ hasText: "Too much text" });
    expect(await wordy.locator(".issue-detail").textContent()).toBe(
      'Text "word0 word1 word2 word3 word4 word5 wor…" has 60 words (aim for under 50).',
    );
    expect(await wordy.locator(".issue-hint").textContent()).toMatch(/speaker notes/);
  });

  it("goes to the slide and selects the layer; fixing it clears the issue (undo brings it back)", async () => {
    await page.locator(".issue").filter({ hasText: "Too much text" }).click();
    await expect.poll(current).toBe("3");
    await tab(/^Layers/).click();
    const row = page.locator('.layers [data-layer-id="long"]');
    expect(await row.getAttribute("class")).toContain("is-selected");
    expect(await row.locator(".layer-issue.is-warning").count()).toBe(1);

    // Delete it: lint follows the change (slide 3 is now empty instead of wordy).
    await page.keyboard.press("Delete");
    await tab(/^Issues/).click();
    const titles = () => page.locator(".issue-title").allTextContents();
    await expect.poll(titles).toEqual(["Warning: Empty slide", "Warning: Empty slide"]);
    expect(await page.locator(".issues-slide").allTextContents()).toEqual([
      "Slide 2",
      "Slide 3 · Wordy",
    ]);

    // Undo brings the text, and its issue, back.
    await page.keyboard.press("Control+z");
    await expect.poll(titles).toEqual(["Warning: Empty slide", "Warning: Too much text"]);
    expect(await badge()).toBe("2 problems");
  });

  it("clicking a slide-level issue just goes to the slide", async () => {
    await page.locator(".issue").filter({ hasText: "Empty slide" }).click();
    await tab(/^Slides/).click();
    await expect.poll(current).toBe("2");
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
