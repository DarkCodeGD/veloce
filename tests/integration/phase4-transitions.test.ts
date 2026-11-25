/**
 * Phase 4 acceptance (slide transitions, D123): presenting, each slide arrives over the
 * last with its transition. A morph glides the layer both slides share (its match key) from
 * where it was to where it is, while the rest of the new slide fades in; a push travels
 * both slides together; a click while one plays lands it at once; going back cuts. Real
 * Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

const box = (id: string, x: number, size: number, matchKey?: string) => ({
  id,
  type: "shape",
  width: size,
  height: size,
  position: { x, y: 300 },
  ...(matchKey && { matchKey }),
  props: { shape: "rect", fill: "$color.primary" },
});

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Moves", theme: "midnight" } });
  const slides = [
    { id: "s1", children: [box("s1-logo", 100, 200, "logo")] },
    { id: "s2", children: [box("s2-logo", 1300, 400, "logo"), box("s2-new", 100, 200)] },
    { id: "s3", children: [box("s3-box", 800, 300)] },
    { id: "s4", children: [box("s4-box", 800, 300)] },
  ];
  for (const slide of slides) {
    await agent.callTool({
      name: "upsert_slide",
      arguments: { slide: { ...slide, layout: { mode: "absolute" } } },
    });
  }
}

const present = () => page.locator("dialog.present");
const shown = (id: string) => present().locator(`[data-node-id="${id}"]`);
/** Where a layer is drawn right now, in screen pixels. */
const rect = (id: string) =>
  shown(id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), width: Math.round(r.width) };
  });
const opacity = (id: string) => shown(id).evaluate((el) => Number(getComputedStyle(el).opacity));
/** Inline styles a transition leaves on the slides' frames (none once it has ended). */
const frameStyles = () =>
  present()
    .locator(".present-stage > div")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.transform).join(""));

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas .slide-surface" });
  page = h.page;
  const doc = await h.workspace.get(h.latestDeck().id);
  const slow = { duration: 3000, easing: "linear" } as const;
  const result = doc.apply({
    origin: "agent:test",
    label: "Transitions",
    ops: [
      { op: "slide.update", id: "s2", set: { transition: { type: "morph", ...slow } } },
      {
        op: "slide.update",
        id: "s3",
        set: { transition: { type: "push", direction: "left", ...slow } },
      },
      { op: "slide.update", id: "s4", set: { transition: { type: "fade", duration: 8000 } } },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
}, 90_000);

afterAll(async () => {
  if (problem) return;
  await h.close();
});

describe.skipIf(problem !== null)("Phase 4: slide transitions (D123)", { timeout: 60_000 }, () => {
  it("morphs: the shared layer glides from its old box to its new one", async () => {
    await h.synced();
    await page.locator(".rail .thumb").first().click();
    await page.getByRole("button", { name: "Present" }).click();
    await shown("s1-logo").waitFor();
    const from = await rect("s1-logo");
    await page.keyboard.press("ArrowRight");
    await shown("s2-logo").waitFor();
    // It starts on the old logo (small, on the left), not where it rests.
    const early = await rect("s2-logo");
    expect(Math.abs(early.left - from.left)).toBeLessThan(from.width);
    expect(early.width).toBeLessThan(from.width * 1.5);
    expect(await opacity("s2-new")).toBeLessThan(0.5); // the rest of s2 fades in
    // Partway there…
    await expect
      .poll(async () => (await rect("s2-logo")).left, { timeout: 3000 })
      .toBeGreaterThan(early.left + 100);
    // …and it lands where s2 has it, at its own size; the old slide is gone.
    await expect.poll(() => frameStyles(), { timeout: 5000 }).toBe("");
    await expect.poll(async () => (await rect("s2-logo")).width).toBe(from.width * 2);
    await expect.poll(() => shown("s1-logo").count()).toBe(0);
    expect(await present().locator("[data-transition-backdrop]").count()).toBe(0);
  });

  it("pushes: both slides travel together, the new one in from the right", async () => {
    const before = await rect("s2-logo");
    await page.keyboard.press("ArrowRight");
    await shown("s3-box").waitFor();
    // While it plays both are on screen, the old one moving off to the left.
    await expect
      .poll(async () => (await rect("s2-logo")).left, { timeout: 3000 })
      .toBeLessThan(before.left - 100);
    expect(await shown("s3-box").isVisible()).toBe(true);
    await expect.poll(() => frameStyles(), { timeout: 5000 }).toBe("");
    await expect.poll(() => shown("s2-logo").count()).toBe(0);
  });

  it("a click while one plays lands it at once; going back cuts", async () => {
    await page.keyboard.press("ArrowRight"); // s4: an 8 s fade
    await shown("s4-box").waitFor();
    await page.keyboard.press("ArrowRight"); // impatient: it lands, then on to the end
    await expect.poll(() => frameStyles(), { timeout: 1000 }).toBe("");
    await present().getByText("End of presentation").waitFor();
    await page.keyboard.press("ArrowLeft"); // s4
    await page.keyboard.press("ArrowLeft"); // s3: a cut, nothing travels
    await shown("s3-box").waitFor();
    expect(await frameStyles()).toBe("");
    expect(await shown("s4-box").count()).toBe(0);
    await page.keyboard.press("Escape");
    await expect.poll(() => present().count()).toBe(0);
  });

  it("the Animate panel picks a slide's transition, tunes it, and previews it on the canvas", async () => {
    const panel = page.locator(".animate-panel");
    const slideOf = (id: string) => h.latestDeck().slides.find((s) => s.id === id);
    await page.getByRole("tab", { name: "Animate" }).click();
    await page.locator(".rail .thumb").first().click(); // s1: the theme's signature
    await panel.getByText("Theme's (Zoom)").waitFor();
    await page.locator(".rail .thumb").nth(1).click(); // s2: its own morph
    await panel.getByText("1 layer glides from the slide before").waitFor();
    await panel.getByRole("combobox", { name: "Arrives" }).click();
    await page.getByRole("option", { name: "Push" }).click();
    await expect.poll(() => slideOf("s2")?.transition?.type).toBe("push");
    expect(slideOf("s2")?.transition).toMatchObject({ duration: 3000, easing: "linear" }); // kept
    await panel.getByRole("combobox", { name: "Travels" }).click();
    await page.getByRole("option", { name: "Up" }).click();
    await expect.poll(() => slideOf("s2")?.transition?.direction).toBe("up");
    // Preview: s1 plays into s2 over the slide on the canvas, then the canvas is back.
    await panel.getByRole("button", { name: "Preview" }).click();
    await page.locator(".editor-canvas .transition-preview").waitFor();
    expect(await page.locator(".editor-canvas.is-playing").count()).toBe(1);
    await page
      .locator(".editor-canvas .transition-preview")
      .waitFor({ state: "detached", timeout: 8000 });
    expect(await page.locator(".editor-canvas .slide-surface").isVisible()).toBe(true);
    // One click and every slide arrives the same way.
    await panel.getByRole("button", { name: "Use on every slide" }).click();
    await expect
      .poll(() => h.latestDeck().slides.map((s) => s.transition?.direction ?? null))
      .toEqual(["up", "up", "up", "up"]);
  });
});
