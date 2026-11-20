/**
 * Phase 3 acceptance (round 5 parity, D78): the Theme styles dialog. Text styles and the
 * spacing, radius and shadow scales are edited as a draft the canvas previews live; Save is
 * one undoable `deck.setTheme`, merged so an agent's concurrent theme changes survive; Cancel
 * leaves the deck as it was. Driven in real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Theme } from "@veloce/core";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;
let deckId = "";

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Styles" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          { id: "title", type: "text", props: { content: "Big idea", style: "$text.h1" } },
          {
            id: "card",
            layout: { mode: "stack", padding: "$space.lg" },
            style: { fill: "$color.surface", radius: "$radius.md", shadow: "$shadow.sm" },
            children: [{ id: "body", type: "text", props: { content: "Detail" } }],
          },
        ],
      },
    },
  });
}

const theme = async (): Promise<Theme> => (await h.workspace.get(deckId)).deck.theme;
const dialog = () => page.getByRole("dialog", { name: "Theme styles" });
const field = (name: string) => dialog().getByRole("spinbutton", { name, exact: true });

/** The title's rendered font size and the card's padding, on the canvas. */
const canvas = () =>
  page.evaluate(() => {
    const title = document.querySelector(".editor-canvas [data-node-id='title']");
    const sizes = [title, ...(title?.querySelectorAll("*") ?? [])].map((el) =>
      el ? Number.parseFloat(getComputedStyle(el).fontSize) : 0,
    );
    const card = document.querySelector(".editor-canvas [data-node-id='card']");
    return {
      titleSize: Math.max(...sizes),
      cardPadding: card ? getComputedStyle(card).paddingTop : "",
    };
  });

async function type(name: string, value: string) {
  await field(name).fill(value);
  await field(name).press("Enter");
}

async function open() {
  await page.keyboard.press("Escape"); // nothing selected: the inspector shows the theme
  await page.getByRole("button", { name: "Edit theme styles…" }).click();
  await dialog().waitFor();
}

/** Select h1 (the title's style) in the Text styles list. */
const pickH1 = () =>
  dialog()
    .locator(".token-item", { has: page.getByText("h1", { exact: true }) })
    .click();

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='card']" });
  page = h.page;
  deckId = h.workspace.activeDeckId ?? "";
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: theme styles", { timeout: 60_000 }, () => {
  it("edits a text style as a live preview; Enter and Esc stay in the field", async () => {
    await open();
    expect(await dialog().getByRole("tab", { selected: true }).textContent()).toBe("Text styles");
    // The first style is selected; pick h1 (the title's).
    expect(
      await dialog().locator(".token-item[aria-pressed='true'] .token-name").textContent(),
    ).toBe("display");
    await pickH1();
    await type("Size", "100");
    // Enter committed the field, and the dialog is still open.
    expect(await dialog().isVisible()).toBe(true);
    await expect.poll(async () => (await canvas()).titleSize).toBe(100);
    expect((await theme()).text.h1?.size).toBe(80); // a preview: nothing saved yet

    await field("Size").fill("123");
    await field("Size").press("Escape"); // reverts the field, keeps the dialog
    expect(await field("Size").inputValue()).toBe("100");
    expect(await dialog().isVisible()).toBe(true);

    await dialog().getByRole("combobox", { name: "Weight" }).click();
    await page.getByRole("option", { name: /^Black/ }).click();
    await type("Letter spacing", "5");
    await dialog().getByRole("combobox", { name: "Case" }).click();
    await page.getByRole("option", { name: "UPPERCASE" }).click();
  });

  it("scales: edits a step, keeps used steps, removes unused ones, adds new ones", async () => {
    await dialog().getByRole("tab", { name: "Spacing" }).click();
    await type("lg", "100");
    await expect.poll(async () => (await canvas()).cardPadding).toBe("100px");
    // lg is used by the card: it can't be removed; xxl isn't: it can.
    expect(
      await dialog().getByRole("button", { name: 'Remove spacing step "lg"' }).isDisabled(),
    ).toBe(true);
    await dialog().getByRole("button", { name: 'Remove spacing step "xxl"' }).click();
    expect(await field("xxl").count()).toBe(0);

    await dialog().getByRole("button", { name: "Add spacing step" }).click();
    const name = dialog().getByLabel("New spacing step name");
    await name.fill("2x");
    await name.press("Enter");
    expect(await dialog().getByRole("alert").textContent()).toMatch(/Start with a letter/);
    await name.fill("huge");
    await name.press("Enter");
    expect(await field("huge").inputValue()).toBe("100"); // the largest step so far

    await dialog().getByRole("tab", { name: "Shadows" }).click();
    await dialog().locator(".token-item", { hasText: "sm" }).click();
    await type("Blur", "30");
  });

  it("Save writes it all as one undoable step; undo takes it all back", async () => {
    const before = h.userTransactions();
    await dialog().getByRole("button", { name: "Save" }).click();
    await expect.poll(() => dialog().count()).toBe(0);
    await expect.poll(async () => (await theme()).text.h1?.size).toBe(100);
    const saved = await theme();
    expect(saved.text.h1).toEqual({
      font: "heading",
      size: 100,
      weight: 900,
      lineHeight: 1.1,
      letterSpacing: 0.05,
      transform: "uppercase",
    });
    expect(saved.space).toMatchObject({ lg: 100, huge: 100 });
    expect(saved.space).not.toHaveProperty("xxl");
    expect(saved.shadow.sm?.blur).toBe(30);
    expect(saved.name).toBe("Veloce Light (custom)");
    expect(h.userTransactions()).toBe(before + 1);
    expect(h.changes.at(-1)?.label).toBe("Edit theme styles");

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await theme()).text.h1?.size).toBe(80);
    expect((await theme()).space).toHaveProperty("xxl");
    await expect.poll(async () => (await canvas()).titleSize).toBe(80);
  });

  it("Cancel leaves the deck as it was, preview included", async () => {
    await open();
    await pickH1();
    await type("Size", "40");
    await expect.poll(async () => (await canvas()).titleSize).toBe(40);
    const before = h.userTransactions();
    await dialog().getByRole("button", { name: "Cancel" }).click();
    await expect.poll(async () => (await canvas()).titleSize).toBe(80);
    expect(h.userTransactions()).toBe(before);
  });

  it("an agent's theme change while the dialog is open survives the save", async () => {
    await open();
    await pickH1();
    await type("Size", "90");
    const open_ = await h.workspace.get(deckId);
    open_.apply({
      origin: "agent:claude",
      label: "Recolor",
      ops: [
        {
          op: "deck.setTheme",
          theme: {
            ...open_.deck.theme,
            colors: { ...open_.deck.theme.colors, primary: "#ff0055" },
          },
        },
      ],
    });
    await dialog().getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await theme()).text.h1?.size).toBe(90);
    expect((await theme()).colors.primary).toBe("#ff0055");
  });

  it("also opens from File → Theme styles…", async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Theme styles…" }).click();
    await dialog().waitFor();
    await page.keyboard.press("Escape");
    await expect.poll(() => dialog().count()).toBe(0);
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
