import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuiltinRegistry } from "@veloce/builtins";
import {
  createSlide,
  type Deck,
  element,
  type ServerMessage,
  type SlideMeasurement,
} from "@veloce/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile, slugify } from "./fs.js";
import { HISTORY_LIMIT } from "./open-deck.js";
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

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "veloce-ws-"));
  logs.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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
