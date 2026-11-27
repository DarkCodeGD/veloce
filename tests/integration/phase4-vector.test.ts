/**
 * Phase 4 acceptance (D127): lines and arrows by hand. The Line tool (L) and Arrow tool
 * (Shift+L) draw from the press to the release, in a box that hugs the line; a selected line
 * shows its two end knobs, and dragging one moves that end: a free line's box refits, a
 * stacked line's end stays in the box the layout gave it. A pasted SVG becomes a vector, its
 * script left out. Real Chromium, real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** A free "Board" frame to draw in, and a row with a stacked arrow between two cards. */
async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Lines" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", padding: 80, gap: 40 },
        children: [
          {
            id: "board",
            name: "Board",
            layout: { mode: "absolute" },
            width: 800,
            height: 500,
            style: { fill: "$color.surface" },
            children: [],
          },
          {
            id: "row",
            layout: { mode: "stack", direction: "row", gap: 24, align: "center" },
            children: [
              { id: "a", type: "shape", width: 120, height: 80, props: { shape: "rect" } },
              { id: "flow", type: "line", width: 200, height: 40, props: { end: "triangle" } },
              { id: "b", type: "shape", width: 120, height: 80, props: { shape: "rect" } },
            ],
          },
        ],
      },
    },
  });
}

interface Point {
  x: number;
  y: number;
}

/** The slide's place on screen: slide pixels → screen pixels. */
async function stage() {
  return page.locator(".editor-canvas .slide-surface").evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, k: b.width / 1920 };
  });
}
/** A layer's top-left corner, in slide pixels. */
async function origin(id: string): Promise<Point> {
  const s = await stage();
  const r = await page.locator(`.editor-canvas [data-node-id='${id}']`).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top };
  });
  return { x: (r.x - s.x) / s.k, y: (r.y - s.y) / s.k };
}
async function onScreen(p: Point): Promise<Point> {
  const s = await stage();
  return { x: s.x + p.x * s.k, y: s.y + p.y * s.k };
}
const inBoard = async (x: number, y: number) => {
  const o = await origin("board");
  return onScreen({ x: o.x + x, y: o.y + y });
};

const tool = (name: string) =>
  page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name, exact: true });

type Op = {
  op: string;
  id?: string;
  node?: Record<string, unknown>;
  set?: Record<string, unknown>;
};
const lastOp = () => h.changes.at(-1)?.ops[0] as Op;

async function waitForTransactions(n: number) {
  await expect.poll(() => h.userTransactions()).toBe(n);
  await h.synced();
}

async function drag(from: Point, to: Point, shift = false) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

/** Where a line's end knob is on screen. */
const knob = (which: "from" | "to") =>
  page.locator(`[data-handle='line-${which}']`).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='board']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe.skipIf(problem)("lines and arrows by hand (D127)", () => {
  beforeEach(async () => {
    await page.mouse.up();
    await page.keyboard.up("Shift");
  });

  it("L and Shift+L pick the Line and Arrow tools", async () => {
    await page.keyboard.press("l");
    await expect.poll(() => tool("Line").getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Shift+L");
    await expect.poll(() => tool("Arrow").getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Escape");
  });

  it("an arrow drawn up and to the right runs that way, in a box that hugs it", async () => {
    const before = h.userTransactions();
    await page.keyboard.press("Shift+L");
    // Shift snaps to 45°: drawn a little off, it lands exactly diagonal.
    await drag(await inBoard(100, 400), await inBoard(300, 190), true);
    await waitForTransactions(before + 1);
    const { node } = lastOp() as Required<Pick<Op, "node">>;
    expect(node).toMatchObject({ type: "line", name: "Arrow", props: { end: "triangle" } });
    const props = node.props as { from: Point; to: Point };
    // Bottom-left to top-right of its box.
    expect(props.from.x).toBeLessThan(0.2);
    expect(props.from.y).toBeGreaterThan(0.8);
    expect(props.to.x).toBeGreaterThan(0.8);
    expect(props.to.y).toBeLessThan(0.2);
    const w = node.width as number;
    expect(Math.abs((node.height as number) - w)).toBeLessThanOrEqual(2); // 45°: a square box
    // Selected: its two end knobs, not resize handles.
    await expect.poll(() => page.locator("[data-handle^='line-']").count()).toBe(2);
    expect(await page.locator("[data-handle='se']").count()).toBe(0);
  });

  it("dragging an end of a free line moves only that end; the box refits", async () => {
    const before = h.userTransactions();
    const id = String(lastOp().node?.id);
    const start = await knob("from");
    const end = await knob("to");
    // Pull the start end 150 screen px left: the box grows left, the tip stays where it was.
    await drag(start, { x: start.x - 150, y: start.y });
    await waitForTransactions(before + 1);
    const op = lastOp();
    expect(op).toMatchObject({ op: "node.update", id });
    expect(op.set).toHaveProperty("width");
    expect(op.set).toHaveProperty("position");
    await expect
      .poll(async () => {
        const now = await knob("to");
        return Math.round(Math.hypot(now.x - end.x, now.y - end.y));
      })
      .toBeLessThanOrEqual(1);
    const moved = await knob("from");
    expect(Math.abs(moved.x - (start.x - 150))).toBeLessThanOrEqual(2);
    // One undo puts it back.
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => Math.round((await knob("from")).x - start.x))
      .toBeLessThanOrEqual(1);
  });

  it("a stacked line keeps the box the layout gave it; its end moves inside", async () => {
    const before = h.userTransactions();
    // A click picks the row; a double-click enters it (D62).
    const box = await page.locator(".editor-canvas [data-node-id='flow']").boundingBox();
    const centre = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    };
    await page.mouse.click(centre.x, centre.y);
    await page.mouse.dblclick(centre.x, centre.y);
    await expect.poll(() => page.locator("[data-handle^='line-']").count()).toBe(2);
    const end = await knob("to");
    await drag(end, { x: end.x + 300, y: end.y - 300 }); // far outside its box
    await waitForTransactions(before + 1);
    const op = lastOp();
    expect(op).toMatchObject({ op: "node.update", id: "flow" });
    expect(op.set).not.toHaveProperty("width");
    expect(op.set).not.toHaveProperty("position");
    expect(op.set?.props).toMatchObject({ to: { x: 1, y: 0 } }); // clamped to the corner
  });

  it("pastes an SVG from another app as a vector, without its script, and says so", async () => {
    const before = h.userTransactions();
    let alerted = false;
    page.once("dialog", (dialog) => {
      alerted = true;
      void dialog.dismiss();
    });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // What Figma's "Copy as SVG" or an icon site puts on the clipboard: SVG as plain text.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData(
        "text/plain",
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" onload="alert(1)"><path d="M20 6 9 17l-5-5"/><script>alert(2)</script></svg>',
      );
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
    });
    await waitForTransactions(before + 1);
    const { node } = lastOp() as Required<Pick<Op, "node">>;
    expect(node).toMatchObject({
      type: "vector",
      width: 160,
      height: 160,
      props: { fill: "transparent" },
    });
    // Drawn: a stroked path on the canvas.
    await expect
      .poll(() =>
        page.locator(`.editor-canvas [data-node-id='${String(node.id)}'] path`).getAttribute("d"),
      )
      .toMatch(/^M/);
    await expect
      .poll(() => page.locator(".toast").last().textContent())
      .toMatch(/Left out.*scripts never run/);
    expect(alerted).toBe(false);
  });

  it("raised no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
