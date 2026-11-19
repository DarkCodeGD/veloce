/**
 * Phase 3 acceptance (assets): images dropped on the canvas or pasted (screenshots), copied
 * between decks with the clipboard, replaced from the inspector; big photos optimized, with
 * "Keep original" (D67); fonts dropped in and used by the theme. Every import is one transaction (`asset.add` + the layers), undone in one step.
 * Real Chromium against the real server; the files go through the real upload route.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, brotliDecompressSync, crc32, deflateSync } from "node:zlib";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

// ── Real files, made here ───────────────────────────────────────────────────────────────

/** A valid RGB PNG of one color. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  return pngOf(width, height, () => rgb);
}

/** A photo-like PNG: gradients and film grain (seeded), big enough to be optimized. */
function photo(width: number, height: number): Buffer {
  let seed = 42;
  const grain = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * 24;
  };
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return pngOf(width, height, (x, y) => {
    const n = grain();
    return [clamp(60 + (150 * x) / width + n), clamp(90 + (100 * y) / height + n), clamp(170 + n)];
  });
}

/** A valid RGB PNG, pixel by pixel. */
function pngOf(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
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
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The bundled Lora font, renamed "Zora" inside its `name` table: a real, loadable font whose
 * family the editor doesn't already ship, so a pass can't come from the bundled one.
 */
function zoraFont(): Buffer {
  const file = readFileSync(
    fileURLToPath(
      new URL(
        "../../apps/editor/node_modules/@fontsource-variable/lora/files/lora-latin-wght-normal.woff2",
        import.meta.url,
      ),
    ),
  );
  const count = file.readUInt16BE(12);
  let o = 48;
  const base128 = () => {
    let value = 0;
    for (;;) {
      const byte = file[o++] ?? 0;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
  };
  const tables: Array<{ known: number; length: number }> = [];
  for (let i = 0; i < count; i++) {
    const flags = file[o++] ?? 0;
    if ((flags & 0x3f) === 63) o += 4;
    const known = flags & 0x3f;
    const version = (flags >> 6) & 3;
    const original = base128();
    const transformed = known === 10 || known === 11 ? version !== 3 : version !== 0;
    tables.push({ known, length: transformed ? base128() : original });
  }
  const stream = brotliDecompressSync(file.subarray(o, o + file.readUInt32BE(20)));
  let at = 0;
  for (const { known, length } of tables) {
    if (known === 5) {
      // The name table: "Lora" → "Zora", in UTF-16BE and Mac Roman records alike.
      const name = stream.subarray(at, at + length);
      for (let i = 0; i + 4 <= name.length; i++) {
        if (name.toString("latin1", i, i + 4) === "Lora") name[i] = 0x5a;
        if (name[i] === 0 && name[i + 1] === 0x4c && name[i + 3] === 0x6f) name[i + 1] = 0x5a;
      }
    }
    at += length;
  }
  const packed = brotliCompressSync(stream);
  const head = Buffer.from(file.subarray(0, o));
  // Browsers reject a WOFF2 file whose length isn't a multiple of 4: pad the end.
  const padding = Buffer.alloc((4 - ((head.length + packed.length) % 4)) % 4);
  head.writeUInt32BE(packed.length, 20);
  head.writeUInt32BE(head.length + packed.length + padding.length, 8);
  return Buffer.concat([head, packed, padding]);
}

const RED = png(40, 20, [220, 30, 30]);
const BLUE = png(30, 30, [30, 60, 220]);

async function build(agent: Client) {
  // A second deck with a picture, to copy from.
  await agent.callTool({ name: "create_deck", arguments: { title: "Other", theme: "light" } });
  const added = await agent.callTool({
    name: "add_asset",
    arguments: { files: [{ data: BLUE.toString("base64"), name: "blue.png" }] },
  });
  const text = (added.content as Array<{ text: string }>)[0]?.text ?? "";
  const ref = /"(asset:[0-9a-f]{64})"/.exec(text)?.[1];
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "o1",
        children: [
          {
            id: "pic",
            name: "Blue",
            type: "image",
            width: 300,
            height: 300,
            props: { asset: ref, alt: "Blue" },
          },
        ],
      },
    },
  });
  // The deck under test (opened in the editor): a free slide.
  await agent.callTool({ name: "create_deck", arguments: { title: "Assets", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "absolute" },
        children: [
          {
            id: "title",
            type: "text",
            position: { x: 80, y: 60 },
            props: { content: "Gallery", style: "$text.h1" },
          },
        ],
      },
    },
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────

const deck = () => h.latestDeck();
const rootChildren = () =>
  (deck().slides[0]?.root.children ?? []) as Array<Record<string, unknown>>;
const images = () => rootChildren().filter((n) => n.type === "image");
/** The `asset:<id>` an image layer points at ("" when there's no such layer). */
const assetOf = (node: Record<string, unknown> | undefined) =>
  String((node?.props as { asset?: string } | undefined)?.asset ?? "");

async function slideBox() {
  const box = await page.locator(".editor-canvas .slide-surface").boundingBox();
  if (!box) throw new Error("no slide on screen");
  return box;
}

/** Drop files on the canvas at a slide point, the way a drag from the desktop does. */
async function dropFiles(
  files: Array<{ name: string; type: string; bytes: Buffer }>,
  at = { x: 960, y: 540 },
) {
  const box = await slideBox();
  const scale = box.width / 1920;
  const client = { x: box.x + at.x * scale, y: box.y + at.y * scale };
  await page.evaluate(
    ({ files, client }) => {
      const data = new DataTransfer();
      for (const f of files) {
        data.items.add(
          new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, {
            type: f.type,
          }),
        );
      }
      const target = document.elementFromPoint(client.x, client.y) ?? document.body;
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: data,
            clientX: client.x,
            clientY: client.y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    {
      files: files.map((f) => ({ name: f.name, type: f.type, base64: f.bytes.toString("base64") })),
      client,
    },
  );
}

async function undo() {
  const before = h.userTransactions();
  await page.keyboard.press("Control+z");
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
}

const toast = () => page.locator(".toast").last().textContent();

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='title']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: assets", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await page.keyboard.press("Escape");
    await h.synced();
  });

  it("drops an image where it lands: one transaction registers the file and adds the layer", async () => {
    const before = h.userTransactions();
    await dropFiles([{ name: "red.png", type: "image/png", bytes: RED }], { x: 600, y: 400 });
    await expect.poll(() => images().length).toBe(1);
    expect(h.userTransactions()).toBe(before + 1);
    expect(h.changes.at(-1)?.label).toBe('Add image "red.png"');
    const [image] = images();
    const id = /^asset:([0-9a-f]{64})$/.exec(assetOf(image))?.[1] ?? "";
    expect(deck().assets[id]).toEqual({
      mime: "image/png",
      bytes: RED.length,
      name: "red.png",
      width: 40,
      height: 20,
    });
    // Own pixel size, centred on the drop point. The pointer lands on whole screen pixels, and
    // the slide is drawn smaller than 1:1, so allow one screen pixel's worth of slide pixels.
    expect(image).toMatchObject({ name: "red", width: 40, height: 20 });
    const p = image?.position as { x: number; y: number };
    const tolerance = Math.ceil(1920 / ((await slideBox()).width || 1920)) + 1;
    expect(Math.abs(p.x - 580)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(p.y - 390)).toBeLessThanOrEqual(tolerance);
    await h.synced();
    // Selected, and really shown (the upload is served back).
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("red");
    const shown = page.locator(`.editor-canvas [data-node-id="${image?.id}"] img`);
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40);

    await undo();
    expect(images()).toHaveLength(0);
    expect(deck().assets).toEqual({});
  });

  it("refuses files it can't use, saying why, and changes nothing", async () => {
    const before = h.userTransactions();
    await dropFiles([{ name: "notes.txt", type: "text/plain", bytes: Buffer.from("hello") }]);
    await expect.poll(toast).toMatch(/Veloce can import images/);
    await dropFiles([{ name: "fake.png", type: "image/png", bytes: Buffer.from("not a png") }]);
    await expect.poll(toast).toMatch(/fake\.png: Unsupported file type/);
    expect(h.userTransactions()).toBe(before);
  });

  it("pastes a screenshot from the clipboard as an image layer", async () => {
    await page.evaluate((base64) => {
      const data = new DataTransfer();
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], "image.png", { type: "image/png" }));
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
    }, RED.toString("base64"));
    await expect.poll(() => images().length).toBe(1);
    expect(images()[0]).toMatchObject({ width: 40, height: 20 });
    await h.synced();
    await undo();
    expect(images()).toHaveLength(0);
  });

  it("copies an image to another deck: the file comes along, in the paste's one transaction", async () => {
    const decks = page.getByRole("combobox", { name: "Open deck" });
    await decks.click();
    await page.getByRole("option", { name: "Other" }).click();
    const pic = page.locator('.editor-canvas [data-node-id="pic"]');
    await pic.waitFor();
    await pic.click();
    await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe("Blue");
    await page.keyboard.press("Control+c");

    await decks.click();
    await page.getByRole("option", { name: "Assets" }).click();
    await page.locator(".editor-canvas [data-node-id='title']").waitFor();
    await page.keyboard.press("Escape");
    const before = h.userTransactions();
    await page.keyboard.press("Control+v");
    await expect.poll(() => deck().meta.title === "Assets" && images().length).toBe(1);
    expect(h.userTransactions()).toBe(before + 1);
    const ref = assetOf(images()[0]);
    expect(deck().assets[ref.slice(6)]).toMatchObject({
      mime: "image/png",
      name: "blue.png",
      width: 30,
    });
    await h.synced();
    const shown = page.locator(`.editor-canvas [data-node-id="${images()[0]?.id}"] img`);
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(30);
    await undo();
    expect(deck().assets).toEqual({});
  });

  it("replaces a picture from the inspector, dropping the old file", async () => {
    await dropFiles([{ name: "red.png", type: "image/png", bytes: RED }]);
    await expect.poll(() => images().length).toBe(1);
    await h.synced();
    const oldRef = assetOf(images()[0]);
    await expect.poll(() => page.locator(".asset-name").textContent()).toBe("red.png");
    const before = h.userTransactions();
    await page.locator(".asset-field input[type=file]").setInputFiles({
      name: "blue.png",
      mimeType: "image/png",
      buffer: BLUE,
    });
    await expect.poll(() => assetOf(images()[0])).not.toBe(oldRef);
    expect(h.userTransactions()).toBe(before + 1);
    expect(Object.values(deck().assets).map((a) => a.name)).toEqual(["blue.png"]);
    await h.synced();
    await expect.poll(() => page.locator(".asset-name").textContent()).toBe("blue.png");
    expect(await page.locator(".asset-size").textContent()).toBe("30 × 30");
    await undo(); // the old picture (and its file) come back
    expect(assetOf(images()[0])).toBe(oldRef);
    await undo();
    expect(images()).toHaveLength(0);
  });

  it("drops a font in: it's named from the file, offered in the theme, and renders", async () => {
    await dropFiles([{ name: "my-font.woff2", type: "font/woff2", bytes: zoraFont() }]);
    await expect.poll(() => Object.values(deck().assets)[0]?.font?.family).toBe("Zora");
    expect(h.changes.at(-1)?.label).toBe('Add font "Zora"');
    await expect.poll(toast).toMatch(/"Zora" is ready/);
    await h.synced();
    // The page registered the face from the deck and the browser accepted it.
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.fonts].some((f) => f.family === "Zora" && f.status === "loaded"),
        ),
      )
      .toBe(true);
    // Offered in the theme's font pickers (as a deck font), and it renders once picked.
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "Heading" }).click();
    await page.getByRole("option", { name: /Zora/ }).click();
    await expect.poll(() => deck().theme.fonts.heading).toBe('"Zora", system-ui, sans-serif');
    await h.synced();
    const family = await page
      .locator(".editor-canvas [data-node-id='title'] .v-text")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/^"?Zora"?,/);
    expect(await page.evaluate(() => document.fonts.check('700 80px "Zora"'))).toBe(true);
    await undo();
    await undo();
    expect(deck().assets).toEqual({});
  });

  it("optimizes a big photo on import, and keeps the original when asked (D67)", async () => {
    const PHOTO = photo(1400, 800);
    const before = h.userTransactions();
    await dropFiles([{ name: "beach.png", type: "image/png", bytes: PHOTO }]);
    await expect.poll(() => images().length, { timeout: 30_000 }).toBe(1);
    expect(h.userTransactions()).toBe(before + 1);
    const optimized = deck().assets[assetOf(images()[0]).slice(6)];
    expect(optimized).toMatchObject({ mime: "image/webp", name: "beach.webp", width: 1400 });
    expect(optimized?.bytes).toBeLessThan(PHOTO.length / 2);
    expect(images()[0]).toMatchObject({ name: "beach" });
    await expect
      .poll(toast)
      .toMatch(/^beach\.png optimized: \d\.\d MB → \d+ KB \(−\d+%\), looks the same/);
    await h.synced();
    // Shown from the WebP the server made.
    const shown = page.locator(`.editor-canvas [data-node-id="${images()[0]?.id}"] img`);
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1400);

    await page.getByRole("button", { name: "Keep original" }).click();
    await expect.poll(() => deck().assets[assetOf(images()[0]).slice(6)]?.mime).toBe("image/png");
    expect(h.userTransactions()).toBe(before + 2);
    expect(h.changes.at(-1)?.label).toBe("Keep original image");
    expect(Object.values(deck().assets)).toEqual([
      { mime: "image/png", bytes: PHOTO.length, name: "beach.png", width: 1400, height: 800 },
    ]);
    await h.synced();
    await undo(); // back to the optimized file
    expect(deck().assets[assetOf(images()[0]).slice(6)]?.mime).toBe("image/webp");
    await undo();
    expect(images()).toHaveLength(0);
    expect(deck().assets).toEqual({});
  });

  it("logged no errors in the page", () => {
    // The refused upload above is the one expected failure (Chromium logs every failed fetch).
    const unexpected = h.pageErrors.filter(
      (e) => !/status of 415 \(Unsupported Media Type\)/.test(e),
    );
    expect(unexpected).toEqual([]);
  });
});
