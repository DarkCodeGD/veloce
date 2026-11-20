/**
 * Phase 3 acceptance (round 5 parity, D82): an image's focus point, set by hand. The inspector
 * shows the picture with the part the layer keeps lit; dragging the dot previews on the slide
 * live and commits ONE transaction; arrow keys nudge it, Esc puts it back, reset clears it.
 * Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";
import { pngOf } from "./png.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** A 1600×900 picture, red on the left half and blue on the right, in a square layer. */
async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Focus" } });
  const halves = pngOf(160, 90, (x) => (x < 80 ? [220, 30, 30] : [30, 60, 220]));
  const added = await agent.callTool({
    name: "add_asset",
    arguments: { files: [{ data: halves.toString("base64"), name: "halves.png" }] },
  });
  const text = (added.content as Array<{ text: string }>)[0]?.text ?? "";
  const asset = /"(asset:[0-9a-f]{64})"/.exec(text)?.[1];
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          {
            id: "pic",
            type: "image",
            width: 400,
            height: 400,
            props: { asset, alt: "Two halves" },
          },
        ],
      },
    },
  });
}

const dot = () => page.getByRole("slider", { name: "Focus point" });
const pad = () => page.locator(".focus-pad img");
/** The picture's object-position on the slide, e.g. "50% 50%". */
const onSlide = () =>
  page
    .locator(".editor-canvas [data-node-id='pic'] img")
    .evaluate((el) => getComputedStyle(el).objectPosition);
const focus = () => (h.stored("pic").props as { focus?: { x: number; y: number } }).focus;

async function waitForTransactions(n: number) {
  await expect.poll(() => h.userTransactions()).toBe(n);
  await h.synced();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='pic'] img" });
  page = h.page;
  await page.locator(".editor-canvas [data-node-id='pic']").click();
  await dot().waitFor();
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe.skipIf(problem)("image focus point (D82)", () => {
  it("shows the picture with the part a square layer keeps lit, focus in the centre", async () => {
    expect(await dot().getAttribute("aria-valuetext")).toBe("50% across, 50% down");
    // A 16:9 picture in a square: the middle 9/16 of its width.
    const img = await pad().boundingBox();
    const crop = await page.locator(".focus-crop").boundingBox();
    expect((crop?.width ?? 0) / (img?.width ?? 1)).toBeCloseTo(9 / 16, 1);
    expect(Math.abs((crop?.x ?? 0) - (img?.x ?? 0) - ((img?.width ?? 0) * 7) / 32)).toBeLessThan(2);
    expect(await page.locator(".focus-readout").textContent()).toBe("50% · 50%");
    expect(await onSlide()).toBe("50% 50%");
  });

  it("dragging the dot previews on the slide live, then commits once", async () => {
    const before = h.userTransactions();
    await pad().scrollIntoViewIfNeeded(); // below the layer's fields in the inspector
    const img = await pad().boundingBox();
    if (!img) throw new Error("no preview");
    await page.mouse.move(img.x + img.width / 2, img.y + img.height / 2);
    await page.mouse.down();
    await page.mouse.move(img.x + img.width * 0.2, img.y + img.height / 2, { steps: 4 });
    // Live on the slide, nothing sent yet.
    await expect.poll(onSlide).toBe("20% 50%");
    expect(h.userTransactions()).toBe(before);
    await page.mouse.move(img.x - 30, img.y + img.height * 0.25, { steps: 2 }); // past the edge
    await page.mouse.up();
    await waitForTransactions(before + 1);
    expect(h.changes.at(-1)?.label).toBe("Change focus");
    expect(focus()).toEqual({ x: 0, y: 0.25 }); // kept on the picture
    // The crop slid to the left edge; the slide shows the red half.
    const crop = await page.locator(".focus-crop").boundingBox();
    expect(Math.abs((crop?.x ?? 0) - img.x)).toBeLessThan(2);
    await expect.poll(onSlide).toBe("0% 25%");
  });

  it("arrow keys nudge it (Shift: 10%), committed on release; Esc puts it back", async () => {
    const before = h.userTransactions();
    await dot().focus();
    await page.keyboard.press("Shift+ArrowRight");
    await waitForTransactions(before + 1);
    expect(focus()).toEqual({ x: 0.1, y: 0.25 });
    await page.keyboard.press("ArrowDown");
    await waitForTransactions(before + 2);
    expect(focus()).toEqual({ x: 0.1, y: 0.26 });
    // The layer itself didn't move (the arrows belonged to the dot).
    expect(h.stored("pic").position).toBeUndefined();
    // Held, then Esc: back where it was, nothing sent.
    await page.keyboard.down("ArrowRight");
    await expect.poll(() => dot().getAttribute("aria-valuetext")).toBe("11% across, 26% down");
    await page.keyboard.press("Escape");
    await page.keyboard.up("ArrowRight");
    await h.synced();
    expect(h.userTransactions()).toBe(before + 2);
    expect(await dot().getAttribute("aria-valuetext")).toBe("10% across, 26% down");
    // Esc went to the dot, not to the editor: the image is still selected.
    expect(await page.locator(".inspector-head strong").textContent()).toBe("Image");
  });

  it("reset clears it back to the centre, and undo brings it back", async () => {
    const before = h.userTransactions();
    await page.getByRole("button", { name: "Reset Focus to default" }).click();
    await waitForTransactions(before + 1);
    expect(focus()).toBeUndefined();
    await expect.poll(onSlide).toBe("50% 50%");
    await page.keyboard.press("Control+z");
    await expect.poll(focus).toEqual({ x: 0.1, y: 0.26 });
  });

  it("raised no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
