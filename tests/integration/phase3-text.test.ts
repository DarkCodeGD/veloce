/**
 * Phase 3 acceptance (typing on the slide): double-click or Enter edits a text layer in
 * place with TipTap; typing previews live (the layout reflows) without touching the server;
 * leaving commits ONE transaction in the core rich text model; formatting, lists and links
 * map to it. Driven in real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

const BODY = [
  { runs: [{ text: "Intro " }, { text: "bold", bold: true }] },
  { runs: [{ text: "First" }], list: "bullet" },
  { runs: [{ text: "Second" }], list: "bullet" },
];

/** The slide: Card (stack) > [Title, Body (rich), Footer], plus a locked note. */
async function build(agent: Client) {
  const text = (id: string, name: string, content: unknown, style = "$text.body", extra = {}) => ({
    id,
    name,
    type: "text",
    props: { content, style },
    ...extra,
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Text", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          {
            id: "card",
            name: "Card",
            width: 700,
            layout: { mode: "stack", gap: "$space.md", padding: "$space.md" },
            style: { fill: "$color.surface" },
            children: [
              text("title", "Title", "Hello world", "$text.h1"),
              text("body", "Body", BODY),
              text("footer", "Footer", "Footer"),
            ],
          },
          text("note", "Note", "Locked note", "$text.body", { locked: true }),
        ],
      },
    },
  });
}

const layer = (id: string) => page.locator(`.editor-canvas [data-node-id="${id}"]`);
const editorFocused = () =>
  page.evaluate(() => document.activeElement?.classList.contains("text-edit-content") ?? false);
const inspectorTitle = () => page.locator(".inspector-head strong").textContent();
const content = (id: string) => h.stored(id).props?.content;

async function centreOf(id: string) {
  const b = await layer(id).boundingBox();
  if (!b) throw new Error(`${id} not on the canvas`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, top: b.y, height: b.height };
}

/**
 * Where each text node's first glyph is on screen. While typing, the plugin's render is still
 * laid out under the editor (hidden), so both can be measured at once.
 */
const glyphs = (selector: string) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`no ${sel}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const out: Array<{ text: string; x: number; y: number }> = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const r = range.getBoundingClientRect();
      out.push({ text: node.textContent, x: r.x, y: r.y });
    }
    return out;
  }, selector);

/** Click the layer (selects Card), double-click it (enters Card → the text: typing). */
async function startTyping(id: string) {
  const c = await centreOf(id);
  await page.mouse.click(c.x, c.y);
  await page.mouse.dblclick(c.x, c.y);
  await expect.poll(editorFocused).toBe(true);
}

/** A press on the empty slide: ends typing (and clears the selection). */
async function clickAway() {
  const slide = await page.locator(".editor-canvas .slide-surface").boundingBox();
  if (!slide) throw new Error("no slide");
  await page.mouse.click(slide.x + slide.width * 0.9, slide.y + slide.height * 0.9);
}

/** Run `action`; expect it to send exactly one transaction, then wait for the editor. */
async function oneTransaction(action: () => Promise<void>) {
  const before = h.userTransactions();
  await action();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await page.waitForTimeout(100);
  expect(h.userTransactions()).toBe(before + 1);
  await h.synced();
}

async function undo() {
  await oneTransaction(() => page.keyboard.press("Control+z"));
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='title']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: typing on the slide", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    if (await editorFocused()) await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await h.synced();
  });

  it("types in place: live reflow, one transaction on Esc, one undo step", async () => {
    const bodyTop = (await centreOf("body")).top;
    const titleHeight = (await centreOf("title")).height;
    const before = h.userTransactions();
    await startTyping("title");
    // The editor replaced the render in place: same box, the plugin's text hidden under it.
    expect(
      await layer("title")
        .locator(".v-text")
        .evaluate((el) => getComputedStyle(el).visibility),
    ).toBe("hidden");
    expect(await page.locator(".text-edit-content").textContent()).toBe("Hello world");
    expect(await page.locator(".handle").count()).toBe(0); // no resize handles while typing

    await page.keyboard.press("End");
    await page.keyboard.type(", this headline is now long enough to wrap onto another line");
    // The hug-height title grows and the stack pushes Body down, before any commit.
    await expect
      .poll(async () => (await centreOf("title")).height)
      .toBeGreaterThan(titleHeight * 1.5);
    expect((await centreOf("body")).top).toBeGreaterThan(bodyTop + titleHeight * 0.5);
    expect(h.userTransactions()).toBe(before);

    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(content("title")).toBe(
      "Hello world, this headline is now long enough to wrap onto another line",
    );
    expect(h.changes.at(-1)?.label).toBe('Edit text "Title"');
    // Esc leaves typing but keeps the layer selected; the render is back.
    expect(await editorFocused()).toBe(false);
    expect(await inspectorTitle()).toBe("Title");
    expect(await page.locator(".text-edit-host").count()).toBe(0);
    await undo();
    expect(content("title")).toBe("Hello world");
  });

  it("formats with shortcuts and keeps the rich structure (bold runs, bullets)", async () => {
    await startTyping("body");
    // WYSIWYG: every run and bullet sits exactly where the render had it.
    const rendered = await glyphs('.editor-canvas [data-node-id="body"] .v-text');
    const editing = await glyphs(".text-edit-content");
    expect(editing.map((g) => g.text)).toEqual(rendered.map((g) => g.text));
    editing.forEach((g, i) => {
      expect(Math.abs(g.x - (rendered[i]?.x ?? 0))).toBeLessThan(0.5);
      expect(Math.abs(g.y - (rendered[i]?.y ?? 0))).toBeLessThan(0.5);
    });
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+i");
    await expect
      .poll(() => page.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed"))
      .toBe("true");
    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(content("body")).toEqual([
      {
        runs: [
          { text: "Intro ", italic: true },
          { text: "bold", bold: true, italic: true },
        ],
      },
      { runs: [{ text: "First", italic: true }], list: "bullet" },
      { runs: [{ text: "Second", italic: true }], list: "bullet" },
    ]);
    await undo();
    expect(content("body")).toEqual(BODY);
  });

  it("Enter starts typing with everything selected; the toolbar makes lists", async () => {
    await startTyping("footer");
    await page.keyboard.press("Escape"); // still selected, not typing
    expect(await editorFocused()).toBe(false);
    await page.keyboard.press("Enter");
    await expect.poll(editorFocused).toBe(true);
    await page.keyboard.type("Alpha"); // replaces the selected "Footer"
    await page.keyboard.press("Enter");
    await page.keyboard.type("Beta");
    // The toolbar keeps the editor focused, and the session going.
    await page.getByRole("button", { name: "Numbered list" }).click();
    expect(await editorFocused()).toBe(true);
    await oneTransaction(clickAway);
    expect(content("footer")).toEqual([
      { runs: [{ text: "Alpha" }] },
      { runs: [{ text: "Beta" }], list: "number" },
    ]);
    await undo();
    expect(content("footer")).toBe("Footer");
  });

  it("adds links through the toolbar, refusing unsafe ones", async () => {
    await startTyping("footer");
    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: "Link" }).click();
    const field = page.getByRole("textbox", { name: "Link address" });
    await field.fill("javascript:alert(1)");
    await field.press("Enter");
    expect(await field.getAttribute("aria-invalid")).toBe("true");
    await field.fill("veloce.dev");
    await field.press("Enter");
    await expect.poll(editorFocused).toBe(true);
    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(content("footer")).toEqual([{ runs: [{ text: "Footer", link: "https://veloce.dev" }] }]);
    await undo();
  });

  it("sends nothing when the text didn't change, and never edits locked text", async () => {
    const before = h.userTransactions();
    await startTyping("title");
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    expect(h.userTransactions()).toBe(before);

    const note = await centreOf("note");
    await page.mouse.dblclick(note.x, note.y);
    await page.waitForTimeout(200);
    expect(await page.locator(".text-edit-host").count()).toBe(0);
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
