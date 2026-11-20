/**
 * Phase 3 acceptance (round 5 parity, D75): per-side padding in the inspector. One field for
 * all sides, or four with "Individual sides"; it opens by itself on padding an agent set per
 * side, edits one side without losing the others, and turning it off keeps the value most
 * sides had. Driven in real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Padding" } });
  const label = (id: string) => ({ id, type: "text", props: { content: id } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          {
            id: "card",
            name: "Card",
            layout: { mode: "stack", padding: { x: 40, y: 20 } },
            style: { fill: "$color.surface" },
            children: [label("in-card")],
          },
          { id: "plain", name: "Plain", layout: { mode: "stack" }, children: [label("in-plain")] },
        ],
      },
    },
  });
}

const toggle = () => page.getByRole("button", { name: "Individual sides" });
const px = (name: string) => page.getByRole("spinbutton", { name: `${name} in pixels` });
/** The card's padding as the server stores it. */
const padding = () => {
  const card = h.stored("card");
  return card.kind === "frame" ? card.layout.padding : undefined;
};

/** The card's rendered padding on the canvas, clockwise from the top. */
const rendered = () =>
  page.locator(".editor-canvas [data-node-id='card']").evaluate((el) => {
    const css = getComputedStyle(el);
    return [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft].join(" ");
  });

async function selectLayer(id: string) {
  await page.locator(`.layers [data-layer-id="${id}"] .layer-name`).click();
}

/** Type a pixel value into a field and commit it. */
async function type(name: string, value: string) {
  await px(name).fill(value);
  await px(name).press("Enter");
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='card']" });
  page = h.page;
  await page.getByRole("tab", { name: "Layers" }).click();
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: per-side padding", { timeout: 60_000 }, () => {
  it("a frame without padding shows one field, sides closed", async () => {
    await selectLayer("plain");
    await expect.poll(() => toggle().getAttribute("aria-pressed")).toBe("false");
    expect(await page.getByRole("combobox", { name: "Padding" }).textContent()).toContain(
      "Default",
    );
    expect(await page.getByRole("combobox", { name: "Top" }).count()).toBe(0);
  });

  it("opens by itself on an agent's x/y padding, showing each side", async () => {
    await selectLayer("card");
    await expect.poll(() => toggle().getAttribute("aria-pressed")).toBe("true");
    const values = await Promise.all(
      ["Top", "Right", "Bottom", "Left"].map((n) => px(n).inputValue()),
    );
    expect(values).toEqual(["20", "40", "20", "40"]);
  });

  it("edits one side and keeps the others", async () => {
    await type("Left", "80");
    await expect.poll(padding).toEqual({ top: 20, right: 40, bottom: 20, left: 80 });
    await expect.poll(rendered).toBe("20px 40px 20px 80px");
  });

  it("turning it off keeps the value most sides have, as one value", async () => {
    await toggle().click();
    await expect.poll(padding).toBe(20);
    await expect.poll(() => px("Padding").inputValue()).toBe("20");
    expect(await toggle().getAttribute("aria-pressed")).toBe("false");
    await expect.poll(rendered).toBe("20px 20px 20px 20px");
  });

  it("turning it on changes nothing until a side is edited; a side takes a theme token", async () => {
    await toggle().click();
    await expect.poll(() => px("Bottom").inputValue()).toBe("20");
    expect(padding()).toBe(20);

    await page.getByRole("combobox", { name: "Top" }).click();
    await page.getByRole("option", { name: /^md/ }).click();
    await expect.poll(padding).toEqual({ top: "$space.md", right: 20, bottom: 20, left: 20 });
    await expect.poll(rendered).toBe("32px 20px 20px 20px");

    // Undo walks back to one value; the sides stay open (the user turned them on).
    await page.locator(".editor-canvas").focus();
    await page.keyboard.press("Control+z");
    await expect.poll(padding).toBe(20);
  });

  it("the toggle doesn't carry over to another layer", async () => {
    await selectLayer("plain");
    await expect.poll(() => toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
