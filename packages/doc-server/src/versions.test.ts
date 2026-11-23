/**
 * Versions (D93) through the server: saved into the file at once, every tab of the deck
 * told, restored as the client's own undoable change, and their assets kept from the sweep.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSlide, element, type ServerMessage, sha256Hex } from "@veloce/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SyncHub } from "./sync-hub.js";
import { Workspace } from "./workspace.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "veloce-versions-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const text = (id: string, content: string) => element("text", { content }, { id });

function tab(hub: SyncHub) {
  const inbox: ServerMessage[] = [];
  const conn = hub.connect((m) => inbox.push(structuredClone(m)));
  let n = 0;
  const last = <T extends ServerMessage["type"]>(type: T) =>
    inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type).at(-1);
  /** Sends a request and waits for its answer. */
  const request = async (message: Record<string, unknown>) => {
    const requestId = `r${++n}`;
    conn.receive(JSON.stringify({ ...message, requestId }));
    for (let i = 0; i < 200; i++) {
      const answer = inbox.find(
        (m) => (m.type === "result" || m.type === "version") && m.requestId === requestId,
      );
      if (answer) return answer;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no answer to ${String(message.type)}`);
  };
  const open = async (deckId: string) => {
    conn.receive(JSON.stringify({ type: "open", deckId }));
    for (let i = 0; i < 200 && !last("versions"); i++) await new Promise((r) => setTimeout(r, 5));
  };
  return { conn, last, request, open };
}

describe("versions on the server (D93)", () => {
  it("saves, tells every tab, restores undoably, survives a reload and deletes", async () => {
    const workspace = await Workspace.open({ dir });
    const deck = await workspace.create({ title: "Pitch" });
    deck.apply({
      origin: "user",
      label: "First slide",
      ops: [
        {
          op: "slide.insert",
          index: 0,
          slide: createSlide({ id: "s1", children: [text("t", "Before")] }),
        },
      ],
    });
    const hub = new SyncHub(workspace);
    const a = tab(hub);
    const b = tab(hub);
    await a.open(deck.id);
    await b.open(deck.id);
    expect(a.last("versions")?.versions).toEqual([]);

    expect(
      await a.request({ type: "version.save", deckId: deck.id, name: "  Before AI " }),
    ).toMatchObject({ ok: true });
    const [saved] = b.last("versions")?.versions ?? [];
    expect(saved).toMatchObject({ name: "Before AI", slideCount: 1 });

    // An agent rewrites the deck.
    deck.apply({
      origin: "agent:claude",
      label: "Rewrite",
      ops: [
        { op: "slide.remove", id: "s1" },
        {
          op: "slide.insert",
          index: 0,
          slide: createSlide({ id: "s9", children: [text("x", "After")] }),
        },
      ],
    });
    const opened = await a.request({ type: "version.open", deckId: deck.id, versionId: saved?.id });
    expect(opened.type === "version" && opened.deck.slides.map((s) => s.id)).toEqual(["s1"]);

    expect(
      await a.request({ type: "version.restore", deckId: deck.id, versionId: saved?.id }),
    ).toMatchObject({ ok: true });
    expect(deck.deck.slides.map((s) => s.id)).toEqual(["s1"]);
    expect(deck.history.at(-1)).toMatchObject({ origin: "user", label: 'Restore "Before AI"' });
    deck.undo("user");
    expect(deck.deck.slides.map((s) => s.id)).toEqual(["s9"]); // the agent's work is back

    // In the file: a fresh server reads it back.
    await workspace.close();
    const again = await Workspace.open({ dir });
    const reopened = await again.get(deck.id);
    expect(reopened.savedVersions()).toEqual([saved]);
    expect(reopened.savedVersion(saved?.id ?? "")?.deck.slides[0]?.id).toBe("s1");

    const hub2 = new SyncHub(again);
    const c = tab(hub2);
    await c.open(deck.id);
    expect(
      await c.request({ type: "version.delete", deckId: deck.id, versionId: saved?.id }),
    ).toMatchObject({ ok: true });
    expect(c.last("versions")?.versions).toEqual([]);
    const gone = await c.request({
      type: "version.restore",
      deckId: deck.id,
      versionId: saved?.id,
    });
    expect(gone).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await again.close();
  });

  it("keeps the bytes of an image only a version uses, and restores it", async () => {
    const workspace = await Workspace.open({ dir });
    const deck = await workspace.create({ title: "Photos" });
    const id = await deck.storeAsset(PNG);
    const asset = { mime: "image/png", bytes: PNG.length };
    deck.apply({
      origin: "user",
      label: "Add photo",
      ops: [
        { op: "asset.add", id, asset },
        {
          op: "slide.insert",
          index: 0,
          slide: createSlide({
            id: "s1",
            children: [element("image", { asset: `asset:${id}` }, { id: "img" })],
          }),
        },
      ],
    });
    await workspace.saveVersion(deck.id, "With photo");
    deck.apply({
      origin: "user",
      label: "Remove photo",
      ops: [
        { op: "slide.remove", id: "s1" },
        { op: "asset.remove", id },
      ],
    });
    // Long after: the undo history no longer holds it, the version does.
    await workspace.flush();
    expect(deck.sweepAssets()).toEqual([]);
    expect(deck.bundle().assets.get(id)).toEqual(PNG);
    expect(deck.assetInfo(id)).toEqual(asset); // still served, for the version's preview

    await workspace.close();
    const again = await Workspace.open({ dir });
    const reopened = await again.get(deck.id);
    const [version] = reopened.savedVersions();
    expect(reopened.restoreVersion(version?.id ?? "", "user")).toMatchObject({ ok: true });
    expect(reopened.deck.assets[id]).toEqual(asset);
    expect(await sha256Hex(reopened.assetBytes(id) as Uint8Array)).toBe(id);
    await again.close();
  });

  it("refuses a nameless version and says when the deck already matches", async () => {
    const workspace = await Workspace.open({ dir });
    const deck = await workspace.create({ title: "Empty" });
    await expect(workspace.saveVersion(deck.id, "   ")).rejects.toThrow(/needs a name/);
    const info = await workspace.saveVersion(deck.id, "Empty");
    expect(deck.restoreVersion(info.id, "user")).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: 'The deck already matches "Empty"' },
    });
    await workspace.close();
  });
});
