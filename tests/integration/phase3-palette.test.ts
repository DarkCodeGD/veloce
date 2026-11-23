/**
 * Phase 3 acceptance (round 5, D92): the command palette. Ctrl+K (or View) opens one search
 * box over every command, setting, slide and layer; Enter runs what's highlighted, the last
 * commands run come first, and keys never leak to the editor. Real Chromium, real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  const text = (id: string, content: string, name?: string) => ({
    id,
    type: "text",
    ...(name && { name }),
    props: { content },
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Palette" } });
  const slides = [
    {
      id: "s1",
      children: [text("hello", "Welcome aboard"), text("tag", "Small print", "Tagline")],
    },
    { id: "s2", children: [text("results", "Results so far")] },
    { id: "s3", name: "Thanks", children: [text("bye", "See you")] },
  ];
  for (const slide of slides) {
    await agent.callTool({ name: "upsert_slide", arguments: { slide } });
  }
}

const READY = ".editor-canvas [data-node-id='hello']";
const palette = () => page.getByRole("dialog", { name: "Command palette" });
const search = () => page.getByRole("combobox", { name: /Search commands/ });
const position = () => page.locator(".deck-position").textContent();
const isOpen = async () => (await palette().count()) > 0;
/** The highlighted row's text. */
const highlighted = () => page.locator(".palette-item.is-active .palette-label").textContent();
const sectionTitles = () => page.locator(".palette-section").allTextContents();

async function open() {
  await page.keyboard.press("Control+k");
  await palette().waitFor();
}

/** Opens the palette, searches, and waits for `first` to be highlighted. */
async function find(query: string, first: string) {
  await open();
  await search().fill(query);
  await expect.poll(highlighted).toBe(first);
}

/** Finds `label` and runs it with Enter. */
async function runFromPalette(query: string, label: string) {
  await find(query, label);
  await page.keyboard.press("Enter");
  await expect.poll(isOpen).toBe(false);
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: READY });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: command palette", { timeout: 60_000 }, () => {
  it("opens from Ctrl+K and View, and Esc closes it, giving focus back", async () => {
    await page.getByRole("tab", { name: "Slides" }).click();
    const opener = page.locator(":focus");
    const openerName = await opener.getAttribute("aria-label").catch(() => null);
    await open();
    expect(await search().evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(isOpen).toBe(false);
    expect(
      await page
        .locator(":focus")
        .getAttribute("aria-label")
        .catch(() => null),
    ).toBe(openerName);

    await page.getByRole("button", { name: "View", exact: true }).click();
    const item = page.getByRole("menuitem", { name: "Command palette…" });
    expect(await item.locator(".menu-keys").textContent()).toBe("Ctrl+K");
    await item.click();
    await palette().waitFor();
    // A press outside it closes it too.
    await page.mouse.click(5, 890);
    await expect.poll(isOpen).toBe(false);
  });

  it("runs a command, with arrows that move in the list, not the slides", async () => {
    expect(await position()).toBe("1 / 3");
    await find("new sl", "New slide");
    await search().fill("slide"); // many results
    const first = await highlighted();
    await page.keyboard.press("ArrowDown");
    expect(await highlighted()).not.toBe(first);
    expect(await position()).toBe("1 / 3"); // the arrow stayed in the palette
    await page.keyboard.press("Escape");

    await runFromPalette("next sl", "Next slide");
    await expect.poll(position).toBe("2 / 3");
    // Run last: on top next time, before anything is typed.
    await open();
    expect((await sectionTitles())[0]).toBe("Recent");
    expect(await highlighted()).toBe("Next slide");
    await page.keyboard.press("Escape");
  });

  it("lists a command that can't run now, dimmed, and Enter leaves it alone", async () => {
    await find("align left", "Align left"); // nothing is selected
    const row = page.locator(".palette-item.is-active");
    expect(await row.getAttribute("aria-disabled")).toBe("true");
    expect(await row.locator(".palette-keys").count()).toBe(1); // with its keys
    await page.keyboard.press("Enter");
    expect(await isOpen()).toBe(true);
    await page.keyboard.press("Escape");
  });

  it("goes to a slide by its number, name or text", async () => {
    await runFromPalette("thanks", "Slide 3: Thanks");
    await expect.poll(position).toBe("3 / 3");
    await runFromPalette("2", "Slide 2: Results so far");
    await expect.poll(position).toBe("2 / 3");
    await find("1", "Slide 1: Welcome aboard");
    await page.keyboard.press("Escape");
  });

  it("finds a layer on any slide, going there and selecting it", async () => {
    await find("tagline", "Tagline");
    expect(await page.locator(".palette-item.is-active .palette-detail").textContent()).toBe(
      "Slide 1",
    );
    await page.keyboard.press("Enter");
    await expect.poll(position).toBe("1 / 3");
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Tagline");
    await page.keyboard.press("Escape"); // nothing selected again
  });

  it("flips a setting in place, and opens Preferences on the right tab for the rest", async () => {
    await find("snapping", "Snapping");
    expect(await page.locator(".palette-item.is-active").getAttribute("aria-checked")).toBe("true");
    await page.keyboard.press("Enter");
    await expect.poll(isOpen).toBe(false);
    await find("snapping", "Snapping");
    await expect
      .poll(() => page.locator(".palette-item.is-active").getAttribute("aria-checked"))
      .toBe(null);
    await page.keyboard.press("Enter"); // back on
    await expect.poll(isOpen).toBe(false);

    await runFromPalette("port", "Port");
    await page.getByRole("dialog", { name: "Preferences" }).waitFor();
    expect(await page.getByRole("tab", { name: "AI" }).getAttribute("aria-selected")).toBe("true");
    await page.getByRole("button", { name: "Done" }).click();
  });

  it("says when nothing matches", async () => {
    await open();
    await search().fill("qwertyuiop");
    await expect
      .poll(() => page.locator(".palette-empty").textContent())
      .toBe("Nothing matches “qwertyuiop”");
    await page.keyboard.press("Escape");
    expect(h.pageErrors).toEqual([]);
  });
});
