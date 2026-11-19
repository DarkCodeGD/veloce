/**
 * Phase 3 acceptance (round 4): the paint picker (D66). Humans make and edit what agents
 * already could: gradients (linear, radial, angular) with stops dragged on a bar, and image
 * fills uploaded or reused, on shapes, frames and the slide background. Every gesture is one
 * undo step. Real Chromium against the real server; the image goes through the upload route.
 */
import { crc32, deflateSync } from "node:zlib";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

/** A valid RGB PNG of one color. */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = [0, ...Array.from({ length: width }, () => [r, g, b]).flat()];
  const pixels = Buffer.from(Array.from({ length: height }, () => row).flat());
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Paint", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          { id: "title", type: "text", props: { content: "Paint", style: "$text.h1" } },
          {
            id: "glow",
            type: "shape",
            width: 400,
            height: 160,
            props: { shape: "rect", fill: "$color.primary" },
          },
          {
            // A second shape: the same Fill field, for a picker that must not carry over.
            id: "badge",
            type: "shape",
            width: 160,
            height: 60,
            props: { shape: "rect", fill: "$color.accent" },
          },
        ],
      },
    },
  });
}

const canvasNode = (id: string) => page.locator(`.editor-canvas [data-node-id='${id}']`);
const fill = () => h.stored("glow").props?.fill as Record<string, unknown> | string | undefined;
const stops = () =>
  (fill() as { stops?: Array<{ offset: number; color: string }> } | undefined)?.stops ?? [];

/** The glow shape's painted background image (`none`, `linear-gradient(…)`, `url(…)`). */
async function glowImage() {
  return canvasNode("glow").evaluate((root) => {
    for (const el of [root, ...root.querySelectorAll("*")]) {
      const image = getComputedStyle(el).backgroundImage;
      if (image !== "none") return image;
    }
    return "none";
  });
}

/** Run `act`; expect exactly one transaction from it (one undo step). */
async function oneStep(act: () => Promise<void>) {
  const before = h.userTransactions();
  await act();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
  await page.waitForTimeout(50); // let React render the new value into the picker
}

async function openPicker(field: string) {
  await page.getByRole("button", { name: `${field}: color picker` }).click();
  const picker = page.getByRole("dialog", { name: "Color picker" });
  await picker.waitFor();
  return picker;
}

async function closePicker(picker: Locator) {
  await page.keyboard.press("Escape");
  await expect.poll(() => picker.count()).toBe(0);
}

/** Drag from one point to another with the mouse, in steps. */
async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='glow']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: the paint picker", { timeout: 60_000 }, () => {
  it("turns a color into a gradient of itself, in one step", async () => {
    await canvasNode("glow").click();
    const picker = await openPicker("Fill");
    await oneStep(() => picker.getByRole("tab", { name: "Linear" }).click());
    // Figma's start: the color fading out. A theme color stays a theme color.
    expect(fill()).toEqual({
      type: "linear-gradient",
      angle: 180,
      stops: [
        { offset: 0, color: "$color.primary" },
        { offset: 1, color: "$color.primary/0" },
      ],
    });
    await expect.poll(glowImage).toMatch(/^linear-gradient\(/);
  });

  it("adds a stop by clicking the bar, colored like the gradient is there", async () => {
    const picker = page.getByRole("dialog", { name: "Color picker" });
    const rail = picker.locator(".paint-stop-rail");
    const { box } = await center(rail);
    await oneStep(() => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2));
    expect(stops()).toHaveLength(3);
    expect(stops()[1]?.offset).toBeCloseTo(0.5, 1);
    expect(stops()[1]?.color).toMatch(/^\$color\.primary\/(4[89]|5[0-2])$/);
  });

  it("drags a stop past another in one step; dragging it away removes it", async () => {
    const picker = page.getByRole("dialog", { name: "Color picker" });
    const rail = picker.locator(".paint-stop-rail");
    const { box } = await center(rail);
    const last = await center(picker.getByRole("slider", { name: "Fill stop 3" }));
    await oneStep(() => drag(last, { x: box.x + box.width * 0.25, y: last.y }));
    // Sorted again: the faded stop now sits at 25%, before the 50% one.
    expect(stops().map((s) => s.color)).toEqual([
      "$color.primary",
      "$color.primary/0",
      expect.stringMatching(/^\$color\.primary\/\d+$/),
    ]);
    expect(stops()[1]?.offset).toBeCloseTo(0.25, 1);

    const middle = await center(picker.getByRole("slider", { name: "Fill stop 2" }));
    await oneStep(() => drag(middle, { x: middle.x, y: middle.y + 80 }));
    expect(stops()).toHaveLength(2);
    expect(h.pageErrors).toEqual([]);
  });

  it("recolors the selected stop with a swatch, keeping its opacity; edits the angle", async () => {
    const picker = page.getByRole("dialog", { name: "Color picker" });
    await picker.getByRole("slider", { name: "Fill stop 2" }).click();
    const opacity = Number(String(stops()[1]?.color).split("/")[1] ?? 100);
    await oneStep(() => picker.getByRole("button", { name: "Fill stop: accent" }).click());
    expect(stops()[1]?.color).toBe(opacity === 100 ? "$color.accent" : `$color.accent/${opacity}`);

    const angle = picker.getByRole("spinbutton", { name: "Fill angle" });
    await angle.fill("45");
    await oneStep(() => angle.press("Enter"));
    expect(fill()).toMatchObject({ type: "linear-gradient", angle: 45 });
    await expect.poll(glowImage).toMatch(/^linear-gradient\(45deg/);
  });

  it("switches gradient kinds keeping the stops; angular takes a center", async () => {
    const picker = page.getByRole("dialog", { name: "Color picker" });
    const before = stops();
    await oneStep(() => picker.getByRole("tab", { name: "Angular" }).click());
    expect(fill()).toMatchObject({ type: "conic-gradient", angle: 45, stops: before });
    await expect.poll(glowImage).toMatch(/^conic-gradient\(from 45deg/);

    const x = picker.getByRole("spinbutton", { name: "Fill center x" });
    await x.fill("25");
    await oneStep(() => x.press("Enter"));
    expect(fill()).toMatchObject({ center: { x: 0.25, y: 0.5 } });

    await oneStep(() => picker.getByRole("tab", { name: "Radial" }).click());
    expect(fill()).toMatchObject({ type: "radial-gradient", center: { x: 0.25, y: 0.5 } });
    await expect.poll(glowImage).toMatch(/^radial-gradient\(/);

    // Back to a color: the first stop's.
    await oneStep(() => picker.getByRole("tab", { name: "Solid" }).click());
    expect(fill()).toBe("$color.primary");
    await closePicker(picker);
  });

  it("an image fill: uploaded in one step with its file, fitted, and its file dropped once unused", async () => {
    const picker = await openPicker("Fill");
    const before = h.userTransactions();
    await picker.getByRole("tab", { name: "Image" }).click();
    // Choosing the tab alone changes nothing: the file comes first.
    expect(h.userTransactions()).toBe(before);
    expect(fill()).toBe("$color.primary");

    await oneStep(() =>
      picker.locator("input[type=file]").setInputFiles({
        name: "sky.png",
        mimeType: "image/png",
        buffer: png(24, 16, [40, 120, 220]),
      }),
    );
    const image = fill() as { type: string; asset: string; fit: string };
    expect(image).toMatchObject({ type: "image", fit: "cover" });
    const id = image.asset.slice("asset:".length);
    expect(h.latestDeck().assets[id]).toMatchObject({ mime: "image/png", name: "sky.png" });
    await expect.poll(glowImage).toMatch(/^url\(/);

    await oneStep(() => picker.getByRole("button", { name: "Tile" }).click());
    expect(fill()).toMatchObject({ fit: "tile" });
    // The deck's images are offered for reuse.
    await expect
      .poll(() =>
        picker.getByRole("button", { name: "Use image sky.png" }).getAttribute("aria-pressed"),
      )
      .toBe("true");

    // Back to a color: nothing uses the file anymore, so the deck drops it (same step).
    await oneStep(() => picker.getByRole("tab", { name: "Solid" }).click());
    expect(fill()).toBe("$color.primary");
    expect(h.latestDeck().assets[id]).toBeUndefined();
    await closePicker(picker);

    // Undo brings the image fill back, file and all.
    await oneStep(() => page.keyboard.press("Control+z"));
    expect(fill()).toMatchObject({ type: "image", fit: "tile" });
    expect(h.latestDeck().assets[id]).toBeDefined();
    await expect.poll(glowImage).toMatch(/^url\(/);
    expect(h.pageErrors).toEqual([]);
  });

  it("stays open while the canvas pans; closes with its ✕ or when another layer is selected", async () => {
    let picker = await openPicker("Fill");
    expect(await picker.locator(".color-popover-head").textContent()).toBe("Fill");

    // A middle-button pan over the canvas (Figma keeps its picker open while you look around).
    const canvas = await page.locator(".editor-canvas").boundingBox();
    if (!canvas) throw new Error("no canvas");
    const from = { x: canvas.x + 40, y: canvas.y + canvas.height - 40 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(from.x + 60, from.y - 30, { steps: 4 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(100);
    expect(await picker.count()).toBe(1);

    await picker.getByRole("button", { name: "Close color picker" }).click();
    await expect.poll(() => picker.count()).toBe(0);

    // Another layer of the same kind (the same Fill field): no picker left editing the old one.
    picker = await openPicker("Fill");
    await canvasNode("badge").click();
    await expect.poll(() => picker.count()).toBe(0);
    await page.keyboard.press("Escape");
  });

  it("the slide background takes a gradient too", async () => {
    await page.keyboard.press("Escape"); // nothing selected: the slide's own section
    await expect
      .poll(() => page.getByRole("button", { name: "Background: color picker" }).count())
      .toBe(1);
    const picker = await openPicker("Background");
    await oneStep(() => picker.getByRole("tab", { name: "Radial" }).click());
    expect(h.latestDeck().slides[0]?.background).toMatchObject({
      type: "radial-gradient",
      center: { x: 0.5, y: 0.5 },
    });
    await closePicker(picker);
    // The row names the kind and its chip shows it.
    await expect
      .poll(() => page.locator(".paint-name").first().textContent())
      .toBe("Radial gradient");
    expect(h.pageErrors).toEqual([]);
  });
});
