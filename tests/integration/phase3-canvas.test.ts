/**
 * Phase 3 acceptance (direct manipulation on the canvas): moving free layers with snapping,
 * resizing and rotating with handles, reordering in stacks and dropping into frames by
 * dragging, nudging with the arrow keys. Driven in real Chromium against the real server;
 * every gesture must reach the server as exactly one transaction (one undo step).
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

/** The slide: List (stack) beside Board (free frame) holding Box A and Box B. */
async function build(agent: Client) {
  const text = (id: string, content: string) => ({
    id,
    name: content,
    type: "text",
    props: { content, style: "$text.h2" },
  });
  const box = (id: string, name: string, x: number, y: number, size: number[]) => ({
    id,
    name,
    width: size[0],
    height: size[1],
    position: { x, y },
    layout: { mode: "stack" },
    style: { fill: "$color.primary", radius: "$radius.sm" },
    children: [],
  });
  await agent.callTool({ name: "create_deck", arguments: { title: "Canvas", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", direction: "row", padding: "$space.xl", gap: "$space.lg" },
        children: [
          {
            id: "list",
            name: "List",
            width: 600,
            layout: { mode: "stack", gap: "$space.md", padding: "$space.md" },
            style: { fill: "$color.surface" },
            children: [text("one", "One"), text("two", "Two"), text("three", "Three")],
          },
          {
            id: "board",
            name: "Board",
            width: "fill",
            layout: { mode: "absolute", padding: "$space.md" },
            style: { fill: "$color.surface" },
            children: [
              box("boxA", "Box A", 40, 40, [200, 120]),
              box("boxB", "Box B", 400, 300, [160, 160]),
            ],
          },
        ],
      },
    },
  });
}

const layer = (id: string) => page.locator(`.editor-canvas [data-node-id="${id}"]`);
async function centre(id: string): Promise<Point> {
  const b = await layer(id).boundingBox();
  if (!b) throw new Error(`${id} not on the canvas`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function handleAt(name: string): Promise<Point> {
  const b = await page.locator(`[data-handle="${name}"]`).boundingBox();
  if (!b) throw new Error(`no ${name} handle`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** Screen pixels per slide pixel. */
const scale = () =>
  page.locator(".slide-surface").evaluate((el) => el.getBoundingClientRect().width / 1920);

async function select(name: string) {
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe(name);
}

/** Press at `from`, move to `to` in steps, and stop there with the button still down. */
async function grab(from: Point, to: Point, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(80); // one animation frame for the preview
}

/** A full drag; resolves once the server has the transaction and the editor shows it. */
async function drag(from: Point, to: Point, steps = 8) {
  const before = h.userTransactions();
  await grab(from, to, steps);
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
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='boxA']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: direct manipulation", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await page.mouse.up();
    for (const key of ["Shift", "Alt", "Control"]) await page.keyboard.up(key);
    await h.synced();
  });

  it("selects on the canvas: a click picks the frame, a double-click enters it", async () => {
    const a = await centre("boxA");
    await page.mouse.click(a.x, a.y);
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Board");
    await page.mouse.dblclick(a.x, a.y);
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Box A");
    // Eight resize handles and the rotate knob; clicks without moving change nothing.
    expect(await page.locator(".handle").count()).toBe(8);
    expect(await page.locator('[data-handle="rotate"]').count()).toBe(1);
    const before = h.userTransactions();
    await page.mouse.click(a.x, a.y);
    await page.waitForTimeout(100);
    expect(h.userTransactions()).toBe(before);
  });

  it("drags a free layer: live preview, one transaction, one undo step", async () => {
    await select("Box A");
    const s = await scale();
    const from = await centre("boxA");
    const before = h.userTransactions();
    await page.keyboard.down("Alt"); // no snapping: exact arithmetic
    await grab(from, { x: from.x + 100, y: from.y + 50 });
    // The canvas shows the move; the server hasn't heard of it.
    expect((await centre("boxA")).x).toBeCloseTo(from.x + 100, 0);
    expect(h.userTransactions()).toBe(before);
    expect(await page.locator(".handle").count()).toBe(0); // handles hide while moving
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => h.userTransactions()).toBe(before + 1);
    expect(h.stored("boxA").position).toEqual({
      x: 40 + Math.round(100 / s),
      y: 40 + Math.round(50 / s),
    });
    await h.synced();
    await undo();
    expect(h.stored("boxA").position).toEqual({ x: 40, y: 40 });
  });

  it("snaps to a sibling's edge and shows a guide", async () => {
    await select("Box A");
    const s = await scale();
    const from = await centre("boxA");
    // Box A's left edge (x 40) to 5 slide px right of Box B's (x 400): within reach.
    await grab(from, { x: from.x + 365 * s, y: from.y });
    expect(await page.locator(".guide").count()).toBeGreaterThan(0);
    await page.mouse.up();
    await expect.poll(() => h.stored("boxA").position).toEqual({ x: 400, y: 40 });
    await h.synced();
    await undo();
  });

  it("Esc cancels a move: no transaction, the selection stays", async () => {
    await select("Box A");
    const from = await centre("boxA");
    const before = h.userTransactions();
    await grab(from, { x: from.x + 80, y: from.y + 80 });
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await centre("boxA")).x).toBeCloseTo(from.x, 0);
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(h.userTransactions()).toBe(before);
    expect(await page.locator(".inspector-head strong").textContent()).toBe("Box A");
  });

  it("resizes from a corner (Shift keeps the ratio) and from a side, anchoring the far edge", async () => {
    await select("Box A");
    const s = await scale();
    const se = await handleAt("se");
    await page.keyboard.down("Shift");
    await grab(se, { x: se.x + 60, y: se.y + 5 });
    expect(await page.locator(".drag-badge").textContent()).toMatch(/^\d+ × \d+$/);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const width = Math.round(200 + 60 / s);
    await expect.poll(() => h.stored("boxA").width).toBe(width);
    expect(h.stored("boxA").height).toBe(Math.round(width * 0.6));
    expect(h.stored("boxA").position).toEqual({ x: 40, y: 40 }); // top-left corner anchored
    await h.synced();
    await undo();

    // The west side: the box grows to the left, so its position moves and its right edge stays.
    const w = await handleAt("w");
    await drag(w, { x: w.x - 30, y: w.y + 40 });
    const a = h.stored("boxA");
    expect(a.height).toBe(120); // a side handle changes one dimension
    expect((a.position as Point).x + (a.width as number)).toBe(240);
    expect((a.position as Point).x).toBeLessThan(40);
    await undo();
  });

  it("rotates with the knob; Shift snaps to 15°", async () => {
    await select("Box A");
    const c = await centre("boxA");
    const knob = await handleAt("rotate"); // below the layer: 90° on screen
    const r = Math.hypot(knob.x - c.x, knob.y - c.y);
    const angle = ((90 + 47) * Math.PI) / 180; // swept 47° clockwise
    await page.keyboard.down("Shift");
    await grab(knob, { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });
    expect(await page.locator(".drag-badge").textContent()).toBe("45°");
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect.poll(() => h.stored("boxA").rotation).toBe(45);
    await h.synced();
    // The outline (and its handles) turn with the layer.
    expect(await page.locator(".outline-selected").getAttribute("style")).toContain(
      "rotate(45deg)",
    );
    await undo();
    expect(h.stored("boxA").rotation).toBeUndefined();
  });

  it("reorders a stack by dragging, with a drop line and the target frame highlighted", async () => {
    await select("One");
    const from = await centre("one");
    const three = await centre("three");
    await grab(from, { x: from.x, y: three.y + 10 });
    expect(await page.locator(".insertion-line").count()).toBe(1);
    expect(await page.locator(".drop-target").count()).toBe(1);
    expect(await page.locator(".outline-ghost").count()).toBe(1);
    await page.mouse.up();
    await expect.poll(() => h.childIds("list")).toEqual(["two", "three", "one"]);
    await h.synced();
    await undo();
    expect(h.childIds("list")).toEqual(["one", "two", "three"]);
  });

  it("drops a free layer into a stack between two items (its position goes)", async () => {
    await select("Box A");
    const from = await centre("boxA");
    const one = await centre("one");
    const two = await centre("two");
    await drag(from, { x: one.x, y: (one.y + two.y) / 2 }, 12);
    expect(h.childIds("list")).toEqual(["one", "boxA", "two", "three"]);
    expect(h.childIds("board")).toEqual(["boxB"]);
    expect(h.stored("boxA").position).toBeUndefined();
    await undo(); // one step puts it back where it was
    expect(h.childIds("board")).toEqual(["boxA", "boxB"]);
    expect(h.stored("boxA").position).toEqual({ x: 40, y: 40 });
  });

  it("Ctrl/Cmd keeps a layer in its frame while dragging over another one", async () => {
    await select("Box B");
    const from = await centre("boxB");
    const list = await centre("list");
    await page.keyboard.down("Control");
    await drag(from, { x: list.x, y: from.y });
    await page.keyboard.up("Control");
    expect(h.childIds("board")).toEqual(["boxA", "boxB"]);
    expect((h.stored("boxB").position as Point).x).toBeLessThan(0); // moved left, still free
    await undo();
  });

  it("arrow keys nudge free layers: held keys preview, release commits once", async () => {
    await select("Box A");
    const before = h.userTransactions();
    for (let i = 0; i < 3; i++) await page.keyboard.down("ArrowRight"); // auto-repeat
    await page.waitForTimeout(80);
    expect(h.userTransactions()).toBe(before);
    await page.keyboard.up("ArrowRight");
    await expect.poll(() => h.userTransactions()).toBe(before + 1);
    expect(h.stored("boxA").position).toEqual({ x: 43, y: 40 });
    await h.synced();
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => h.stored("boxA").position).toEqual({ x: 43, y: 50 });
    await h.synced();
    await undo();
    await undo();
    expect(h.stored("boxA").position).toEqual({ x: 40, y: 40 });
  });

  it("marquee-selects top-level layers, or deep ones with Ctrl, without sending anything", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const before = h.userTransactions();
    const slide = await page.locator(".editor-canvas .slide-surface").boundingBox();
    const list = await layer("list").boundingBox();
    if (!slide || !list) throw new Error("no slide");
    const corner = { x: slide.x - 20, y: slide.y - 20 }; // the empty canvas around the slide
    // Across the List only: one top-level layer, shown live while dragging.
    await grab(corner, { x: list.x + 50, y: list.y + 50 });
    expect(await page.locator(".marquee").count()).toBe(1);
    await page.mouse.up();
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("List");
    expect(await page.locator(".marquee").count()).toBe(0);
    // Across both top-level layers.
    const board = await layer("board").boundingBox();
    if (!board) throw new Error("no board");
    await grab(corner, { x: board.x + 20, y: board.y + 20 });
    await page.mouse.up();
    await expect.poll(() => page.locator(".outline-selected").count()).toBe(2);
    // Ctrl: the texts inside the List instead.
    await page.keyboard.down("Control");
    await grab(corner, { x: list.x + list.width - 10, y: list.y + list.height - 10 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect.poll(() => page.locator(".outline-selected").count()).toBe(3);
    expect(h.userTransactions()).toBe(before);
    await page.keyboard.press("Escape");
  });

  it("shows spacing while moving, and with Alt between the selection and the hover", async () => {
    await select("Box A");
    const s = await scale();
    const from = await centre("boxA");
    await page.keyboard.down("Alt"); // no snapping: exact numbers
    await grab(from, { x: from.x + 100, y: from.y + 50 });
    const labels = () => page.locator(".measure-label").allTextContents();
    // Gaps to Board's content edges on the left and top (nothing faces those sides).
    expect(await labels()).toEqual(
      expect.arrayContaining([String(40 + Math.round(100 / s)), String(40 + Math.round(50 / s))]),
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => h.userTransactions()).toBeGreaterThan(0);
    await h.synced();
    await undo();

    // Alt + hover Box B: the horizontal and vertical gaps between A (40,40 200×120) and B.
    const b = await centre("boxB");
    await page.mouse.move(b.x, b.y);
    await page.keyboard.down("Alt");
    await expect.poll(labels).toEqual(["160", "140"]);
    await page.keyboard.up("Alt");
    await expect.poll(labels).toEqual([]);
  });

  it("logged no errors in the page", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
