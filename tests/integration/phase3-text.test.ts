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
const glyphsOf = (selectors: string[]) =>
  page.evaluate((sels) => {
    return sels.map((sel) => {
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
    });
  }, selectors);
const glyphs = async (selector: string) => (await glyphsOf([selector]))[0] ?? [];

/**
 * How far apart the editor's glyphs are from the (hidden) render's, at worst. Both lists come
 * from ONE snapshot: the layout can still be moving (a taller paragraph grows the box, and a
 * centered slide shifts it), so two separate measurements could straddle that move.
 */
async function editorDrift(id: string) {
  const [rendered = [], typed = []] = await glyphsOf([
    `.editor-canvas [data-node-id='${id}'] .v-text`,
    `.editor-canvas [data-node-id='${id}'] .text-edit-content`,
  ]);
  if (typed.length !== rendered.length || typed.length === 0) return Number.POSITIVE_INFINITY;
  return Math.max(
    ...typed.map((g, i) =>
      Math.max(Math.abs(g.x - (rendered[i]?.x ?? 0)), Math.abs(g.y - (rendered[i]?.y ?? 0))),
    ),
  );
}

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

/** Click inside the text being edited, on `word` (ProseMirror places the caret there at once). */
async function clickInText(id: string, word: string, clicks = 1) {
  const at = await page.evaluate(
    ({ id, word }) => {
      const root = document.querySelector(
        `.editor-canvas [data-node-id="${id}"] .text-edit-content`,
      );
      const walker = root && document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker?.nextNode(); node; node = walker?.nextNode()) {
        const i = node.textContent?.indexOf(word) ?? -1;
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + word.length);
        const r = range.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    },
    { id, word },
  );
  if (!at) throw new Error(`"${word}" isn't in the text being edited`);
  await page.mouse.click(at.x, at.y, { clickCount: clicks });
  await caretSettled();
}

/**
 * ProseMirror reads a native selection change (a word double-click, Home, arrows) from the
 * browser's `selectionchange` a tick later; a test is faster than that. Wait until the
 * editor's own selection matches the screen's, as it does long before a person moves on.
 */
const caretSettled = () =>
  expect
    .poll(() =>
      page.evaluate(() => {
        type View = { posAtDOM(node: Node, offset: number): number };
        type Ed = { view: View; state: { selection: { anchor: number; head: number } } };
        const dom = document.querySelector(".editor-canvas .ProseMirror") as
          | (Element & { editor?: Ed })
          | null;
        const ed = dom?.editor;
        const s = getSelection();
        if (!ed || !s?.anchorNode || !s.focusNode) return false;
        const { anchor, head } = ed.state.selection;
        return (
          ed.view.posAtDOM(s.anchorNode, s.anchorOffset) === anchor &&
          ed.view.posAtDOM(s.focusNode, s.focusOffset) === head
        );
      }),
    )
    .toBe(true);

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
    // A refused address keeps the focus in the field, frames later too (it used to jump back
    // to the editor a frame later, so the corrected address replaced the selected text).
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
      "Link address",
    );
    await field.fill("veloce.dev");
    await field.press("Enter");
    await expect.poll(editorFocused).toBe(true);
    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(content("footer")).toEqual([{ runs: [{ text: "Footer", link: "https://veloce.dev" }] }]);
    await undo();
  });

  // ── The text toolbar: style, color, alignment (D61) ──
  const styleMenu = () => page.getByRole("button", { name: /^Text style:/ });
  const colorMenu = () => page.getByRole("button", { name: /^Text color:/ });
  const alignMenu = () => page.getByRole("button", { name: /^Alignment:/ });
  const popups = () => page.locator(".toolbar-popup").count();

  it("styles one paragraph from the Style menu, exactly like the render", async () => {
    await startTyping("body");
    await clickInText("body", "Intro"); // the caret in the first paragraph
    expect(await styleMenu().getAttribute("aria-label")).toBe("Text style: body");
    await styleMenu().click();
    await page.getByRole("menuitemradio", { name: /^h2/ }).click();
    expect(await editorFocused()).toBe(true); // the menu never takes the focus
    expect(await popups()).toBe(0);
    expect(await styleMenu().getAttribute("aria-label")).toBe("Text style: h2");
    // The live render underneath (hidden) and the editor agree glyph for glyph: the paragraph
    // style is mirrored whole (letter-spacing and case included).
    await expect.poll(() => editorDrift("body")).toBeLessThan(0.5);
    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(content("body")).toEqual([{ ...BODY[0], style: "$text.h2" }, BODY[1], BODY[2]]);
    expect(h.stored("body").props?.style).toBe("$text.body"); // not the whole text: per paragraph
    await undo();
    expect(content("body")).toEqual(BODY);
  });

  it("moves a style picked for the whole text to the layer itself", async () => {
    await startTyping("title");
    await page.keyboard.press("Control+a");
    await styleMenu().click();
    await page.getByRole("menuitemradio", { name: /^h3/ }).click();
    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(h.stored("title").props?.style).toBe("$text.h3");
    expect(content("title")).toBe("Hello world"); // still plain text
    await undo();
    expect(h.stored("title").props?.style).toBe("$text.h1");
  });

  it("aligns with the Align menu and Ctrl+Shift+E; the whole text's alignment goes on the layer", async () => {
    await startTyping("footer");
    await page.keyboard.press("Control+Shift+E");
    expect(await alignMenu().getAttribute("aria-label")).toBe("Alignment: center");
    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(h.stored("footer").props?.align).toBe("center");
    expect(content("footer")).toBe("Footer");
    await undo();
    expect(h.stored("footer").props?.align).toBeUndefined();

    await startTyping("body");
    await clickInText("body", "Second");
    await alignMenu().click();
    await page.getByRole("menuitemradio", { name: "Align right" }).click();
    expect(await editorFocused()).toBe(true);
    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(content("body")).toEqual([BODY[0], BODY[1], { ...BODY[2], align: "right" }]);
    await undo();
  });

  it("colors text with theme swatches; Esc closes the menu before it ends typing", async () => {
    await startTyping("title");
    await clickInText("title", "world", 2); // selects the word
    await colorMenu().click();
    expect(await popups()).toBe(1);
    await page.keyboard.press("Escape"); // closes the menu only
    expect(await popups()).toBe(0);
    expect(await editorFocused()).toBe(true);
    await colorMenu().click();
    await page.getByRole("button", { name: "Text color: accent" }).click();
    expect(await editorFocused()).toBe(true);
    expect(await colorMenu().getAttribute("aria-label")).toBe("Text color: accent");
    await oneTransaction(() => page.keyboard.press("Escape"));
    expect(content("title")).toEqual([
      { runs: [{ text: "Hello " }, { text: "world", color: "$color.accent" }] },
    ]);
    await undo();
    expect(content("title")).toBe("Hello world");
  });

  it("colors the whole text from the picker, and that color goes on the layer", async () => {
    await startTyping("footer");
    await page.keyboard.press("Control+a");
    await colorMenu().click();
    // Dragging in the picker's square keeps the focus in the text (the selection stays).
    const area = await page.getByRole("slider", { name: /Text color saturation/ }).boundingBox();
    if (!area) throw new Error("no square");
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * 0.7, area.y + area.height * 0.3, { steps: 3 });
    await page.mouse.up();
    expect(await editorFocused()).toBe(true);
    expect(await popups()).toBe(1); // stays open for the next change
    // A typed hex wins, and hands the focus back to the text.
    const hex = page.getByRole("textbox", { name: "Text color hex" });
    await hex.fill("ff3366");
    await hex.press("Enter");
    await expect.poll(editorFocused).toBe(true);
    await page.keyboard.press("Escape"); // closes the menu…
    expect(await popups()).toBe(0);
    await oneTransaction(() => page.keyboard.press("Escape")); // …then ends the session
    expect(h.stored("footer").props?.color).toBe("#ff3366");
    expect(content("footer")).toBe("Footer");
    await undo();
    expect(h.stored("footer").props?.color).toBeUndefined();
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
