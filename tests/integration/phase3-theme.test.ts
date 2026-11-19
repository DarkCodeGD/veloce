/**
 * Phase 3 acceptance (theme): switching built-in themes, editing palette colors and fonts,
 * contrast warnings, font previews in token pickers, and snapping a raw color back to the
 * theme. Every theme change is one `deck.setTheme` transaction, undone in one step. Driven
 * in real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Themes", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          { id: "title", type: "text", props: { content: "Quarterly review", style: "$text.h1" } },
          { id: "body", type: "text", props: { content: "Revenue is up", style: "$text.body" } },
        ],
      },
    },
  });
}

const theme = () => h.latestDeck().theme;
const card = (name: string) => page.locator(".theme-card", { hasText: name });
/** A palette row by its exact token name ("primary" must not match "on-primary"). */
const colorRow = (name: string) =>
  page
    .locator(".theme-color")
    .filter({ has: page.locator(".theme-color-name", { hasText: new RegExp(`^${name}$`) }) });
const canvasNode = (id: string) => page.locator(`.editor-canvas [data-node-id='${id}']`);
/** The computed style of the text inside a node on the main canvas. */
const computed = (id: string, prop: "fontFamily" | "color") =>
  canvasNode(id)
    .locator(".v-text")
    .first()
    .evaluate((el, p) => getComputedStyle(el)[p as "color"], prop);

/** Open a palette color's picker (its swatch) and return the picker. */
async function openPicker(name: string) {
  await colorRow(name)
    .getByRole("button", { name: `Theme color ${name}` })
    .click();
  const picker = page.getByRole("dialog", { name: "Color picker" });
  await picker.waitFor();
  return picker;
}

/** Type a hex into the open picker; Enter commits it. */
async function typeHex(name: string, hex: string) {
  const input = page.getByRole("textbox", { name: `Theme color ${name} hex` });
  await input.fill(hex);
  await input.press("Enter");
}

async function undo() {
  const before = h.userTransactions();
  await page.keyboard.press("Control+z");
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='title']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: themes", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await h.synced();
    // Nothing selected: the inspector shows the slide and the theme.
    await page.keyboard.press("Escape");
    await page.locator(".theme-grid").waitFor();
  });

  it("switches the whole deck to another built-in theme in one undoable step", async () => {
    await expect.poll(() => card("Midnight").getAttribute("aria-pressed")).toBe("true");
    const before = h.userTransactions();
    await card("Paper").click();
    await expect.poll(() => theme().name).toBe("Paper");
    expect(h.userTransactions()).toBe(before + 1);
    expect(h.changes.at(-1)?.label).toBe('Set theme "Paper"');
    await h.synced();
    // The slide restyles: Paper's serif heading font, actually loaded (it's lazy).
    await expect.poll(() => computed("title", "fontFamily")).toMatch(/^Fraunces/);
    await expect
      .poll(() => page.evaluate(() => document.fonts.check("650 80px Fraunces")))
      .toBe(true);
    expect(await card("Paper").getAttribute("aria-pressed")).toBe("true");

    await undo();
    expect(theme().name).toBe("Midnight");
    await expect.poll(() => computed("title", "fontFamily")).toMatch(/^Inter/);
  });

  it("edits a palette color: a drag previews on the slide, its release commits once", async () => {
    const before = h.userTransactions();
    const picker = await openPicker("text");
    // The picker sits beside the inspector, inside the window (the browser's own popup
    // overflowed the screen on Wayland).
    const box = await picker.boundingBox();
    const inspector = await page.locator(".inspector").boundingBox();
    const viewport = page.viewportSize();
    if (!box || !inspector || !viewport) throw new Error("no layout");
    expect(box.x + box.width).toBeLessThanOrEqual(inspector.x);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // Drag in the square: the slide's text (which uses $color.text) recolors live.
    const area = await picker
      .getByRole("slider", { name: /saturation and brightness/ })
      .boundingBox();
    if (!area) throw new Error("no square");
    await page.mouse.move(area.x + area.width * 0.9, area.y + area.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * 0.8, area.y + area.height * 0.2, { steps: 4 });
    await expect.poll(() => computed("title", "color")).not.toBe("rgb(238, 242, 255)");
    expect(h.userTransactions()).toBe(before);
    await page.mouse.up();
    await expect.poll(() => h.userTransactions()).toBe(before + 1);
    expect(h.changes.at(-1)?.label).toBe('Change theme color "text"');
    expect(theme().colors.text).toMatch(/^#[0-9a-f]{6}$/);

    // A typed hex: one more step.
    await typeHex("text", "#22cc88");
    await expect.poll(() => theme().colors.text).toBe("#22cc88");
    expect(h.userTransactions()).toBe(before + 2);
    expect(theme().name).toBe("Midnight (custom)");
    await h.synced();
    await expect.poll(() => computed("title", "color")).toBe("rgb(34, 204, 136)");
    // Esc closes the picker, nothing else.
    await page.keyboard.press("Escape");
    await expect.poll(() => picker.count()).toBe(0);
    // Customized: no built-in card is current, and the panel says so.
    expect(await page.locator('.theme-card[aria-pressed="true"]').count()).toBe(0);
    await expect
      .poll(() => page.locator(".inspector-hint", { hasText: "Customized" }).count())
      .toBe(1);

    await undo();
    await undo();
    expect(theme().colors.text).toBe("#eef2ff");
    expect(theme().name).toBe("Midnight");
  });

  it("gives a palette color an opacity: the picker has alpha", async () => {
    await openPicker("surface");
    const percent = page.getByRole("textbox", { name: "Theme color surface opacity percent" });
    const before = theme().colors.surface ?? "";
    await percent.fill("50");
    await percent.press("Enter");
    await expect.poll(() => theme().colors.surface).toBe(`${before.slice(0, 7)}80`);
    await page.keyboard.press("Escape");
    await undo();
    expect(theme().colors.surface).toBe(before);
  });

  it("warns about hard-to-read color pairs as you edit the palette", async () => {
    expect(await page.locator(".theme-issues").count()).toBe(0);
    const muted = colorRow("muted");
    await openPicker("muted");
    await typeHex("muted", "#2a3360");
    await page.keyboard.press("Escape");
    await expect.poll(() => theme().colors.muted).toBe("#2a3360");
    await h.synced();
    await expect
      .poll(() => page.locator(".theme-issues li").allTextContents())
      .toEqual([
        expect.stringContaining("muted on background is hard to read"),
        expect.stringContaining("muted on surface is hard to read"),
      ]);
    expect(await muted.getAttribute("class")).toContain("is-warn");
    await undo();
    await expect.poll(() => page.locator(".theme-issues").count()).toBe(0);
  });

  it("changes a theme font from the bundled fonts, each shown in its own typeface", async () => {
    await page.getByRole("combobox", { name: "Body" }).click();
    const lora = page.getByRole("option", { name: /Lora/ });
    expect(
      await lora.locator(".select-label").evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/^Lora/);
    await lora.click();
    await expect.poll(() => theme().fonts.body).toBe("Lora, Georgia, serif");
    expect(h.changes.at(-1)?.label).toBe('Change theme font "body"');
    await h.synced();
    await expect.poll(() => computed("body", "fontFamily")).toMatch(/^Lora/);
    await expect.poll(() => computed("title", "fontFamily")).toMatch(/^Inter/); // heading untouched
    await undo();
    expect(theme().fonts.body).toBe("Inter, system-ui, sans-serif");
  });

  it("snaps a raw text color to the closest theme color", async () => {
    await canvasNode("title").click();
    const field = page.getByRole("textbox", { name: "Color", exact: true });
    await field.fill("#8a6efe");
    await field.press("Enter");
    await expect.poll(() => h.stored("title").props?.color).toBe("#8a6efe");
    await h.synced();
    const snap = page.getByRole("button", { name: /Use theme color “primary”/ });
    await snap.click();
    await expect.poll(() => h.stored("title").props?.color).toBe("$color.primary");
    await h.synced();
    // On-theme now: the snap offer is gone and the primary swatch is current.
    expect(await snap.count()).toBe(0);
    expect(
      await page.getByRole("button", { name: "Color: primary" }).getAttribute("aria-pressed"),
    ).toBe("true");
    await undo();
    await undo();
    expect(h.stored("title").props?.color).toBeUndefined();
  });

  it("names the deck in the window title, with no in-app logo", async () => {
    expect(await page.title()).toBe("Themes – Veloce");
    expect(await page.locator(".topbar .brand").count()).toBe(0);
    expect(await page.locator(".topbar .deck-title").textContent()).toBe("Themes");
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
