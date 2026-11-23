/**
 * Phase 3 acceptance (round 5, D91): File → Preferences. Each setting does what it says the
 * moment it changes (snapping, nudge distance, lint, Follow AI), the server keeps it (a
 * reload shows it), and Keymap searches every shortcut. Real Chromium, real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** A free frame holding Box A and Box B (free layers: they snap and nudge). */
async function build(agent: Client) {
  const box = (id: string, name: string, x: number, y: number) => ({
    id,
    name,
    width: 160,
    height: 120,
    position: { x, y },
    layout: { mode: "stack" },
    style: { fill: "$color.primary" },
    children: [],
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Prefs", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "absolute" },
        children: [box("boxA", "Box A", 100, 100), box("boxB", "Box B", 700, 500)],
      },
    },
  });
  // Nothing on it: the "Empty slide" lint rule has something to say.
  await agent.callTool({ name: "upsert_slide", arguments: { slide: { id: "s2", children: [] } } });
}

const READY = ".editor-canvas [data-node-id='boxB']";
const field = (name: string) =>
  page.getByRole("dialog", { name: "Preferences" }).getByLabel(name, { exact: true });

/**
 * Flips a switch and waits for the server's answer: settings aren't changed optimistically
 * (the server owns them), so the switch shows the new state a round trip later.
 */
async function toggle(name: string, on: boolean) {
  await field(name).click();
  await expect.poll(() => field(name).isChecked()).toBe(on);
}
const tab = (name: string) => page.getByRole("tab", { name, exact: true });
const scale = () =>
  page.locator(".slide-surface").evaluate((el) => el.getBoundingClientRect().width / 1920);

async function openPreferences(on = "Editing") {
  await page.keyboard.press("Control+Comma");
  await page.getByRole("dialog", { name: "Preferences" }).waitFor();
  await tab(on).click();
}

async function closePreferences() {
  await page.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
}

/** Types a number into a field and commits it (Enter). */
async function setNumber(name: string, value: string) {
  await field(name).fill(value);
  await field(name).press("Enter");
}

async function select(name: string) {
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe(name);
}

/** Drags Box B so its left edge lands 4 slide px right of Box A's (x 100): snapping reach. */
async function dragNearBoxA() {
  const s = await scale();
  const b = await page.locator('.editor-canvas [data-node-id="boxB"]').boundingBox();
  if (!b) throw new Error("no Box B");
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const before = h.userTransactions();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 596 * s, from.y, { steps: 8 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

async function undo() {
  const before = h.userTransactions();
  await page.keyboard.press("Control+z");
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: READY });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: preferences", { timeout: 60_000 }, () => {
  it("opens from File → Preferences and Ctrl+,", async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    const item = page.getByRole("menuitem", { name: "Preferences…" });
    expect(await item.locator(".menu-keys").textContent()).toBe("Ctrl+,");
    await item.click();
    await page.getByRole("dialog", { name: "Preferences" }).waitFor();
    expect(await page.getByRole("tab").allTextContents()).toContain("Keymap");
    await closePreferences();
  });

  it("turns snapping off, and back on", async () => {
    await select("Box B");
    await dragNearBoxA();
    expect(h.stored("boxB").position?.x).toBe(100); // snapped to Box A's edge
    await undo();

    await openPreferences();
    await toggle("Snapping", false);
    await closePreferences();
    await select("Box B");
    await dragNearBoxA();
    expect(Math.abs((h.stored("boxB").position?.x ?? 0) - 104)).toBeLessThanOrEqual(2);
    await undo();

    await openPreferences();
    await toggle("Snapping", true);
    await closePreferences();
  });

  it("nudges by the distances set, remembered after a reload", async () => {
    await openPreferences();
    await setNumber("Shift nudge", "25");
    await closePreferences();
    await select("Box A");
    const x = h.stored("boxA").position?.x ?? 0;
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => h.stored("boxA").position?.x).toBe(x + 25);
    await h.synced();
    await undo();

    // The server keeps it: a fresh page gets it back.
    await page.reload();
    await page.locator(READY).waitFor();
    await openPreferences();
    expect(await field("Shift nudge").inputValue()).toBe("25");
    await field("Shift nudge").fill("");
    await field("Shift nudge").press("Enter"); // empty: back to the default
    await expect.poll(() => field("Shift nudge").getAttribute("placeholder")).toBe("10");
    expect(await field("Shift nudge").inputValue()).toBe("");
    await closePreferences();
  });

  it("mutes a lint rule, and turns lint off in the editor", async () => {
    const issues = page.locator(".issues-panel");
    await page.getByRole("tab", { name: "Issues" }).click();
    await expect.poll(() => issues.textContent()).toContain("Empty slide");

    await openPreferences();
    await toggle("Empty slide", false);
    await closePreferences();
    await expect.poll(() => issues.textContent()).not.toContain("Empty slide");

    await openPreferences();
    await toggle("Check slides", false);
    await closePreferences();
    await expect
      .poll(() => page.locator(".tab-panel").textContent())
      .toContain("Checking for issues is off.");
    await page.getByRole("button", { name: "Open Preferences" }).click();
    await toggle("Check slides", true);
    await toggle("Empty slide", true);
    await closePreferences();
    await expect.poll(() => issues.textContent()).toContain("Empty slide");
  });

  it("sets whether Follow AI starts on", async () => {
    const follow = page.locator(".follow input");
    expect(await follow.isChecked()).toBe(true);
    await openPreferences("AI");
    await toggle("Follow AI", false);
    expect(await page.locator(".copy-command code").textContent()).toMatch(
      /^claude mcp add --transport http veloce http:\/\/127\.0\.0\.1:\d+\/mcp$/,
    );
    await closePreferences();
    expect(await follow.isChecked()).toBe(false);
    await page.reload();
    await page.locator(READY).waitFor();
    await expect.poll(() => follow.isChecked()).toBe(false);
    await openPreferences("AI");
    await toggle("Follow AI", true);
    await closePreferences();
  });

  it("searches every shortcut in Keymap", async () => {
    await openPreferences("Keymap");
    const search = page.getByRole("searchbox", { name: "Search shortcuts" });
    await search.fill("zoom sel");
    await expect
      .poll(() => page.locator(".preferences-panel .shortcut-row dt").allTextContents())
      .toEqual(["Zoom to selection"]);
    await search.fill("ctrl d"); // by its keys too
    await expect
      .poll(() => page.locator(".preferences-panel .shortcut-row dt").allTextContents())
      .toContain("Duplicate");
    await search.fill("qwertyuiop");
    await expect.poll(() => page.locator(".shortcut-empty").count()).toBe(1);
    await closePreferences();
    expect(h.pageErrors).toEqual([]);
  });
});
