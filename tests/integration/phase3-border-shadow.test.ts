/**
 * Phase 3 acceptance (round 5 parity, D74): a frame's border and shadow in the inspector.
 * Both start as a title with **+**; adding one shows its fields, **−** removes it, and the
 * canvas draws what's stored. A shadow starts as the theme's, and Custom turns it into
 * values to tweak. Undo walks it back. Driven in real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Cards" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          {
            id: "card",
            name: "Card",
            width: 600,
            height: 300,
            layout: { mode: "stack", padding: 32 },
            style: { fill: "$color.surface", radius: "$radius.md" },
            children: [{ id: "label", type: "text", props: { content: "A card" } }],
          },
        ],
      },
    },
  });
}

/** An inspector section by its title. */
const section = (title: string): Locator =>
  page.locator(".inspector-section").filter({
    has: page.locator(".inspector-section-title", { hasText: new RegExp(`^${title}$`) }),
  });

const style = () => h.stored("card").style as Record<string, unknown> | undefined;

/** The card's painted outline and box shadow on the canvas. */
const painted = () =>
  page.locator(".editor-canvas [data-node-id='card']").evaluate((el) => {
    const css = getComputedStyle(el);
    return { outline: `${css.outlineWidth} ${css.outlineStyle}`, shadow: css.boxShadow };
  });

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='card']" });
  page = h.page;
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.locator('.layers [data-layer-id="card"] .layer-name').click();
  await section("Border").waitFor();
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: frame border and shadow", { timeout: 60_000 }, () => {
  it("an unbordered card shows two short rows, each with a +", async () => {
    for (const title of ["Border", "Shadow"]) {
      expect(await section(title).getAttribute("class")).toContain("is-empty");
      expect(await section(title).locator(".field").count()).toBe(0);
    }
    expect(await page.getByRole("button", { name: "Add border" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Add shadow" }).count()).toBe(1);
    expect((await painted()).shadow).toBe("none");
  });

  it("adds a border, edits its width and style, and draws it", async () => {
    await page.getByRole("button", { name: "Add border" }).click();
    await expect.poll(() => style()?.stroke).toEqual({ color: "$color.border", width: 2 });
    const border = section("Border");
    expect(await border.getByRole("textbox", { name: "Color" }).inputValue()).toBe("border");
    // Required: no reset buttons on color and width.
    expect(await border.getByRole("button", { name: /^Reset / }).count()).toBe(0);

    const width = border.getByRole("spinbutton", { name: "Width" });
    await width.fill("6");
    await width.press("Enter");
    await border.getByRole("combobox", { name: "Style" }).click();
    await page.getByRole("option", { name: "Dashed" }).click();
    await expect
      .poll(() => style()?.stroke)
      .toEqual({ color: "$color.border", width: 6, style: "dashed" });
    await expect.poll(async () => (await painted()).outline).toBe("6px dashed");

    // Clearing a required color is ignored, and the field shows the color again.
    const color = border.getByRole("textbox", { name: "Color" });
    await color.fill("");
    await color.press("Enter");
    await expect.poll(() => color.inputValue()).toBe("border");
    expect(style()?.stroke).toMatchObject({ color: "$color.border" });
  });

  it("adds the theme's shadow; Custom turns it into values to tweak", async () => {
    await page.getByRole("button", { name: "Add shadow" }).click();
    await expect.poll(() => style()?.shadow).toBe("$shadow.md");
    const shadow = section("Shadow");
    expect(await shadow.getByRole("combobox", { name: "Preset" }).textContent()).toContain("md");
    expect(await shadow.getByRole("spinbutton", { name: "Blur" }).count()).toBe(0);
    await expect.poll(async () => (await painted()).shadow).not.toBe("none");

    await shadow.getByRole("combobox", { name: "Preset" }).click();
    await page.getByRole("option", { name: /Custom/ }).click();
    const md = h.latestDeck().theme.shadow.md;
    await expect.poll(() => style()?.shadow).toEqual(md);

    const blur = shadow.getByRole("spinbutton", { name: "Blur" });
    await blur.fill("40");
    await blur.press("Enter");
    // A theme color is stored as its hex (shadows take hex only), at the shadow's opacity
    // (15%, from md's "#00000026"), like any new color: the shadow stays soft.
    const color = shadow.getByRole("textbox", { name: "Color" });
    await color.fill("primary");
    await color.press("Enter");
    const primary = h.latestDeck().theme.colors.primary;
    await expect.poll(() => style()?.shadow).toEqual({ ...md, blur: 40, color: `${primary}26` });
    await expect.poll(async () => (await painted()).shadow).toContain("40px");
  });

  it("− removes each; undo brings them back", async () => {
    await page.getByRole("button", { name: "Remove shadow" }).click();
    await page.getByRole("button", { name: "Remove border" }).click();
    await expect.poll(() => style()?.stroke ?? style()?.shadow).toBeUndefined();
    await expect.poll(async () => (await painted()).shadow).toBe("none");
    await expect.poll(() => section("Border").getAttribute("class")).toContain("is-empty");

    await page.locator(".editor-canvas").focus();
    await page.keyboard.press("Control+z");
    await expect.poll(() => style()?.stroke).toMatchObject({ width: 6 });
    const width = section("Border").getByRole("spinbutton", { name: "Width" });
    await expect.poll(() => width.inputValue()).toBe("6");
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
