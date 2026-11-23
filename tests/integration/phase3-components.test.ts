/**
 * Phase 3 acceptance (round 6, D94): components. Save a card as a component with a param,
 * insert plain copies from the Components tab and the command palette, see an agent's
 * component arrive live, and delete one (undoably) while its copies stay. Real Chromium,
 * real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { element, frame } from "@veloce/core";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Components" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          {
            id: "card",
            name: "Feature card",
            width: 420,
            layout: { mode: "stack", gap: "$space.sm", padding: "$space.md" },
            style: { fill: "$color.surface", radius: "$radius.md" },
            children: [
              { id: "title", name: "Title", type: "text", props: { content: "Faster" } },
              { id: "body", type: "text", props: { content: "Twice the speed" } },
            ],
          },
        ],
      },
    },
  });
}

const READY = ".editor-canvas [data-node-id='title']";
const toast = () => page.locator(".toast").last().textContent();
const dialog = () => page.getByRole("dialog", { name: "Save as component" });
/** The slide's top-level layer IDs, as the server stores them. */
const topLevel = () => h.latestDeck().slides[0]?.root.children.map((c) => c.id) ?? [];
const items = () => page.locator(".component-item .component-name").allTextContents();

async function fromArrange(command: string) {
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
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

describe.skipIf(problem !== null)("Phase 3: components", { timeout: 60_000 }, () => {
  it("can't save with nothing selected, and the empty tab says how", async () => {
    await page.getByRole("button", { name: "Arrange", exact: true }).click();
    const item = page.getByRole("menuitem", { name: "Save as component…" });
    expect(await item.isDisabled()).toBe(true);
    await page.keyboard.press("Escape");

    await page.keyboard.press("Alt+5");
    await expect
      .poll(() => page.getByRole("tab", { name: "Components" }).getAttribute("aria-selected"))
      .toBe("true");
    expect(await page.locator(".components-empty").textContent()).toContain("No components yet.");
  });

  it("saves the selected card, offering its texts as params", async () => {
    await page.getByRole("tab", { name: "Layers" }).click();
    await page.getByRole("button", { name: "Feature card", exact: true }).click();
    await expect
      .poll(() => page.locator(".inspector-head strong").textContent())
      .toBe("Feature card");
    await fromArrange("Save as component…");
    expect(await dialog().getByRole("textbox", { name: "Name", exact: true }).inputValue()).toBe(
      "Feature card",
    );
    const title = dialog().getByRole("textbox", { name: "Param name for “Title”" });
    expect(await title.inputValue()).toBe("title");
    // The body stays the same in every copy.
    await dialog().getByRole("checkbox", { name: "Make “Twice the speed” a param" }).uncheck();
    await dialog().getByRole("textbox", { name: "Description" }).fill("A title and one line");
    await dialog().getByRole("button", { name: "Save" }).click();

    await expect.poll(toast).toBe('Saved component "Feature card"Undo');
    await expect.poll(() => dialog().count()).toBe(0);
    const saved = h.latestDeck().components?.["Feature card"];
    expect(saved?.description).toBe("A title and one line");
    expect(saved?.params).toEqual({ title: { targets: ["title.props.content"] } });
  });

  it("inserts plain copies from the tab and the palette, each one undo step", async () => {
    await page.getByRole("tab", { name: "Components" }).click();
    await expect.poll(items).toEqual(["Feature card"]);
    // Its preview is drawn by the slide renderer.
    await expect.poll(() => page.locator(".component-preview .slide-surface").count()).toBe(1);

    await page.keyboard.press("Escape"); // nothing selected: the copy goes at the end
    const before = h.userTransactions();
    await page.locator(".component-insert").click();
    await expect.poll(() => topLevel().length).toBe(2);
    expect(h.userTransactions()).toBe(before + 1);
    const copy = topLevel()[1] as string;
    expect(h.childIds(copy)).toEqual([`${copy}-title`, `${copy}-body`]);
    // Selected, and a plain node: nothing in the slide points at the component.
    await expect
      .poll(() => page.locator(".inspector-head strong").textContent())
      .toBe("Feature card");
    expect(JSON.stringify(h.latestDeck().slides)).not.toContain("components");

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: /Search commands/ }).fill("feature");
    const active = page.locator(".palette-item.is-active");
    await expect
      .poll(() => active.locator(".palette-detail").textContent())
      .toBe("Insert component");
    expect(await active.locator(".palette-label").textContent()).toBe("Feature card");
    await page.keyboard.press("Enter");
    await expect.poll(() => topLevel().length).toBe(3);

    await page.keyboard.press("Escape");
    await page.locator(".stage-area").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => topLevel().length).toBe(2);
  });

  it("shows an agent's component as soon as it's saved", async () => {
    const deck = await h.workspace.get(h.latestDeck().id);
    const result = deck.apply({
      origin: "agent:claude",
      label: "Save component",
      ops: [
        {
          op: "component.save",
          name: "Badge",
          component: {
            node: frame({
              id: "badge",
              children: [element("text", { content: "New" }, { id: "badge-label" })],
            }),
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    await expect.poll(items).toEqual(["Badge", "Feature card"]); // A to Z
  });

  it("deletes a component as one undoable step, and its copies stay", async () => {
    const remove = page.getByRole("button", { name: "Delete component “Feature card”" });
    await page.locator(".component-item").last().hover();
    await remove.click();
    await expect.poll(items).toEqual(["Badge"]);
    await expect.poll(toast).toBe('Deleted component "Feature card"Undo');
    expect(topLevel()).toHaveLength(2); // the copy is still on the slide

    await page.locator(".toast").last().getByRole("button", { name: "Undo" }).click();
    await expect.poll(items).toEqual(["Badge", "Feature card"]); // A to Z
    expect(h.pageErrors).toEqual([]);
  });
});
