/**
 * Phase 3, round 4 acceptance (free positioning per layer): a layer in a stack can leave the
 * flow and sit at its own position on top of it, from the inspector (Position: Free) or by
 * Ctrl-dragging it, without jumping. Free layers then move by position; the flow closes up
 * around them and ignores them as reorder slots. Switching a whole frame to Free keeps its
 * children (and its own size) exactly where they were. Real Chromium against the real server;
 * every gesture is exactly one transaction.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

interface Point {
  x: number;
  y: number;
}

/** The root column: Title, Card (a row), Footer, and a free Badge on top. */
async function build(agent: Client) {
  const text = (id: string, content: string, extra = {}) => ({
    id,
    name: content,
    type: "text",
    props: { content, style: "$text.h2" },
    ...extra,
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Free", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", padding: 80, gap: 40 },
        children: [
          text("title", "Title"),
          {
            id: "card",
            name: "Card",
            layout: { mode: "stack", direction: "row", gap: 24, padding: 24 },
            style: { fill: "$color.surface" },
            children: [text("left", "Left"), text("right", "Right")],
          },
          text("foot", "Footer"),
          text("badge", "Badge", { positioning: "free", position: { x: 1400, y: 20 } }),
        ],
      },
    },
  });
}

const layer = (id: string) => page.locator(`.editor-canvas [data-node-id="${id}"]`);
async function box(id: string) {
  const b = await layer(id).boundingBox();
  if (!b) throw new Error(`${id} not on the canvas`);
  return b;
}
async function centre(id: string): Promise<Point> {
  const b = await box(id);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** Screen pixels per slide pixel. */
const scale = () =>
  page
    .locator(".editor-canvas .slide-surface")
    .evaluate((el) => el.getBoundingClientRect().width / 1920);

const rootId = () => h.latestDeck().slides[0]?.root.id ?? "";

async function select(name: string) {
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe(name);
}

/** A full drag; resolves once the server has the one transaction and the editor shows it. */
async function drag(from: Point, to: Point, steps = 10) {
  const before = h.userTransactions();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(80); // one animation frame for the preview
  await page.mouse.up();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

async function undo() {
  const before = h.userTransactions();
  await page.keyboard.press("Control+z");
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='badge']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: free positioning", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await page.mouse.up();
    for (const key of ["Shift", "Alt", "Control"]) await page.keyboard.up(key);
    await page.keyboard.press("Escape");
    await h.synced();
  });

  it("draws a free layer at its position, out of the flow", async () => {
    const s = await scale();
    const slide = await page.locator(".editor-canvas .slide-surface").boundingBox();
    const badge = await box("badge");
    // Root padding 80 + position: the badge ignores the column it's in.
    expect(Math.abs(badge.x - (slide?.x ?? 0) - (80 + 1400) * s)).toBeLessThan(2);
    expect(Math.abs(badge.y - (slide?.y ?? 0) - (80 + 20) * s)).toBeLessThan(2);
    // The flow starts at the top as if the badge weren't there.
    const title = await box("title");
    expect(Math.abs(title.y - (slide?.y ?? 0) - 80 * s)).toBeLessThan(2);
  });

  it("Position: Free in the inspector keeps the layer where it is, in one undo step", async () => {
    await select("Title");
    const before = await box("title");
    const cardBefore = await box("card");
    const sent = h.userTransactions();
    await page.getByRole("combobox", { name: "Position" }).click();
    await page.getByRole("option", { name: "Free" }).click();
    await expect.poll(() => h.userTransactions()).toBe(sent + 1);
    await h.synced();

    const stored = h.stored("title");
    expect(stored.positioning).toBe("free");
    expect(stored.position).toEqual({ x: 0, y: 0 }); // top-left of the root's content box
    expect(stored.width).toBe(1920 - 160); // was stretched across the column: baked
    expect(stored.height).toBeUndefined(); // text hugs its height by default: still does
    // Not a pixel of movement, and the flow closed up: the card moved into the title's spot.
    const after = await box("title");
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect((await box("card")).y).toBeLessThan(cardBefore.y - 10);
    // X/Y are editable now.
    await expect.poll(() => page.getByLabel("X", { exact: true }).isVisible()).toBe(true);

    await undo();
    expect(h.stored("title").positioning).toBeUndefined();
    expect(h.stored("title").width).toBeUndefined();
    expect(Math.abs((await box("card")).y - cardBefore.y)).toBeLessThan(1);
  });

  it("Ctrl-drag pulls a layer out of its stack and drops it where you let go", async () => {
    const s = await scale();
    const before = await box("foot");
    const from = await centre("foot");
    await page.keyboard.down("Control");
    await drag(from, { x: from.x + 300 * s, y: from.y - 150 * s });
    await page.keyboard.up("Control");

    const stored = h.stored("foot");
    expect(stored.positioning).toBe("free");
    expect(h.childIds(rootId()).includes("foot")).toBe(true); // same frame
    const after = await box("foot");
    expect(Math.abs(after.x - before.x - 300 * s)).toBeLessThan(3);
    expect(Math.abs(after.y - before.y + 150 * s)).toBeLessThan(3);

    await undo();
    expect(h.stored("foot").positioning).toBeUndefined();
    expect(h.stored("foot").position).toBeUndefined();
  });

  it("moves a free layer by position, without reordering anything", async () => {
    const s = await scale();
    const order = h.childIds(rootId());
    const from = await centre("badge");
    await page.keyboard.down("Alt"); // exact pixels: no snapping to the siblings' edges
    await drag(from, { x: from.x - 200 * s, y: from.y + 60 * s });
    await page.keyboard.up("Alt");
    const stored = h.stored("badge");
    expect(stored.positioning).toBe("free");
    const p = stored.position as Point;
    expect(Math.abs(p.x - 1200)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - 80)).toBeLessThanOrEqual(1);
    expect(h.childIds(rootId())).toEqual(order);
    await undo();
  });

  it("reorders the flow past free layers, which stay on top", async () => {
    // Drag Title below Footer: the badge (free, last) isn't a slot, so Title lands before it.
    const from = await centre("title");
    const foot = await box("foot");
    await drag(from, { x: from.x, y: foot.y + foot.height + 4 });
    expect(h.childIds(rootId())).toEqual(["card", "foot", "title", "badge"]);
    await undo();
    expect(h.childIds(rootId())).toEqual(["title", "card", "foot", "badge"]);
  });

  it("switching a frame to Free keeps its children and its size where they were", async () => {
    await select("Card");
    const before = { card: await box("card"), left: await box("left"), right: await box("right") };
    const sent = h.userTransactions();
    await page.getByRole("combobox", { name: "Mode" }).click();
    await page.getByRole("option", { name: /Free/ }).click();
    await expect.poll(() => h.userTransactions()).toBe(sent + 1); // one undo step
    await h.synced();

    const card = h.stored("card");
    expect(card.layout).toEqual({ mode: "absolute", padding: 24 });
    expect(typeof card.height).toBe("number"); // it hugged its content: now pinned
    expect(card.width).toBeUndefined(); // still stretched across the column
    expect(h.stored("left").position).toEqual({ x: 0, y: 0 });
    expect((h.stored("right").position as Point).x).toBeGreaterThan(100);
    for (const id of ["card", "left", "right"] as const) {
      const now = await box(id);
      for (const k of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(now[k] - before[id][k]), `${id}.${k}`).toBeLessThan(1);
      }
    }

    await undo();
    expect(h.stored("card").layout).toMatchObject({ mode: "stack", direction: "row" });
    expect(h.stored("card").height).toBeUndefined();
    expect(h.stored("left").position).toBeUndefined();
  });

  it("produces no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
