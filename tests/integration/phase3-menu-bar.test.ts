/**
 * Phase 3 acceptance (round 5, D89): the app menu bar. Every menu item is a registry command
 * with its shortcut, run through the same transactions as the keys; the menus behave like a
 * desktop menu bar (←/→ between menus, hover switches an open one); the keys that used to
 * be hard-coded run registry commands. Driven in real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Menus" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [{ id: "t", type: "text", name: "Title", props: { content: "Hello" } }],
      },
    },
  });
}

const bar = (name: string) => page.getByRole("button", { name, exact: true });
type ItemRole = "menuitem" | "menuitemradio" | "menuitemcheckbox";
const item = (name: string, role: ItemRole = "menuitem") =>
  page.getByRole(role, { name, exact: true });
const focused = () => page.evaluate(() => document.activeElement?.textContent ?? "");
const slideCount = () => h.latestDeck().slides.length;
const rootChildren = () => h.latestDeck().slides[0]?.root.children ?? [];

/** Pick a command from a menu of the bar. */
async function choose(menu: string, command: string, role?: ItemRole) {
  await bar(menu).click();
  await item(command, role).click();
}

async function selectTitle() {
  await page.locator('.editor-canvas [data-node-id="t"]').click();
  await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Title");
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='t']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: menu bar", { timeout: 60_000 }, () => {
  it("shows every menu, items with their shortcuts, disabled when they can't run", async () => {
    for (const name of ["File", "Edit", "View", "Insert", "Slide", "Arrange", "Help"]) {
      expect(await bar(name).isVisible()).toBe(true);
    }
    await page.locator(".stage-area").click({ position: { x: 5, y: 5 } }); // nothing selected
    await bar("Edit").click();
    expect(await item("Undo").locator(".menu-keys").textContent()).toBe("Ctrl+Z");
    expect(await item("Duplicate").isDisabled()).toBe(true);
    expect(await item("Paste").isDisabled()).toBe(false);
    // Groups are separated by lines.
    expect(await page.locator(".menu-popup .menu-separator").count()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
  });

  it("moves between menus with the arrows and by pointing while one is open", async () => {
    await bar("File").focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(focused).toBe("New deck…");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => bar("Edit").getAttribute("aria-expanded")).toBe("true");
    expect(await bar("File").getAttribute("aria-expanded")).toBe("false");
    await expect.poll(focused).toContain("Undo");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft"); // wraps around to Help
    await expect.poll(() => bar("Help").getAttribute("aria-expanded")).toBe("true");
    await bar("Insert").hover();
    await expect.poll(() => bar("Insert").getAttribute("aria-expanded")).toBe("true");
    expect(await page.getByRole("menu").count()).toBe(1);
    await page.keyboard.press("Escape");
    expect(await page.getByRole("menu").count()).toBe(0);
    await expect.poll(focused).toBe("Insert");
    // On a closed menu button, the arrows move along the bar without changing slides.
    await page.keyboard.press("ArrowRight");
    await expect.poll(focused).toBe("Slide");
    expect(await page.getByRole("menu").count()).toBe(0);
  });

  it("crosses a menu whose every command is disabled (focus stays in it)", async () => {
    await page.locator(".stage-area").click({ position: { x: 5, y: 5 } }); // nothing to arrange
    await bar("Arrange").click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.role)).toBe("menu");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => bar("Help").getAttribute("aria-expanded")).toBe("true");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => bar("Arrange").getAttribute("aria-expanded")).toBe("true");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect.poll(focused).toBe("Help");
  });

  it("runs commands as the user's transactions, and their shortcuts too", async () => {
    await selectTitle();
    const before = h.userTransactions();
    await choose("Edit", "Duplicate");
    await expect.poll(() => rootChildren().length).toBe(2);
    expect(h.userTransactions()).toBe(before + 1);
    await h.synced();
    // Ctrl+Z is a registry command now: one undo step back.
    await page.keyboard.press("Control+z");
    await expect.poll(() => rootChildren().length).toBe(1);

    await choose("Slide", "New slide");
    await expect.poll(slideCount).toBe(2);
    await expect.poll(() => page.locator(".deck-position").textContent()).toBe("2 / 2");
    // With nothing selected the arrows go between slides.
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => page.locator(".deck-position").textContent()).toBe("1 / 2");
    await page.keyboard.press("End");
    await expect.poll(() => page.locator(".deck-position").textContent()).toBe("2 / 2");
    await choose("Slide", "Delete slide");
    await expect.poll(slideCount).toBe(1);
  });

  it("copies from the Edit menu to the system clipboard; Paste from the menu explains", async () => {
    await selectTitle();
    await choose("Edit", "Copy");
    const before = h.userTransactions();
    await page.keyboard.press("Control+v");
    await expect.poll(() => rootChildren().length).toBe(2);
    expect(h.userTransactions()).toBe(before + 1);
    await h.synced();
    await page.keyboard.press("Control+z");
    await expect.poll(() => rootChildren().length).toBe(1);
    // A browser never lets a menu read the clipboard: the toast names the key instead.
    await choose("Edit", "Paste");
    await expect.poll(() => page.locator(".toast").last().textContent()).toContain("press Ctrl+V");
  });

  it("switches panels from View and with Alt+digit; Follow AI is a check box", async () => {
    await choose("View", "Layers", "menuitemradio"); // one panel of several
    const tab = (name: string) => page.getByRole("tab", { name });
    await expect.poll(() => tab("Layers").getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("Alt+1");
    await expect.poll(() => tab("Slides").getAttribute("aria-selected")).toBe("true");
    await bar("View").click();
    const follow = page.getByRole("menuitemcheckbox", { name: "Follow AI" });
    expect(await follow.getAttribute("aria-checked")).toBe("true");
    await follow.click();
    expect(await page.locator(".follow input").isChecked()).toBe(false);
    await choose("View", "Follow AI", "menuitemcheckbox");
    expect(await page.locator(".follow input").isChecked()).toBe(true);
  });

  it("lists every shortcut in Help → Keyboard shortcuts, also opened with Ctrl+/", async () => {
    await page.locator(".stage-area").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+/");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await dialog.waitFor();
    const row = dialog.locator(".shortcut-row", { hasText: "Duplicate" }).first();
    expect(await row.locator("kbd").allTextContents()).toEqual(["Ctrl", "D"]);
    expect(await dialog.getByText("Pan the canvas").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => dialog.count()).toBe(0);
    expect(h.pageErrors).toEqual([]);
  });
});
