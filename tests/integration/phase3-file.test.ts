/**
 * Phase 3 acceptance (round 5 parity, D76 and D77): the File menu. Deck info edits the deck's
 * title, description, authors and language as one undoable step (the op agents use), and says
 * what to fix in place; New deck makes a deck with a theme and the editor switches to it, as
 * an agent's create_deck does; Move deck to trash takes one away, undoably (D99). Driven in
 * real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { DeckMeta } from "@veloce/core";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;
let firstId = "";

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Pitch" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: { id: "s1", children: [{ id: "t", type: "text", props: { content: "Hello" } }] },
    },
  });
}

/** The first deck's meta as the server has it now. */
const meta = async (): Promise<DeckMeta> => (await h.workspace.get(firstId)).deck.meta;

const dialog = () => page.getByRole("dialog");
async function openFile(item: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
  await dialog().waitFor();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='t']" });
  page = h.page;
  firstId = h.workspace.activeDeckId ?? "";
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: File menu", { timeout: 60_000 }, () => {
  it("the File menu opens from the keyboard and focuses its first command", async () => {
    const file = page.getByRole("button", { name: "File", exact: true });
    await file.focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => file.getAttribute("aria-expanded")).toBe("true");
    const focused = () => page.evaluate(() => document.activeElement?.textContent);
    await expect.poll(focused).toBe("New deck…");
    await page.keyboard.press("ArrowDown");
    await expect.poll(focused).toBe("Manage decks…");
    await page.keyboard.press("Escape");
    expect(await page.getByRole("menu").count()).toBe(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("File");
  });

  it("Deck info saves title, description, authors and language as one step", async () => {
    await openFile("Deck info…");
    const title = dialog().getByLabel("Title");
    expect(await title.inputValue()).toBe("Pitch");
    // It opens on its first field, not on the Close button.
    await expect.poll(() => title.evaluate((el) => el === document.activeElement)).toBe(true);
    await title.fill("Series A");
    await dialog().getByLabel("Description").fill("Seed round for investors");
    await dialog().getByLabel("Authors").fill("Ada Lovelace, Alan Turing");
    await dialog().getByRole("combobox", { name: "Language" }).click();
    await page.getByRole("option", { name: /^German/ }).click();
    const before = h.userTransactions();
    await dialog().getByRole("button", { name: "Save" }).click();

    await expect.poll(() => dialog().count()).toBe(0);
    await expect.poll(meta).toEqual({
      title: "Series A",
      description: "Seed round for investors",
      authors: ["Ada Lovelace", "Alan Turing"],
      language: "de",
    });
    expect(h.userTransactions()).toBe(before + 1);
    expect(h.changes.at(-1)?.label).toBe("Edit deck info");
    await expect.poll(() => page.title()).toBe("Series A – Veloce");
    // The slides carry the language (screen readers, hyphenation).
    await expect.poll(() => page.locator(".editor-canvas [lang='de']").count()).toBeGreaterThan(0);
  });

  it("says what to fix in place; Esc closes without saving", async () => {
    await openFile("Deck info…");
    await dialog().getByLabel("Title").fill("   ");
    await dialog().getByLabel("Title").press("Enter"); // Enter submits, like Save
    await expect
      .poll(() => dialog().getByRole("alert").textContent())
      .toBe("Give the deck a title.");
    expect(await dialog().getByLabel("Title").getAttribute("aria-invalid")).toBe("true");
    await page.keyboard.press("Escape");
    await expect.poll(() => dialog().count()).toBe(0);
    expect((await meta()).title).toBe("Series A");
    // Focus is back on the File button (live), so the editor's shortcuts work right away.
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("File");
  });

  it("any other language by its tag, named as you type; undo takes it back", async () => {
    await openFile("Deck info…");
    await dialog().getByRole("combobox", { name: "Language" }).click();
    await page.getByRole("option", { name: "Other…" }).click();
    const tag = dialog().getByLabel("Language tag");
    await tag.fill("es-mx");
    await expect
      .poll(() => dialog().locator(".dialog-hint").last().textContent())
      .toBe("Mexican Spanish");
    await tag.press("Enter");
    await expect.poll(async () => (await meta()).language).toBe("es-MX");

    // Reopened, a tag that isn't in the menu shows as Other… with the tag.
    await openFile("Deck info…");
    expect(await dialog().getByLabel("Language tag").inputValue()).toBe("es-MX");
    await page.keyboard.press("Escape");

    // Straight after closing the dialog, with no click: the shortcut still works.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await meta()).language).toBe("de");
  });

  it("keys in a dialog never reach the editor: Delete on its button keeps the layer", async () => {
    await page.locator(".editor-canvas [data-node-id='t']").click();
    await openFile("Deck info…");
    await dialog().getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Delete");
    await dialog().getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => dialog().count()).toBe(0);
    expect((await h.workspace.get(firstId)).deck.slides[0]?.root.children.map((n) => n.id)).toEqual(
      ["t"],
    );
  });

  it("New deck makes a deck with the picked theme, and the editor switches to it", async () => {
    await openFile("New deck…");
    const title = dialog().getByLabel("Title");
    // The default name is selected: typing replaces it.
    await expect
      .poll(() =>
        title.evaluate((el: HTMLInputElement) =>
          el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
        ),
      )
      .toBe("Untitled deck");
    await page.keyboard.type("Q3 review");
    await dialog().getByRole("button", { name: "Midnight" }).click();
    expect(
      await dialog().getByRole("button", { name: "Midnight" }).getAttribute("aria-pressed"),
    ).toBe("true");
    await dialog().getByRole("button", { name: "Create" }).click();

    await expect.poll(() => dialog().count()).toBe(0);
    await expect.poll(() => h.workspace.list().length).toBe(2);
    const created = h.workspace.list().find((d) => d.id !== firstId);
    expect(created?.title).toBe("Q3 review");
    expect(h.workspace.activeDeckId).toBe(created?.id);
    expect((await h.workspace.get(created?.id ?? "")).deck.theme.name).toBe("Midnight");
    await expect.poll(() => page.title()).toBe("Q3 review – Veloce");
    // An empty deck, which can be started by hand right there.
    await expect.poll(() => page.getByText("This deck is empty").count()).toBe(1);
    await page.getByRole("button", { name: "New slide" }).click();
    await expect.poll(() => page.locator(".thumb").count()).toBe(1);
    expect((await h.workspace.get(created?.id ?? "")).deck.slides).toHaveLength(1);
  });

  it("moves a deck to the trash, Undo brings it back, and the last one leaves an empty editor (D99)", async () => {
    const trash = async () => {
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByRole("menuitem", { name: "Move deck to trash" }).click();
    };
    const review = h.workspace.activeDeckId ?? "";
    await trash();
    await expect.poll(() => h.workspace.list().map((d) => d.id)).toEqual([firstId]);
    await expect.poll(() => page.title()).toBe("Series A – Veloce"); // on to the other deck
    const toast = page.locator(".toast").last();
    await expect.poll(() => toast.textContent()).toContain('Moved "Q3 review" to the trash');
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => h.workspace.activeDeckId).toBe(review);
    await expect.poll(() => page.title()).toBe("Q3 review – Veloce");

    // Both gone: the editor has no deck to show, and File → New still works from there.
    await trash();
    await expect.poll(() => page.title()).toBe("Series A – Veloce");
    await trash();
    await expect.poll(() => h.workspace.list()).toEqual([]);
    await expect.poll(() => page.title()).toBe("Veloce");
    await page.getByRole("button", { name: "File", exact: true }).click();
    expect(await page.getByRole("menuitem", { name: "Move deck to trash" }).isDisabled()).toBe(
      true,
    );
    await page.getByRole("menuitem", { name: "New deck…" }).click();
    await dialog().getByRole("button", { name: "Create" }).click();
    await expect.poll(() => h.workspace.list().length).toBe(1);
    await expect.poll(() => page.getByText("This deck is empty").count()).toBe(1);
  });

  it("Manage decks lists every deck to open or trash, several in a row (D99)", async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "New deck…" }).click();
    await dialog().getByLabel("Title").fill("Alpha");
    await dialog().getByRole("button", { name: "Create" }).click();
    await expect.poll(() => h.workspace.list().length).toBe(2);
    await expect.poll(() => page.title()).toBe("Alpha – Veloce");

    await openFile("Manage decks…");
    const rows = () => dialog().locator(".decks-item");
    await expect.poll(() => rows().count()).toBe(2);
    expect(
      await dialog().locator(".decks-item[aria-current='true'] .decks-name").textContent(),
    ).toBe("Alpha");
    // Search narrows the list; Enter opens the only match.
    await dialog().getByRole("searchbox", { name: "Search decks" }).fill("untitled");
    await expect.poll(() => rows().count()).toBe(1);
    await page.keyboard.press("Enter");
    await expect.poll(() => dialog().count()).toBe(0);
    await expect.poll(() => page.title()).toBe("Untitled deck – Veloce");

    // Trash a deck that isn't open: the view stays put, and Undo doesn't move it either.
    await openFile("Manage decks…");
    await dialog().getByRole("button", { name: "Move “Alpha” to trash" }).click();
    await expect.poll(() => rows().count()).toBe(1);
    expect(await page.title()).toBe("Untitled deck – Veloce");
    // Undo is in the dialog: the toast behind a modal dialog can't be clicked.
    await dialog().getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => rows().count()).toBe(2);
    expect(await dialog().getByRole("status").count()).toBe(0);
    expect(await page.title()).toBe("Untitled deck – Veloce");

    // Trash both, one after the other, without leaving the dialog: it shows the empty state.
    await dialog().getByRole("button", { name: "Move “Alpha” to trash" }).click();
    await expect.poll(() => rows().count()).toBe(1);
    await dialog().getByRole("button", { name: "Move “Untitled deck” to trash" }).click();
    await expect.poll(() => dialog().getByText("No decks yet.").count()).toBe(1);
    await expect.poll(() => h.workspace.list()).toEqual([]);
    await expect.poll(() => page.title()).toBe("Veloce");
    await dialog().getByRole("button", { name: "Done" }).click();
    await expect.poll(() => dialog().count()).toBe(0);
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
