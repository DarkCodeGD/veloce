/**
 * Phase 3, round 4 acceptance (canvas zoom and pan, D60): Ctrl/⌘ + wheel zooms at the
 * pointer, the wheel and Space + drag pan, Shift+0/1/2 and the View menu jump to 100%, fit
 * and the selection, and moving, resizing, outlines and typing stay exact at any zoom. Zoom
 * is view state: none of it sends a transaction. Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Zoom", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          { id: "title", name: "Title", type: "text", props: { content: "Zoom me" } },
          {
            id: "box",
            name: "Box",
            type: "shape",
            props: { shape: "rect" },
            width: 200,
            height: 100,
            positioning: "free",
            position: { x: 1000, y: 600 },
          },
          {
            id: "sticker",
            name: "Sticker",
            type: "text",
            width: "hug",
            positioning: "free",
            position: { x: 300, y: 700 },
            props: { content: "Sticker" },
          },
        ],
      },
    },
  });
}

const surface = async () => {
  const b = await page.locator(".editor-canvas .slide-surface").boundingBox();
  if (!b) throw new Error("no slide");
  return b;
};
const scale = async () => (await surface()).width / 1920;
async function box(id: string) {
  const b = await page.locator(`.editor-canvas [data-node-id="${id}"]`).boundingBox();
  if (!b) throw new Error(`${id} not on the canvas`);
  return b;
}
/** Run a View menu command (the menu bar is where zoom lives, D89 §8). */
async function fromView(command: string) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: command, exact: true }).click();
}

async function select(name: string) {
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe(name);
}

/** Wait until the slide stops moving (camera updates land on the next frame). */
async function settled() {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await surface());
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

async function fitSlide() {
  await page.keyboard.press("Shift+Digit1");
  await settled();
}

/** A point on the canvas away from every layer (inside the slide, above the title). */
async function emptySpot() {
  const s = await surface();
  return { x: s.x + s.width * 0.9, y: s.y + s.height * 0.1 };
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='sticker']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: canvas zoom and pan", { timeout: 60_000 }, () => {
  let fitScale = 0;

  beforeEach(async () => {
    for (const key of ["Shift", "Alt", "Control", "Space"]) await page.keyboard.up(key);
    await page.mouse.up();
    await h.synced();
    await page.mouse.move(...(Object.values(await emptySpot()) as [number, number]));
    await fitSlide();
    fitScale = await scale();
  });

  it("zooms at the pointer with Ctrl + wheel, without touching the document", async () => {
    const sent = h.userTransactions();
    const before = await surface();
    const at = { x: before.x + before.width * 0.7, y: before.y + before.height * 0.4 };
    const slidePoint = { x: (at.x - before.x) / fitScale, y: (at.y - before.y) / fitScale };
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await settled();
    const s = await scale();
    expect(s).toBeGreaterThan(fitScale * 1.1);
    const after = await surface();
    // The slide point under the pointer didn't move.
    expect(Math.abs(after.x + slidePoint.x * s - at.x)).toBeLessThan(1.5);
    expect(Math.abs(after.y + slidePoint.y * s - at.y)).toBeLessThan(1.5);
    expect(h.userTransactions()).toBe(sent);
  });

  it("jumps to 100% (Shift+0) and back to fit (Shift+1)", async () => {
    await page.keyboard.press("Shift+Digit0");
    await settled();
    expect(await scale()).toBeCloseTo(1, 2);
    await fitSlide();
    expect(await scale()).toBeCloseTo(fitScale, 3);
  });

  it("pans with the wheel, sideways with Shift + wheel", async () => {
    const before = await surface();
    await page.mouse.wheel(0, 120);
    await settled();
    const down = await surface();
    expect(down.y - before.y).toBeCloseTo(-120, 0);
    expect(down.x).toBeCloseTo(before.x, 0);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 80);
    await page.keyboard.up("Shift");
    await settled();
    const side = await surface();
    expect(side.x - down.x).toBeCloseTo(-80, 0);
    expect(side.y).toBeCloseTo(down.y, 0);
  });

  it("pans with Space + drag and the middle button, selecting nothing", async () => {
    await select("Box");
    const sent = h.userTransactions();
    const before = await surface();
    const from = await box("box"); // even starting on a layer: the hand tool wins
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.keyboard.down("Space");
    await expect.poll(() => page.locator(".editor-canvas.can-pan").count()).toBe(1);
    await page.mouse.down();
    await page.mouse.move(start.x + 150, start.y + 70, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await settled();
    const moved = await surface();
    expect(moved.x - before.x).toBeCloseTo(150, 0);
    expect(moved.y - before.y).toBeCloseTo(70, 0);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(start.x - 150, start.y - 70, { steps: 5 });
    await page.mouse.up({ button: "middle" });
    await settled();
    const back = await surface();
    expect(back.x).toBeCloseTo(before.x, 0);
    expect(back.y).toBeCloseTo(before.y, 0);

    expect(h.userTransactions()).toBe(sent); // nothing moved in the document
    expect(await page.locator(".inspector-head strong").textContent()).toBe("Box");
  });

  it("zooms to the selection (Shift+2), and moves and resizes in slide pixels there", async () => {
    await select("Box");
    await page.mouse.move(...(Object.values(await emptySpot()) as [number, number]));
    await page.keyboard.press("Shift+Digit2");
    await settled();
    const s = await scale();
    expect(s).toBeGreaterThan(fitScale * 3);
    // Centered in the canvas, and the outline is exactly on the layer.
    const canvas = await page.locator(".editor-canvas .canvas").boundingBox();
    const b = await box("box");
    expect(
      Math.abs(b.x + b.width / 2 - ((canvas?.x ?? 0) + (canvas?.width ?? 0) / 2)),
    ).toBeLessThan(1.5);
    const outline = await page.locator(".outline-selected").boundingBox();
    for (const k of ["x", "y", "width", "height"] as const) {
      expect(Math.abs((outline?.[k] ?? 0) - b[k]), k).toBeLessThan(1.5);
    }

    // Move 100 screen pixels (Alt: no snapping) = 100 / scale slide pixels.
    const sent = h.userTransactions();
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.keyboard.down("Alt");
    await page.mouse.move(c.x + 100, c.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => h.userTransactions()).toBe(sent + 1);
    await h.synced();
    expect((h.stored("box").position as { x: number }).x).toBeCloseTo(1000 + 100 / s, 0);

    // Resize from the left edge (the right one is under the inspector at this zoom), with Alt
    // (from the centre, so both sides grow): 60 screen pixels = 2 × 60 / scale slide pixels.
    const handle = await page.locator('.handle[data-handle="w"]').boundingBox();
    if (!handle) throw new Error("no handle");
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.keyboard.down("Alt");
    await page.mouse.move(hx - 60, hy, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => h.userTransactions()).toBe(sent + 2);
    await h.synced();
    expect(Math.abs((h.stored("box").width as number) - (200 + (2 * 60) / s))).toBeLessThan(1);

    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await expect.poll(() => h.stored("box").width).toBe(200);
  });

  it("types into a zoomed text layer exactly over it, Space included", async () => {
    await select("Sticker");
    await page.mouse.move(...(Object.values(await emptySpot()) as [number, number]));
    await page.keyboard.press("Shift+Digit2");
    await settled();
    expect(await scale()).toBeGreaterThan(fitScale * 2);
    const layer = await box("sticker");
    await page.mouse.dblclick(layer.x + layer.width / 2, layer.y + layer.height / 2);
    const editor = page.locator(".editor-canvas [contenteditable='true']");
    await expect.poll(() => editor.count()).toBe(1);
    const e = await editor.boundingBox();
    expect(Math.abs((e?.x ?? 0) - layer.x)).toBeLessThan(2);
    expect(Math.abs((e?.y ?? 0) - layer.y)).toBeLessThan(2);
    const sent = h.userTransactions();
    await page.keyboard.press("End");
    await page.keyboard.type(" ok"); // Space types a space while typing: no hand tool
    await page.keyboard.press("Escape");
    await expect.poll(() => h.userTransactions()).toBe(sent + 1);
    expect(JSON.stringify(h.stored("sticker").props?.content)).toContain("Sticker ok");
    await page.keyboard.press("Control+z");
    await expect.poll(() => JSON.stringify(h.stored("sticker").props?.content)).not.toContain("ok");
  });

  it("steps with Ctrl+= / Ctrl+- and the View menu", async () => {
    await page.keyboard.press("Control+Equal");
    await settled();
    const zoomedIn = await scale();
    expect(zoomedIn).toBeGreaterThan(fitScale);
    await fromView("Zoom out");
    await settled();
    expect(await scale()).toBeLessThan(zoomedIn);
    await fromView("Zoom to 100%");
    await settled();
    expect(await scale()).toBeCloseTo(1, 2);
    await fromView("Zoom in");
    await settled();
    expect(await scale()).toBeCloseTo(1.5, 2);
    await fromView("Zoom to fit");
    await settled();
    expect(await scale()).toBeCloseTo(fitScale, 3);
  });

  it("holds the camera still under a drag, whatever asks it to move", async () => {
    await select("Box");
    const sent = h.userTransactions();
    const b = await box("box");
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 20, c.y + 10, { steps: 4 }); // the move is running
    await expect.poll(() => page.locator(".editor-canvas.is-moving").count()).toBe(1);
    const before = await surface();
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Shift+Digit0");
    await page.mouse.wheel(0, 120);
    await page.mouse.move(c.x + 40, c.y + 20, { steps: 4 });
    await settled();
    expect(await surface()).toEqual(before);
    await page.mouse.up();
    await expect.poll(() => h.userTransactions()).toBe(sent + 1);
    await page.keyboard.press("Control+z");
    await expect.poll(() => (h.stored("box").position as { x: number }).x).toBe(1000);
  });

  it("leaves selection and text alone on a Space + double-click (two quick pans)", async () => {
    await select("Sticker");
    const t = await box("sticker");
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.keyboard.down("Space");
    await expect.poll(() => page.locator(".editor-canvas.can-pan").count()).toBe(1);
    await page.mouse.dblclick(t.x + t.width / 2, t.y + t.height / 2);
    await page.keyboard.up("Space");
    expect(await page.locator(".editor-canvas [contenteditable='true']").count()).toBe(0);
    // Still selected (before the fix, the pan's double-click hit no layer and deselected).
    expect(await page.locator(".inspector-head strong").allTextContents()).toEqual(["Sticker"]);
  });

  it("never pastes the Linux primary selection from a middle-button pan or click", async () => {
    await select("Sticker");
    const t = await box("sticker");
    await page.mouse.dblclick(t.x + t.width / 2, t.y + t.height / 2);
    const editor = page.locator(".editor-canvas [contenteditable='true']");
    await expect.poll(() => editor.count()).toBe(1);
    // Keys only once the editor has focus: a Ctrl+A that lands first selects all layers.
    await expect.poll(() => editor.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("Control+a"); // highlighted text = the primary selection
    await page.keyboard.press("End"); // caret at the end, nothing selected
    const sent = h.userTransactions();
    const e = await editor.boundingBox();
    if (!e) throw new Error("no editor");
    const inside = { x: e.x + e.width / 2, y: e.y + e.height / 2 };
    // A middle-drag that starts on the text being edited…
    await page.mouse.move(inside.x, inside.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(inside.x + 30, inside.y + 10, { steps: 4 });
    await page.mouse.up({ button: "middle" });
    await settled();
    // …and a plain middle click on it.
    const moved = await editor.boundingBox();
    if (!moved) throw new Error("no editor");
    await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2, {
      button: "middle",
    });
    expect(await editor.textContent()).toBe("Sticker");
    await page.keyboard.press("Escape");
    await expect.poll(() => editor.count()).toBe(0);
    expect(h.userTransactions()).toBe(sent); // nothing typed, nothing pasted
  });

  it("zooms with Ctrl + '+' where '+' is another key (German layout)", async () => {
    await page.evaluate(() => {
      const init = { key: "+", code: "BracketRight", ctrlKey: true, bubbles: true };
      document.body.dispatchEvent(new KeyboardEvent("keydown", init));
    });
    await settled();
    expect(await scale()).toBeGreaterThan(fitScale);
  });

  it("pulls a zoomed slide back into reach when the window shrinks", async () => {
    const original = page.viewportSize();
    if (!original) throw new Error("no viewport size");
    await page.keyboard.press("Shift+Digit0"); // 100%: the slide is wider than the canvas
    await settled();
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -400); // fling it down, far
    await settled();
    try {
      await page.setViewportSize({
        width: original.width,
        height: Math.round(original.height * 0.6),
      });
      await settled();
      const canvas = await page.locator(".editor-canvas .canvas").boundingBox();
      const s = await surface();
      if (!canvas) throw new Error("no canvas");
      // At least the margin of the slide still shows inside the (now shorter) canvas.
      expect(canvas.y + canvas.height - s.y).toBeGreaterThanOrEqual(63);
    } finally {
      await page.setViewportSize(original);
    }
  });

  it("never zooms the whole page: Ctrl + scroll over a panel and Ctrl + '+' in a field", async () => {
    // Record, after the app's own listeners, whether each wheel's default (the browser's page
    // zoom for Ctrl + wheel) was cancelled.
    await page.evaluate(() => {
      const w = window as unknown as { cancelled: boolean[] };
      w.cancelled = [];
      window.addEventListener("wheel", (e) => w.cancelled.push(e.defaultPrevented));
    });
    const cancelled = () =>
      page.evaluate(() => (window as unknown as { cancelled: boolean[] }).cancelled);
    await select("Box");
    for (const panel of ['[aria-label="Layers"]', ".inspector"]) {
      const b = await page.locator(panel).first().boundingBox();
      if (!b) throw new Error(`no ${panel}`);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -100);
      await page.keyboard.up("Control");
      await page.mouse.wheel(0, 50); // plain scrolling still scrolls the panel
    }
    await expect.poll(async () => (await cancelled()).length).toBe(4);
    expect(await cancelled()).toEqual([true, false, true, false]);
    expect(await scale()).toBeCloseTo(fitScale, 3); // and the canvas didn't zoom either

    // Ctrl + "+" while typing in an inspector field: the canvas zooms, the page doesn't.
    const field = page.locator(".inspector input[type='text']").first();
    await field.focus();
    const prevented = await field.evaluate((el) => {
      const e = new KeyboardEvent("keydown", {
        key: "=",
        code: "Equal",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      return !el.dispatchEvent(e);
    });
    expect(prevented).toBe(true);
    await settled();
    expect(await scale()).toBeGreaterThan(fitScale);
    await field.blur();
  });

  it("produces no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
