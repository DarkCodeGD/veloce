import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { createBuiltinRegistry } from "@veloce/builtins";
import {
  createSlide,
  type Deck,
  element,
  type LintReport,
  type ServerMessage,
  type SlideMeasurement,
} from "@veloce/core";
import { optimizeInWorker, stopOptimizer } from "@veloce/images";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atomicWriteFile, slugify } from "./fs.js";
import { DeckLinter, lintWithRender } from "./lint.js";
import { HISTORY_LIMIT, UPLOAD_GRACE_MS } from "./open-deck.js";
import { CachedRenderService, type RenderService } from "./render.js";
import { SyncHub } from "./sync-hub.js";
import { Workspace } from "./workspace.js";

let dir: string;
const logs: string[] = [];
const context = createBuiltinRegistry().applyContext();
const open = () => Workspace.open({ dir, context, autosaveDelayMs: 5, log: (m) => logs.push(m) });

const titleSlide = (title = "Hello") =>
  createSlide({
    id: "s1",
    rootId: "r1",
    children: [element("text", { content: title, style: "$text.h1" }, { id: "title" })],
  });

/** A fake editor tab: records what the hub sends it. */
function client(hub: SyncHub) {
  const inbox: ServerMessage[] = [];
  const conn = hub.connect((m) => inbox.push(structuredClone(m)));
  const send = async (message: unknown) => {
    conn.receive(JSON.stringify(message));
    await new Promise((r) => setTimeout(r, 0));
  };
  const last = <T extends ServerMessage["type"]>(type: T) =>
    inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type).at(-1);
  return { inbox, conn, send, last };
}

/** Let timers and pending async work (saves, debounced lint) run. */
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "veloce-ws-"));
  logs.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
afterAll(() => stopOptimizer());

describe("fs helpers", () => {
  it("writes atomically without leaving temp files, and slugifies titles", async () => {
    const path = join(dir, "a.bin");
    await atomicWriteFile(path, new Uint8Array([1, 2, 3]));
    await atomicWriteFile(path, new Uint8Array([4]));
    expect([...(await readFile(path))]).toEqual([4]);
    expect(await readdir(dir)).toEqual(["a.bin"]);
    expect(slugify("Q3 Pitch: Café Acme!")).toBe("q3-pitch-cafe-acme");
    expect(slugify("!!!")).toBe("untitled");
  });
});

describe("Workspace", () => {
  it("creates decks, autosaves changes and reloads them identically", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "Pitch Deck" });
    expect(ws.activeDeckId).toBe(deck.id);
    const result = deck.apply({
      origin: "agent:test",
      label: "Add slide",
      ops: [{ op: "slide.insert", slide: titleSlide() }],
    });
    expect(result.ok).toBe(true);
    await ws.close();
    expect(await readdir(dir)).toEqual(["pitch-deck.veloce"]);

    const again = await open();
    expect(again.list()).toMatchObject([
      { id: deck.id, title: "Pitch Deck", slideCount: 1, file: "pitch-deck.veloce" },
    ]);
    const reopened = await again.get(deck.id);
    expect(reopened.deck).toEqual(deck.deck);
    const second = await again.create({ title: "Pitch Deck" });
    expect(second.path.endsWith("pitch-deck-2.veloce")).toBe(true);
    await again.close();
  });

  it("validates plugin props on every transaction", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "t" });
    const bad = deck.apply({
      origin: "user",
      label: "x",
      ops: [
        { op: "slide.insert", slide: createSlide({ children: [element("text", { content: 5 })] }) },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toMatch(/props\.content/);
    await ws.close();
  });

  it("requires asset bytes before asset.add, and saves them", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "Assets" });
    const bytes = new TextEncoder().encode("not really a png");
    const add = (id: string) =>
      deck.apply({
        origin: "user",
        label: "add",
        ops: [{ op: "asset.add", id, asset: { mime: "image/png", bytes: bytes.length } }],
      });
    const missing = add("ab".repeat(32));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.message).toMatch(/haven't been uploaded/);
    const id = await deck.storeAsset(bytes);
    expect(add(id).ok).toBe(true);
    await ws.close();
    const again = await open();
    expect((await again.get(deck.id)).assetBytes(id)).toEqual(bytes);
    await again.close();
  });

  it("imports files as the server sees them, and holds asset.add to that", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "Import" });
    const gif = Uint8Array.from([...new TextEncoder().encode("GIF89a"), 3, 0, 2, 0, 0, 0]);
    const imported = await deck.importAsset(gif, "C:\\pics\\dot.gif");
    if (!imported.ok) throw new Error(imported.message);
    expect(imported.info).toEqual({
      mime: "image/gif",
      bytes: gif.length,
      name: "dot.gif",
      width: 3,
      height: 2,
    });
    expect(deck.deck.assets).toEqual({}); // nothing changes until asset.add
    const add = (asset: object) =>
      deck.apply({
        origin: "user",
        label: "add",
        ops: [{ op: "asset.add", id: imported.id, asset }],
      });
    // Claiming another type (or size) than what was uploaded is refused.
    const lie = add({ ...imported.info, mime: "font/woff2" });
    expect(lie.ok).toBe(false);
    if (!lie.ok) expect(lie.error.message).toMatch(/is image\/gif \(12 bytes\), not font\/woff2/);
    expect(add(imported.info).ok).toBe(true);
    expect(deck.deck.assets[imported.id]?.width).toBe(3);
    // Junk isn't stored at all.
    const junk = await deck.importAsset(new TextEncoder().encode("#!/bin/sh"));
    expect(junk).toEqual({ ok: false, message: expect.stringContaining("Unsupported file type") });
    await ws.close();
  });

  describe("optimizing imported images (D67)", { timeout: 60_000 }, () => {
    /** A photo-like PNG (gradients and grain), big enough to be worth optimizing. */
    const photoPng = (width: number, height: number) => {
      const raw = new Uint8Array((width * 3 + 1) * height);
      let seed = 7;
      for (let y = 0; y < height; y++) {
        const row = y * (width * 3 + 1); // filter byte 0 (none) first
        for (let x = 0; x < width; x++) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const grain = (seed % 25) - 12;
          raw.set(
            [60 + (150 * x) / width + grain, 90 + (100 * y) / height + grain, 140 + grain],
            row + 1 + x * 3,
          );
        }
      }
      const chunk = (type: string, data: Uint8Array) => {
        const out = new Uint8Array(12 + data.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, data.length);
        out.set(new TextEncoder().encode(type), 4);
        out.set(data, 8);
        view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
        return out;
      };
      const ihdr = new Uint8Array(13);
      new DataView(ihdr.buffer).setUint32(0, width);
      new DataView(ihdr.buffer).setUint32(4, height);
      ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
      const parts = [
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", new Uint8Array(0)),
      ];
      return Uint8Array.from(parts.flatMap((part) => [...part]));
    };

    it("stores the smaller WebP to add, and the original to keep instead", async () => {
      let calls = 0;
      const ws = await Workspace.open({
        dir,
        context,
        autosaveDelayMs: 5,
        optimizer: (bytes, size) => {
          calls++;
          return optimizeInWorker(bytes, size);
        },
      });
      const deck = await ws.create({ title: "Photos" });
      const png = photoPng(1200, 700);
      const imported = await deck.importAsset(png, "shots/beach.png");
      if (!imported.ok) throw new Error(imported.message);
      expect(imported.info).toMatchObject({ mime: "image/webp", name: "beach.webp", width: 1200 });
      expect(imported.info.bytes).toBeLessThan(png.length / 2);
      const original = imported.optimization?.original;
      expect(original?.info).toMatchObject({
        mime: "image/png",
        name: "beach.png",
        bytes: png.length,
      });
      expect(imported.optimization).toMatchObject({
        method: expect.stringMatching(/^webp/),
        resized: false,
      });
      // Both are stored and either can be added: "Keep original" swaps one for the other.
      expect(deck.assetBytes(imported.id)?.length).toBe(imported.info.bytes);
      expect(deck.assetBytes(original?.id ?? "")).toEqual(png);
      const keep = deck.apply({
        origin: "user",
        label: "Keep original",
        ops: [{ op: "asset.add", id: original?.id, asset: original?.info }],
      });
      expect(keep.ok).toBe(true);
      // The same file again: the earlier result, not another few seconds of CPU.
      expect(await deck.importAsset(png, "shots/beach.png")).toEqual(imported);
      expect(calls).toBe(1);
      // Asked not to (an agent that needs exact bytes, a copy between decks): as it is.
      const exact = await deck.importAsset(png, "beach.png", { optimize: false });
      expect(exact).toMatchObject({ ok: true, id: original?.id, info: { mime: "image/png" } });
      expect(exact.ok && exact.optimization).toBeUndefined();
      await ws.close();
    });

    it("skips small files and other formats without starting the optimizer", async () => {
      const ws = await Workspace.open({
        dir,
        context,
        autosaveDelayMs: 5,
        optimizer: () => {
          throw new Error("not for these");
        },
      });
      const deck = await ws.create({ title: "Small" });
      const small = await deck.importAsset(photoPng(40, 30), "icon.png");
      expect(small).toMatchObject({ ok: true, info: { mime: "image/png" } });
      const gif = Uint8Array.from([...new TextEncoder().encode("GIF89a"), 3, 0, 2, 0, 0, 0]);
      expect(await deck.importAsset(gif)).toMatchObject({ ok: true, info: { mime: "image/gif" } });
      await ws.close();
      // Turned off for the whole workspace: big files are left alone too.
      const off = await Workspace.open({ dir, context, optimizeImages: false });
      const big = await (await off.create({ title: "Off" })).importAsset(photoPng(1200, 700));
      expect(big).toMatchObject({ ok: true, info: { mime: "image/png" } });
      await off.close();
    });

    it("measures a sideways phone photo as shown (EXIF orientation)", async () => {
      // A JPEG frame header (SOF0) of 64×32, after an EXIF block saying "rotate 90°".
      // biome-ignore format: TIFF header (big-endian), one IFD entry: 0x0112 SHORT = 6
      const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
      const exif = [..."Exif\0\0"].map((c) => c.charCodeAt(0)).concat(tiff);
      const jpeg = Uint8Array.from([
        0xff,
        0xd8,
        ...[0xff, 0xe1, 0, exif.length + 2, ...exif],
        ...[0xff, 0xc0, 0, 11, 8, 0, 32, 0, 64, 1, 1, 0x11, 0],
        ...[0xff, 0xd9],
      ]);
      const ws = await open();
      const result = await (await ws.create({ title: "Phone" })).importAsset(jpeg, "IMG.jpg", {
        optimize: false,
      });
      expect(result).toMatchObject({ ok: true, info: { width: 32, height: 64 } });
      await ws.close();
    });
  });

  describe("sweeping unused asset bytes (D65)", () => {
    let now = 1_000_000;
    const clock = () => now;
    const gif = (w: number) =>
      Uint8Array.from([...new TextEncoder().encode("GIF89a"), w, 0, 1, 0, 0, 0]);
    const setup = async (sweepIntervalMs: number) => {
      const ws = await Workspace.open({
        dir,
        context,
        autosaveDelayMs: 5,
        sweepIntervalMs,
        now: clock,
      });
      const deck = await ws.create({ title: "Sweep" });
      const upload = async (w: number) => {
        const result = await deck.importAsset(gif(w));
        if (!result.ok) throw new Error(result.message);
        return result;
      };
      const run = (label: string, ops: unknown[]) =>
        expect(deck.apply({ origin: "user", label, ops }).ok).toBe(true);
      return { ws, deck, upload, run };
    };

    it("after a save: drops what nothing uses, never what the deck or undo needs", async () => {
      const { ws, deck, upload, run } = await setup(1e9); // no timer: only saves sweep
      const used = await upload(1); // added to the deck
      const removed = await upload(2); // added, then removed: undo can bring it back
      const orphan = await upload(3); // a cancelled drop: never added
      run("add", [
        { op: "asset.add", id: used.id, asset: used.info },
        { op: "asset.add", id: removed.id, asset: removed.info },
      ]);
      run("remove", [{ op: "asset.remove", id: removed.id }]);
      await ws.flush();
      expect(deck.assetBytes(orphan.id)).toBeDefined(); // still in its grace period

      now += UPLOAD_GRACE_MS + 1;
      run("rename", [{ op: "deck.updateMeta", set: { title: "Sweep 2" } }]);
      await ws.flush();
      expect(deck.assetBytes(orphan.id)).toBeUndefined();
      expect(deck.assetBytes(used.id)).toBeDefined();
      expect(deck.assetBytes(removed.id)).toBeDefined();
      // A late asset.add for it is refused, with the usual "upload it first" hint.
      const late = deck.apply({
        origin: "user",
        label: "late add",
        ops: [{ op: "asset.add", id: orphan.id, asset: orphan.info }],
      });
      expect(late.ok).toBe(false);
      // Undo still brings the removed asset back, with its bytes.
      expect(deck.undo("user")?.ok).toBe(true); // the rename
      expect(deck.undo("user")?.ok).toBe(true); // the removal
      expect(deck.deck.assets[removed.id]).toBeDefined();
      await ws.close();
    });

    it("re-uploading known bytes restarts their grace period", async () => {
      const { ws, deck, upload } = await setup(1e9);
      const orphan = await upload(4);
      now += UPLOAD_GRACE_MS - 1000; // almost expired…
      expect((await upload(4)).id).toBe(orphan.id); // …uploaded again, about to be added
      now += 2000; // past the first upload's grace, within the second's
      expect(deck.sweepAssets()).toEqual([]);
      now += UPLOAD_GRACE_MS;
      expect(deck.sweepAssets()).toEqual([orphan.id]);
      await ws.close();
    });

    it("on a timer too: an orphan in a deck nobody edits is freed", async () => {
      const { ws, deck, upload } = await setup(20);
      const orphan = await upload(5);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(deck.assetBytes(orphan.id)).toBeDefined(); // timer ran, grace still holds it
      now += UPLOAD_GRACE_MS + 1;
      await expect.poll(() => deck.assetBytes(orphan.id)).toBeUndefined();
      await ws.close();
    });
  });

  it("gives copied files their own deck ID and skips broken files", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "Original" });
    await ws.close();
    await writeFile(join(dir, "copy.veloce"), await readFile(deck.path));
    await writeFile(join(dir, "broken.veloce"), "not a zip");
    const again = await open();
    const ids = again.list().map((l) => l.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(deck.id);
    expect(logs.some((l) => l.startsWith("Skipped broken.veloce"))).toBe(true);
    await expect(again.get("nope")).rejects.toThrow(/No deck with ID "nope"/);
    await again.close();
  });
});

describe("SyncHub", () => {
  it("creates a deck from a tab (File → New): every tab switches to it", async () => {
    const ws = await open();
    const first = await ws.create({ title: "First" });
    const hub = new SyncHub(ws);
    const a = client(hub);
    const b = client(hub);
    await a.send({ type: "open", deckId: first.id });
    await b.send({ type: "open", deckId: first.id });

    await a.send({ type: "create", requestId: "n1", title: "  Q3 review  ", theme: "midnight" });
    // Creating writes the deck to disk: wait for the reply, not a fixed delay (flaky under load).
    await vi.waitFor(() =>
      expect(a.last("result")).toEqual({ type: "result", requestId: "n1", ok: true, version: 0 }),
    );
    const created = ws.list().find((d) => d.id !== first.id);
    expect(created?.title).toBe("Q3 review"); // trimmed
    // Both tabs hear that it's the active deck (they open it, as for an agent's create_deck).
    for (const tab of [a, b]) {
      expect(tab.last("decks")).toMatchObject({ activeDeckId: created?.id });
    }
    const deck = await ws.get(created?.id ?? "");
    expect(deck.deck.theme.name).toBe("Midnight");
    expect(deck.history).toEqual([]);

    // A theme that isn't built in: an error naming the real ones, and no deck.
    await a.send({ type: "create", requestId: "n2", title: "X", theme: "neon" });
    await vi.waitFor(() => expect(a.last("result")?.requestId).toBe("n2"));
    expect(a.last("result")).toMatchObject({
      requestId: "n2",
      ok: false,
      error: {
        code: "INVALID",
        message: expect.stringMatching(/No built-in theme "neon"\. Themes: light, dark/),
      },
    });
    await a.send({ type: "create", requestId: "n3", title: "   " });
    expect(a.last("error")?.message).toMatch(/Invalid message/);
    expect(ws.list()).toHaveLength(2);
    await ws.close();
  });

  it("syncs snapshots and changes, stamps the user origin, and keeps undo per origin", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "Live" });
    const hub = new SyncHub(ws);
    const a = client(hub);
    const b = client(hub);
    expect(a.last("welcome")).toMatchObject({ protocol: 1, activeDeckId: deck.id });

    await a.send({ type: "open", deckId: deck.id });
    await b.send({ type: "open", deckId: deck.id });
    expect(a.last("snapshot")).toMatchObject({ deckId: deck.id, version: 0 });

    // The agent adds a slide (through the server, like MCP will).
    deck.apply({
      origin: "agent:claude",
      label: "Add title",
      ops: [{ op: "slide.insert", slide: titleSlide() }],
    });
    expect(b.last("change")).toMatchObject({
      version: 1,
      origin: "agent:claude",
      label: "Add title",
    });

    // The user edits the title from tab A; both tabs get the change, tagged "user".
    await a.send({
      type: "transaction",
      requestId: "r1",
      deckId: deck.id,
      label: "Edit title",
      ops: [{ op: "node.update", id: "title", set: { props: { content: "Hi!" } } }],
    });
    expect(a.last("result")).toEqual({ type: "result", requestId: "r1", ok: true, version: 2 });
    expect(b.last("change")).toMatchObject({ version: 2, origin: "user" });

    // The user's undo reverts only the user's edit.
    await a.send({ type: "undo", requestId: "r2", deckId: deck.id });
    expect(a.last("result")).toMatchObject({ ok: true, version: 3 });
    expect(deck.deck.slides).toHaveLength(1);
    await a.send({ type: "undo", requestId: "r3", deckId: deck.id });
    expect(a.last("result")).toMatchObject({
      ok: false,
      error: { message: "Nothing to undo or redo" },
    });

    // Invalid edits are rejected with a reason; garbage gets a protocol error.
    await a.send({
      type: "transaction",
      requestId: "r4",
      deckId: deck.id,
      label: "x",
      ops: [{ op: "node.remove", id: "titel" }],
    });
    expect(a.last("result")).toMatchObject({ ok: false, error: { hint: 'Did you mean "title"?' } });
    await a.send({
      type: "transaction",
      requestId: "r5",
      deckId: deck.id,
      label: "x",
      ops: [],
      origin: "agent:fake",
    });
    expect(a.last("error")?.message).toMatch(/Invalid message/);
    a.conn.receive("{nope");
    await new Promise((r) => setTimeout(r, 0));
    expect(a.last("error")?.message).toBe("Messages must be JSON");

    // Closed connections stop receiving.
    b.conn.close();
    const before = b.inbox.length;
    deck.apply({
      origin: "user",
      label: "x",
      ops: [{ op: "deck.updateMeta", set: { title: "Renamed" } }],
    });
    expect(b.inbox).toHaveLength(before);
    expect(a.last("decks")?.decks[0]?.title).toBe("Renamed");
    a.conn.close();
    await ws.close();
  });

  it("keeps a bounded history for late joiners, stamped with time and touched slides", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "History" });
    const t0 = Date.now();
    deck.apply({
      origin: "agent:claude-code",
      label: "Add title",
      ops: [{ op: "slide.insert", slide: titleSlide() }],
    });
    deck.apply({
      origin: "user",
      label: "Edit title",
      ops: [{ op: "node.update", id: "title", set: { props: { content: "Hi" } } }],
    });
    deck.apply({
      origin: "user",
      label: "Rename",
      ops: [{ op: "deck.updateMeta", set: { title: "R" } }],
    });

    // A tab that opens now still sees what happened before it connected.
    const late = client(new SyncHub(ws));
    await late.send({ type: "open", deckId: deck.id });
    const history = late.last("snapshot")?.history ?? [];
    expect(history.map((e) => [e.version, e.origin, e.label, e.slideIds])).toEqual([
      [1, "agent:claude-code", "Add title", ["s1"]],
      [2, "user", "Edit title", ["s1"]],
      [3, "user", "Rename", []], // deck-level: no slide
    ]);
    expect(history.every((e) => e.at >= t0 && e.at <= Date.now())).toBe(true);

    // Live changes carry the same timestamp; undo shows up as its own entry.
    deck.undo("user");
    expect(late.last("change")).toMatchObject({ version: 4, label: "Undo: Rename" });
    expect(late.last("change")?.at).toBe(deck.history.at(-1)?.at);

    // Bounded: the oldest entries drop off.
    for (let i = 0; i < HISTORY_LIMIT; i++) {
      deck.apply({
        origin: "user",
        label: `n${i}`,
        ops: [{ op: "deck.updateMeta", set: { title: `t${i}` } }],
      });
    }
    expect(deck.history).toHaveLength(HISTORY_LIMIT);
    expect(deck.history[0]?.label).toBe("n0"); // the 4 earlier entries dropped off
    late.conn.close();
    await ws.close();
  });
});

describe("Reverting agent changes", () => {
  const secondSlide = () =>
    createSlide({
      id: "s2",
      rootId: "r2",
      children: [element("text", { content: "Two", style: "$text.h1" }, { id: "two" })],
    });

  /** A deck with: v1 agent adds s1, v2 agent retitles it, v3 user adds s2. */
  async function scenario() {
    const ws = await open();
    const deck = await ws.create({ title: "Review" });
    deck.apply({
      origin: "agent:claude",
      label: "Add title",
      ops: [{ op: "slide.insert", slide: titleSlide() }],
    });
    deck.apply({
      origin: "agent:claude",
      label: "Retitle",
      ops: [{ op: "node.update", id: "title", set: { props: { content: "Agent" } } }],
    });
    deck.apply({
      origin: "user",
      label: "Add slide",
      ops: [{ op: "slide.insert", slide: secondSlide() }],
    });
    return { ws, deck };
  }
  const content = (deck: { deck: Deck }) =>
    (deck.deck.slides[0]?.root.children?.[0] as { props?: { content?: string } } | undefined)?.props
      ?.content;

  it("takes back an agent's changes as one user change, which the user's undo restores", async () => {
    const { ws, deck } = await scenario();
    const result = deck.revert([1, 2], "user");
    expect(result.ok).toBe(true);
    expect(deck.deck.slides.map((s) => s.id)).toEqual(["s2"]); // the user's slide survives
    expect(deck.history.at(-1)).toMatchObject({
      version: 4,
      origin: "user",
      label: "Revert 2 AI changes",
      reverts: [2, 1],
      removedSlideIds: ["s1"],
    });
    expect(deck.history.filter((e) => e.reverted).map((e) => e.version)).toEqual([1, 2]);
    expect(deck.removedBy("s1")).toBe("user");

    // Ctrl+Z: the revert was the user's own step, so it comes back, marks cleared.
    expect(deck.undo("user")?.ok).toBe(true);
    expect(content(deck)).toBe("Agent");
    expect(deck.history.at(-1)).toMatchObject({ restores: [2, 1] });
    expect(deck.history.some((e) => e.reverted)).toBe(false);
    expect(deck.removedBy("s1")).toBeUndefined();

    // Redo follows the chain: reverted again.
    expect(deck.redo("user")?.ok).toBe(true);
    expect(deck.history.at(-1)).toMatchObject({ reverts: [2, 1] });
    expect(deck.history.filter((e) => e.reverted).map((e) => e.version)).toEqual([1, 2]);
    await ws.close();
  });

  it("reverts a single change on top of later edits to other fields", async () => {
    const { ws, deck } = await scenario();
    deck.apply({
      origin: "user",
      label: "Fade",
      ops: [{ op: "node.update", id: "title", set: { opacity: 0.5 } }],
    });
    expect(deck.revert([2], "user")).toMatchObject({ ok: true });
    expect(deck.history.at(-1)?.label).toBe('Revert "Retitle"');
    expect(content(deck)).toBe("Hello"); // the agent's retitle is gone…
    expect(deck.deck.slides[0]?.root.children?.[0]).toMatchObject({ opacity: 0.5 }); // …the fade stays
    await ws.close();
  });

  it("refuses what it can't revert, changing nothing", async () => {
    const { ws, deck } = await scenario();
    const version = deck.version;
    expect(deck.revert([3], "user")).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(deck.revert([99], "user")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(deck.revert([2], "user").ok).toBe(true);
    expect(deck.revert([2], "user")).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: '"Retitle" is already reverted' },
    });
    // The user deleted the agent's slide: its retitle can't be taken back any more.
    deck.apply({ origin: "user", label: "Delete", ops: [{ op: "slide.remove", id: "s1" }] });
    const failed = deck.revert([1], "user");
    expect(failed).toMatchObject({ ok: false, error: { message: /^Can't revert: / } });
    expect(deck.version).toBe(version + 2); // just the revert and the delete
    await ws.close();
  });

  it("remembers who removed which node, and from where, until it comes back", async () => {
    const { ws, deck } = await scenario();
    // The user deletes s2's text: recorded, and listed on the change.
    deck.apply({ origin: "user", label: "Delete", ops: [{ op: "node.remove", id: "two" }] });
    expect(deck.removedNode("two")).toEqual({
      origin: "user",
      slideId: "s2",
      withSlide: false,
      label: "Two",
    });
    expect(deck.history.at(-1)?.removedNodeIds).toEqual(["two"]);
    // Reverting the agent's slide takes its nodes along: listed as the slide, not each node.
    expect(deck.revert([1, 2], "user").ok).toBe(true);
    expect(deck.removedNode("title")).toMatchObject({
      origin: "user",
      slideId: "s1",
      withSlide: true,
    });
    expect(deck.history.at(-1)?.removedNodeIds).toBeUndefined();
    // Undo brings them back: no longer removed.
    deck.undo("user");
    expect(deck.removedNode("title")).toBeUndefined();
    // A node moved to another slide in the same change isn't gone.
    deck.apply({
      origin: "agent:claude",
      label: "Move",
      ops: [{ op: "node.move", id: "title", parentId: "r2" }],
    });
    expect(deck.removedNode("title")).toBeUndefined();
    expect(deck.history.at(-1)?.removedNodeIds).toBeUndefined();
    await ws.close();
  });

  it("over sync: a revert message, and change messages that mark what they revert", async () => {
    const { ws, deck } = await scenario();
    const hub = new SyncHub(ws);
    const tab = client(hub);
    await tab.send({ type: "open", deckId: deck.id });
    await tab.send({ type: "revert", requestId: "r1", deckId: deck.id, versions: [2] });
    expect(tab.last("result")).toMatchObject({ ok: true, version: 4 });
    expect(tab.last("change")).toMatchObject({ origin: "user", reverts: [2] });
    await tab.send({ type: "undo", requestId: "r2", deckId: deck.id });
    expect(tab.last("change")).toMatchObject({ restores: [2] });
    await tab.send({ type: "revert", requestId: "r3", deckId: deck.id, versions: [3] });
    expect(tab.last("result")).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    // A tab opening later sees the marks in its snapshot.
    await tab.send({ type: "revert", requestId: "r4", deckId: deck.id, versions: [1, 2] });
    const late = client(hub);
    await late.send({ type: "open", deckId: deck.id });
    const history = late.last("snapshot")?.history ?? [];
    expect(history.filter((e) => e.reverted).map((e) => e.version)).toEqual([1, 2]);
    tab.conn.close();
    late.conn.close();
    await ws.close();
  });
});

describe("Lint for editor tabs (D73)", () => {
  /** "Measures" every text as overflowing by 50px, and counts what it measured. */
  function overflowingRender() {
    const measured: string[][] = [];
    const render: RenderService = {
      async measure(deck, { slideIds }) {
        const slides = deck.slides.filter((s) => !slideIds || slideIds.includes(s.id));
        measured.push(slides.map((s) => s.id));
        return slides.map((slide) => ({
          slideId: slide.id,
          stage: deck.stage,
          nodes: Object.fromEntries(
            slide.root.children.map((n, i) => [
              n.id,
              {
                bounds: { x: 100, y: 100 + i * 200, width: 800, height: 100 },
                overflow: { x: 0, y: 50 },
              },
            ]),
          ),
        }));
      },
      screenshot: async () => ({ data: new Uint8Array(), mimeType: "image/png" }),
      close: async () => {},
    };
    return { render, measured };
  }

  it("lints with measurements, or says why visual checks were skipped", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "L" });
    deck.apply({ origin: "user", label: "a", ops: [{ op: "slide.insert", slide: titleSlide() }] });
    const { render } = overflowingRender();
    const measured = await lintWithRender(deck.deck, { deckId: deck.id, render });
    expect(measured.visual).toBe(true);
    expect(measured.issues.map((i) => i.rule)).toContain("overflow");
    const none = await lintWithRender(deck.deck, {
      deckId: deck.id,
      render: null,
      unavailable: "off",
    });
    expect(none).toMatchObject({ visual: "off" });
    expect(none.issues.map((i) => i.rule)).not.toContain("overflow");
    const broken: RenderService = {
      ...render,
      measure: async () => Promise.reject(new Error("boom")),
    };
    expect(await lintWithRender(deck.deck, { deckId: deck.id, render: broken })).toMatchObject({
      visual: "renderer failed (boom)",
    });
    await ws.close();
  });

  it("reports on watch and after each burst of changes, never an outdated version", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "L" });
    const { render, measured } = overflowingRender();
    const linter = new DeckLinter({ render: () => render, delayMs: 20 });
    const reports: LintReport[] = [];
    const stop = linter.watch(deck, (r) => reports.push(r));
    await tick();
    expect(reports).toEqual([{ version: 0, issues: [], visual: true }]);

    // Three quick changes: one run, for the latest version.
    deck.apply({ origin: "user", label: "a", ops: [{ op: "slide.insert", slide: titleSlide() }] });
    deck.apply({
      origin: "user",
      label: "b",
      ops: [{ op: "slide.insert", slide: createSlide({ id: "s2" }) }],
    });
    deck.apply({
      origin: "user",
      label: "c",
      ops: [{ op: "slide.update", id: "s2", set: { name: "Two" } }],
    });
    await tick(60);
    expect(reports.map((r) => r.version)).toEqual([0, 3]);
    expect(measured).toHaveLength(2);
    expect(reports[1]?.issues.map((i) => [i.rule, i.slideId])).toEqual(
      expect.arrayContaining([
        ["overflow", "s1"],
        ["empty-slide", "s2"],
      ]),
    );

    // A second watcher gets the current report at once, without another run.
    const late: LintReport[] = [];
    const stopLate = linter.watch(deck, (r) => late.push(r));
    expect(late.map((r) => r.version)).toEqual([3]);
    expect(measured).toHaveLength(2);

    // Nobody watching: changes don't lint.
    stop();
    stopLate();
    deck.apply({ origin: "user", label: "d", ops: [{ op: "slide.remove", id: "s2" }] });
    await tick(60);
    expect(measured).toHaveLength(2);
    linter.close();
    await ws.close();
  });

  it("drops a report that a change made outdated while it ran", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "L" });
    let release: () => void = () => {};
    const slow: RenderService = {
      ...overflowingRender().render,
      measure: (d, o) =>
        new Promise((resolve) => {
          release = () => void overflowingRender().render.measure(d, o).then(resolve);
        }),
    };
    const linter = new DeckLinter({ render: () => slow, delayMs: 0 });
    const reports: LintReport[] = [];
    linter.watch(deck, (r) => reports.push(r));
    await tick();
    deck.apply({ origin: "user", label: "a", ops: [{ op: "slide.insert", slide: titleSlide() }] });
    release(); // version 0's run finishes after the change: dropped
    await tick();
    release(); // the rerun, for version 1
    await tick();
    expect(reports.map((r) => r.version)).toEqual([1]);
    linter.close();
    await ws.close();
  });

  it("over sync: a tab gets its open deck's lint, and stops when it leaves", async () => {
    const ws = await open();
    const deck = await ws.create({ title: "L" });
    let runs = 0;
    const linter = new DeckLinter({
      render: () => {
        runs++; // asked once per lint run
        return null;
      },
      unavailable: () => "no browser",
      delayMs: 0,
    });
    const tab = client(new SyncHub(ws, { linter }));
    await tab.send({ type: "open", deckId: deck.id });
    await tick();
    expect(tab.last("lint")).toEqual({
      type: "lint",
      deckId: deck.id,
      version: 0,
      issues: [],
      visual: "no browser",
    });
    deck.apply({
      origin: "agent:x",
      label: "a",
      ops: [{ op: "slide.insert", slide: createSlide({ id: "e" }) }],
    });
    await tick();
    expect(tab.last("lint")).toMatchObject({ version: 1, issues: [{ rule: "empty-slide" }] });
    tab.conn.close();
    const count = tab.inbox.length;
    const ran = runs;
    deck.apply({ origin: "agent:x", label: "b", ops: [{ op: "slide.remove", id: "e" }] });
    await tick();
    expect(tab.inbox).toHaveLength(count);
    expect(runs).toBe(ran); // a closed tab stops the linting too, not just the messages
    linter.close();
    await ws.close();
  });
});

describe("CachedRenderService", () => {
  it("measures each unchanged slide only once", async () => {
    const measured: string[] = [];
    const inner: RenderService = {
      measure: async (deck, { slideIds }) =>
        (slideIds ?? deck.slides.map((s) => s.id)).map((slideId): SlideMeasurement => {
          measured.push(slideId);
          return { slideId, stage: deck.stage, nodes: {} };
        }),
      screenshot: async () => ({ data: new Uint8Array(), mimeType: "image/png" }),
      close: async () => {},
    };
    const service = new CachedRenderService(inner);
    const ws = await open();
    const live = await ws.create({ title: "t" });
    live.apply({
      origin: "user",
      label: "a",
      ops: [
        { op: "slide.insert", slide: titleSlide() },
        { op: "slide.insert", slide: createSlide({ id: "s2" }) },
      ],
    });
    const deck1: Deck = live.deck;
    await service.measure(deck1, { deckId: live.id });
    live.apply({
      origin: "user",
      label: "b",
      ops: [{ op: "node.update", id: "title", set: { props: { content: "New" } } }],
    });
    const result = await service.measure(live.deck, { deckId: live.id });
    expect(measured).toEqual(["s1", "s2", "s1"]);
    expect(result.map((m) => m.slideId)).toEqual(["s1", "s2"]);
    await ws.close();
  });
});
