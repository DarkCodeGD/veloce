/**
 * Phase 3, round 4 acceptance (group / ungroup): Ctrl+G wraps the selection in a frame and
 * Ctrl+Shift+G dissolves it, each as exactly one transaction, and nothing moves on the slide.
 * Covers a flow group (layers of a column), a free group (layers of an absolute frame, then
 * ungrouped again), the inspector's buttons, and the toast for a selection that can't be
 * grouped. Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** The root column: Title, Body, Note, and Board (a free frame with two stickers). */
async function build(agent: Client) {
  const text = (id: string, content: string, extra = {}) => ({
    id,
    name: content,
    type: "text",
    props: { content, style: "$text.h3" },
    ...extra,
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Group", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", padding: 60, gap: 24 },
        children: [
          text("title", "Title"),
          text("body", "Body"),
          text("note", "Note"),
          {
            id: "board",
            name: "Board",
            height: 420,
            layout: { mode: "absolute", padding: 20 },
            style: { fill: "$color.surface" },
            children: [
              text("one", "One", { position: { x: 40, y: 30 } }),
              text("two", "Two", { position: { x: 400, y: 200 }, rotation: 30 }),
            ],
          },
        ],
      },
    },
  });
}

const rootId = () => h.latestDeck().slides[0]?.root.id ?? "";
const row = (id: string) => page.locator(`.layers [data-layer-id="${id}"]`);
const onCanvas = (id: string) => page.locator(`.editor-canvas [data-node-id="${id}"]`);

/** Select layers through the Layers panel (Shift-click adds). */
async function select(...ids: string[]) {
  for (const [i, id] of ids.entries()) {
    const label = h.stored(id).name as string;
    await row(id)
      .getByRole("button", { name: label, exact: true })
      .click({ modifiers: i === 0 ? [] : ["Shift"] });
  }
}

/** Screen boxes of layers, to prove nothing moved. */
async function boxes(...ids: string[]) {
  return Promise.all(ids.map(async (id) => (await onCanvas(id).boundingBox()) ?? null));
}
function expectSameBoxes(
  before: Array<{ x: number; y: number } | null>,
  after: Array<{ x: number; y: number } | null>,
) {
  for (const [i, b] of before.entries()) {
    expect(Math.abs((after[i]?.x ?? 0) - (b?.x ?? 0))).toBeLessThan(1.5);
    expect(Math.abs((after[i]?.y ?? 0) - (b?.y ?? 0))).toBeLessThan(1.5);
  }
}

async function press(keys: string) {
  const before = h.userTransactions();
  await page.keyboard.press(keys);
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='two']" });
  page = h.page;
  await page.getByRole("tab", { name: "Layers" }).click();
  await row("board").waitFor();
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: group and ungroup", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await h.synced();
  });

  it("groups layers of a column in place with Ctrl+G, and selects the group", async () => {
    const before = await boxes("title", "body");
    await select("body", "title");
    await press("Control+g");
    const [groupId] = h.childIds(rootId());
    expect(h.stored(groupId ?? "")).toMatchObject({ name: "Group", layout: { mode: "stack" } });
    expect(h.childIds(groupId ?? "")).toEqual(["title", "body"]);
    expect(h.childIds(rootId()).slice(1)).toEqual(["note", "board"]);
    expectSameBoxes(before, await boxes("title", "body"));
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Group");

    // Ctrl+Shift+G puts them back in its slot.
    await press("Control+Shift+g");
    expect(h.childIds(rootId())).toEqual(["title", "body", "note", "board"]);
    expectSameBoxes(before, await boxes("title", "body"));
  });

  it("groups free layers without moving them (rotation too), and ungroups them back", async () => {
    const stored = { one: h.stored("one"), two: h.stored("two") };
    const before = await boxes("one", "two");
    await select("one", "two");
    await press("Control+g");
    const groupId = h.childIds("board")[0] ?? "";
    expect(h.childIds("board")).toEqual([groupId]);
    expect(h.stored(groupId)).toMatchObject({ layout: { mode: "absolute" } });
    expectSameBoxes(before, await boxes("one", "two"));

    await press("Control+Shift+g");
    expect(h.childIds("board")).toEqual(["one", "two"]);
    expect(h.stored("one").position).toEqual(stored.one.position);
    expect(h.stored("two").position).toEqual(stored.two.position);
    expectSameBoxes(before, await boxes("one", "two"));
  });

  it("groups and ungroups from the inspector's buttons", async () => {
    await select("note");
    await page.getByRole("button", { name: "Group", exact: true }).click();
    await expect.poll(() => h.childIds(rootId()).includes("note")).toBe(false);
    await h.synced();
    await page.getByRole("button", { name: "Ungroup", exact: true }).click();
    await expect.poll(() => h.childIds(rootId())).toEqual(["title", "body", "note", "board"]);
    await h.synced();
  });

  it("explains instead of grouping layers from different frames", async () => {
    const sent = h.userTransactions();
    await select("title", "one");
    await page.keyboard.press("Control+g");
    await expect.poll(() => page.locator(".toast").last().textContent()).toMatch(/same frame/);
    await h.synced();
    expect(h.userTransactions()).toBe(sent);
  });

  it("produces no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
