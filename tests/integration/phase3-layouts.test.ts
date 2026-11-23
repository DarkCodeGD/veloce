/**
 * Phase 3 acceptance (round 6, D95): slide layouts. Start a slide from a built-in layout,
 * save a slide as the deck's own layout, start slides from it (the dialog and the palette),
 * and delete it, undoably. Real Chromium, real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Layouts" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        name: "Agenda",
        background: "$color.surface",
        children: [
          {
            id: "head",
            name: "Heading",
            type: "text",
            props: { content: "Agenda", style: "$text.h1" },
          },
          { id: "items", type: "text", props: { content: "One, two, three" } },
        ],
      },
    },
  });
}

const READY = ".editor-canvas [data-node-id='head']";
const position = () => page.locator(".deck-position").textContent();
const toast = () => page.locator(".toast").last().textContent();
const layoutsDialog = () => page.getByRole("dialog", { name: "New slide from layout" });
const layoutNames = () => layoutsDialog().locator(".layout-name").allTextContents();

async function fromSlideMenu(command: string) {
  await page.getByRole("button", { name: "Slide", exact: true }).click();
  await page.getByRole("menuitem", { name: command }).click();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: READY });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: slide layouts", { timeout: 60_000 }, () => {
  it("starts a slide from a built-in layout, drawn in the deck's theme", async () => {
    await fromSlideMenu("New slide from layout…");
    await expect
      .poll(layoutNames)
      .toEqual([
        "Title",
        "Title and content",
        "Two columns",
        "Section header",
        "Big number",
        "Quote",
      ]);
    await expect.poll(() => layoutsDialog().locator(".slide-surface").count()).toBe(6);

    await layoutsDialog()
      .getByRole("button", { name: /^Title and content/ })
      .click();
    await expect.poll(() => layoutsDialog().count()).toBe(0);
    await expect.poll(position).toBe("2 / 2");
    const made = h.latestDeck().slides[1];
    expect(made?.root.children.map((c) => c.id)).toEqual([
      `${made?.id}-title`,
      `${made?.id}-content`,
    ]);
  });

  it("saves a slide as the deck's own layout, its texts as params", async () => {
    await page.keyboard.press("Home"); // back to the first slide
    await expect.poll(position).toBe("1 / 2");
    await fromSlideMenu("Save slide as layout…");
    const dialog = page.getByRole("dialog", { name: "Save slide as layout" });
    expect(await dialog.getByRole("textbox", { name: "Name", exact: true }).inputValue()).toBe(
      "Agenda",
    );
    expect(
      await dialog.getByRole("textbox", { name: "Param name for “Heading”" }).inputValue(),
    ).toBe("heading");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect.poll(toast).toBe('Saved slide layout "Agenda"Undo');
    const saved = h.latestDeck().components?.Agenda;
    expect(saved?.slide).toEqual({ background: "$color.surface" });
    // Not a layer component: the Components tab doesn't list it.
    await page.getByRole("tab", { name: "Components" }).click();
    await expect.poll(() => page.locator(".components-empty").count()).toBe(1);
  });

  it("starts slides from it, from the dialog and the palette", async () => {
    await fromSlideMenu("New slide from layout…");
    await expect.poll(layoutNames).toContain("Agenda");
    expect((await layoutNames())[0]).toBe("Agenda"); // the deck's own first
    await layoutsDialog()
      .getByRole("button", { name: /^Agenda/ })
      .click();
    await expect.poll(position).toBe("2 / 3");
    expect(h.latestDeck().slides[1]?.background).toBe("$color.surface");

    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: /Search commands/ }).fill("agenda");
    const active = page.locator(".palette-item.is-active");
    await expect
      .poll(() => active.locator(".palette-detail").textContent())
      .toBe("New slide from layout");
    await page.keyboard.press("Enter");
    await expect.poll(position).toBe("3 / 4");
  });

  it("deletes the deck's own layout as one undoable step", async () => {
    await fromSlideMenu("New slide from layout…");
    await layoutsDialog().locator(".layout-card").first().hover();
    await layoutsDialog().getByRole("button", { name: "Delete layout “Agenda”" }).click();
    await expect.poll(layoutNames).not.toContain("Agenda");
    expect(h.latestDeck().slides).toHaveLength(4); // its slides stay
    await page.keyboard.press("Escape");
    await expect.poll(toast).toBe('Deleted layout "Agenda"Undo');
    await page.locator(".toast").last().getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => h.latestDeck().components?.Agenda !== undefined).toBe(true);
    expect(h.pageErrors).toEqual([]);
  });
});
