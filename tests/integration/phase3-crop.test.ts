/**
 * Phase 3 acceptance (D84): crop mode, like Figma's. Double-clicking an image shows the
 * whole picture around the layer; dragging it pans, the layer's edges trim (the picture
 * stays put), the picture's corners scale it. Esc leaves. Outside crop mode, Ctrl-dragging an
 * edge trims, and corners keep an image's aspect ratio (Shift frees it). Every gesture is one
 * transaction; the renderer shows the crop through `object-view-box`. Real Chromium against
 * the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";
import { pngOf } from "./png.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** A 160×90 picture in four colour quarters, in a 400×400 layer on a Free slide. */
async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Crop" } });
  const quad = pngOf(160, 90, (x, y) =>
    x < 80 ? (y < 45 ? [220, 30, 30] : [30, 160, 60]) : y < 45 ? [30, 60, 220] : [240, 200, 20],
  );
  const added = await agent.callTool({
    name: "add_asset",
    arguments: { files: [{ data: quad.toString("base64"), name: "quad.png" }] },
  });
  const text = (added.content as Array<{ text: string }>)[0]?.text ?? "";
  const asset = /"(asset:[0-9a-f]{64})"/.exec(text)?.[1];
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "absolute" },
        children: [
          {
            id: "pic",
            type: "image",
            width: 400,
            height: 400,
            position: { x: 700, y: 300 },
            props: { asset, alt: "Quarters" },
          },
        ],
      },
    },
  });
}

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
const layer = () => page.locator(".editor-canvas [data-node-id='pic']");
const picture = () => page.locator(".crop-picture");
const stored = () =>
  h.stored("pic") as { width?: number; height?: number; position?: { x: number } };
const crop = () => (h.stored("pic").props as { crop?: Crop }).crop;
/** Screen pixels per slide pixel. */
const scale = () =>
  page
    .locator(".editor-canvas .slide-surface")
    .evaluate((el) => el.getBoundingClientRect().width / 1920);

async function box(locator: ReturnType<Page["locator"]>) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not on screen");
  return b;
}
/** Press at `from`, drag by (dx, dy), release; resolves once its one transaction landed. */
async function drag(
  from: { x: number; y: number },
  dx: number,
  dy: number,
  modifier?: "Control" | "Shift",
) {
  const before = h.userTransactions();
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}
const centreOf = async (locator: ReturnType<Page["locator"]>) => {
  const b = await box(locator);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='pic'] img" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe.skipIf(problem)("crop mode (D84)", () => {
  beforeEach(async () => {
    await page.mouse.up();
    for (const key of ["Shift", "Control"]) await page.keyboard.up(key);
  });

  it("double-clicking the image shows the whole picture around it, sending nothing", async () => {
    const before = h.userTransactions();
    await layer().dblclick();
    await picture().waitFor();
    // A 16:9 picture covering a square: it reaches 16/9 of the layer's width, centred.
    const win = await box(layer());
    const pic = await box(picture());
    expect(pic.width / win.width).toBeCloseTo(16 / 9, 1);
    expect(Math.abs(pic.x + pic.width / 2 - (win.x + win.width / 2))).toBeLessThan(2);
    await expect
      .poll(() => page.getByRole("button", { name: "Done" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(h.userTransactions()).toBe(before);
  });

  it("dragging inside moves the selection over the picture, which stays put", async () => {
    const s = await scale();
    const pic = await box(picture());
    await drag(await centreOf(layer()), 40, 30);
    expect(h.changes.at(-1)?.label).toBe("Crop image");
    // Right by 40 screen px over the 711 px picture; down it can't go (the full height shows).
    const moved = 40 / s;
    expect(stored().position?.x).toBeCloseTo(700 + moved, -0.5);
    expect(h.stored("pic").position).toMatchObject({ y: 300 });
    expect(crop()?.x).toBeCloseTo((1 - 9 / 16) / 2 + moved / (400 * (16 / 9)), 2);
    expect(crop()).toMatchObject({ y: 0, h: 1 });
    expect(crop()?.w).toBeCloseTo(9 / 16, 3);
    expect(stored()).toMatchObject({ width: 400, height: 400 });
    const after = await box(picture());
    expect(Math.abs(after.x - pic.x)).toBeLessThan(1.5);
    // The slide shows it through object-view-box.
    const viewBox = await layer()
      .locator("img")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("object-view-box"));
    expect(viewBox).toMatch(/^inset\(/);
  });

  it("dragging the dimmed picture pans it behind the selection, which stays put", async () => {
    const s = await scale();
    const before = { crop: crop() as Crop, x: stored().position?.x };
    const pic = await box(picture());
    await drag({ x: pic.x + 8, y: pic.y + pic.height / 2 }, 20, 0);
    expect((crop() as Crop).x).toBeCloseTo(before.crop.x - 20 / s / (400 * (16 / 9)), 2);
    expect(stored().position?.x).toBe(before.x);
    const after = await box(picture());
    expect(after.x - pic.x).toBeCloseTo(20, -0.5);
  });

  it("trimming an edge shrinks the layer over a picture that doesn't move", async () => {
    const s = await scale();
    const pic = await box(picture());
    const before = crop() as Crop;
    const x0 = stored().position?.x ?? 0;
    await drag(await centreOf(page.locator("[data-crop='trim-w']")), 40, 0);
    const trimmed = Math.round(40 / s);
    expect(stored().width).toBeCloseTo(400 - trimmed, -0.5);
    expect(stored().position?.x).toBeCloseTo(x0 + trimmed, -0.5);
    expect(stored().height).toBe(400);
    const now = crop() as Crop;
    expect(now.x).toBeGreaterThan(before.x);
    expect(now.w).toBeLessThan(before.w);
    // The picture didn't move on screen.
    const after = await box(picture());
    expect(Math.abs(after.x - pic.x)).toBeLessThan(1.5);
    expect(Math.abs(after.width - pic.width)).toBeLessThan(1.5);
  });

  it("dragging a picture corner scales it up, keeping the layer as it is", async () => {
    const before = crop() as Crop;
    const size = { width: stored().width, height: stored().height };
    await drag(await centreOf(page.locator("[data-crop='scale-se']")), 60, 60);
    const now = crop() as Crop;
    expect(now.w).toBeLessThan(before.w); // a bigger picture: a smaller share of it shows
    expect(now.h).toBeLessThan(before.h);
    expect(now.w / now.h).toBeCloseTo(before.w / before.h, 2); // never stretched
    expect({ width: stored().width, height: stored().height }).toEqual(size);
  });

  it("Esc leaves crop mode and keeps the image selected", async () => {
    const before = h.userTransactions();
    await page.keyboard.press("Escape");
    await expect.poll(() => picture().count()).toBe(0);
    expect(await page.locator(".inspector-head strong").textContent()).toBe("Image");
    await page.getByRole("button", { name: "Crop image" }).waitFor();
    expect(h.userTransactions()).toBe(before);
  });

  it("outside crop mode, corners keep the ratio (Shift frees it), Ctrl on an edge trims", async () => {
    const ratio = () => (stored().width ?? 0) / (stored().height ?? 1);
    const r0 = ratio();
    await drag(await centreOf(page.locator(".outline-selected .handle-se")), 50, 0);
    expect(ratio()).toBeCloseTo(r0, 1);
    await drag(await centreOf(page.locator(".outline-selected .handle-se")), 0, 60, "Shift");
    expect(ratio()).toBeLessThan(r0 - 0.05);

    const before = crop() as Crop;
    const width = stored().width ?? 0;
    await drag(await centreOf(page.locator(".outline-selected .handle-e")), -40, 0, "Control");
    expect(h.changes.at(-1)?.label).toBe("Crop image");
    expect(stored().width).toBeLessThan(width);
    expect((crop() as Crop).w).toBeLessThan(before.w);
    expect((crop() as Crop).x).toBeCloseTo(before.x, 3); // the left edge didn't move
  });

  it("Reset shows the whole picture again, and undo brings the crop back", async () => {
    const kept = crop();
    const before = h.userTransactions();
    await page.getByRole("button", { name: "Reset Crop to default" }).click();
    await expect.poll(() => h.userTransactions()).toBe(before + 1);
    await h.synced();
    expect(crop()).toBeUndefined();
    await page.keyboard.press("Control+z");
    await expect.poll(crop).toEqual(kept);
  });

  it("raised no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
