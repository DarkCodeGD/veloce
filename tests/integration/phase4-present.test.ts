/**
 * Phase 4 acceptance (presenting, D116): Present plays the deck fullscreen with the clock
 * (D115). Its motion runs as Web Animations, a click starts the next step, then the next
 * slide (hidden ones skipped), the end screen comes last, back goes back, and Esc returns
 * to the editor as it was. F5 starts from the first slide and doesn't reload the page.
 * Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

const box = (id: string, x: number) => ({
  id,
  type: "shape",
  width: 300,
  height: 300,
  position: { x, y: 390 },
  props: { shape: "rect", fill: "$color.primary" },
});

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Show", theme: "midnight" } });
  for (const [id, x] of [
    ["s1", 200],
    ["s2", 800],
    ["s3", 1400],
  ] as const) {
    await agent.callTool({
      name: "upsert_slide",
      arguments: { slide: { id, layout: { mode: "absolute" }, children: [box(`${id}-box`, x)] } },
    });
  }
}

const present = () => page.locator("dialog.present");
const shown = (id: string) => present().locator(`[data-node-id="${id}"]`);
/** Where a layer is drawn right now, in screen pixels. */
const left = (id: string) =>
  shown(id).evaluate((el) => Math.round(el.getBoundingClientRect().left));

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas .slide-surface" });
  page = h.page;
  // Animations, as the timeline will write them: s1 slides in as it appears and moves on a
  // click; s2 is hidden.
  const doc = await h.workspace.get(h.latestDeck().id);
  const result = doc.apply({
    origin: "agent:test",
    label: "Animate",
    ops: [
      {
        op: "animation.insert",
        slideId: "s1",
        animation: {
          id: "in",
          target: "s1-box",
          trigger: "withPrevious",
          duration: 1500,
          easing: "linear",
          tracks: { x: [{ at: 0, value: -600 }] },
        },
      },
      {
        op: "animation.insert",
        slideId: "s1",
        animation: {
          id: "on-click",
          target: "s1-box",
          trigger: "onClick",
          duration: 400,
          tracks: { y: [{ at: 1, value: -200 }] },
        },
      },
      { op: "slide.update", id: "s2", set: { hidden: true } },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
}, 90_000);

afterAll(async () => {
  if (problem) return;
  await h.close();
});

describe.skipIf(problem !== null)("Phase 4: presenting (D116)", { timeout: 60_000 }, () => {
  it("plays the slide on screen fullscreen, its motion on the compositor", async () => {
    await h.synced();
    await page.locator(".rail .thumb").first().click(); // s1 on screen (Follow AI left s3)
    await page.getByRole("button", { name: "Present" }).click();
    await expect.poll(() => present().isVisible()).toBe(true);
    await shown("s1-box").waitFor();
    expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
    // It moves by itself: the entrance slides it in over 1.5 s.
    const first = await left("s1-box");
    await expect.poll(() => left("s1-box"), { timeout: 3000 }).toBeGreaterThan(first + 20);
  });

  it("clicks through steps and slides, skipping the hidden one, to the end screen", async () => {
    await page.keyboard.press("ArrowRight"); // s1's click step
    expect(await shown("s1-box").count()).toBe(1);
    await page.keyboard.press("ArrowRight"); // s3: s2 is hidden
    await shown("s3-box").waitFor();
    expect(await shown("s2-box").count()).toBe(0);
    await present().click(); // a click moves on too: the end screen
    await present().getByText("End of presentation").waitFor();
    await page.keyboard.press("ArrowLeft"); // back to s3
    await shown("s3-box").waitFor();
    await page.keyboard.press("ArrowLeft"); // s1, fully built
    await shown("s1-box").waitFor();
  });

  it("leaves with Esc, back to the editor as it was", async () => {
    await page.keyboard.press("Escape");
    await expect.poll(() => present().count()).toBe(0);
    await page.locator(".editor-canvas .slide-surface").waitFor();
    expect(h.userTransactions()).toBe(0); // presenting never edits the deck
  });

  it("starts from the first slide with F5, without reloading the page", async () => {
    await page.evaluate(() => Object.assign(window, { stillHere: true }));
    await page.locator(".rail .thumb").nth(2).click(); // s3 on screen
    await page.keyboard.press("F5");
    await shown("s1-box").waitFor();
    expect(await page.evaluate(() => "stillHere" in window)).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => present().count()).toBe(0);
    expect(h.pageErrors).toEqual([]);
  });
});
