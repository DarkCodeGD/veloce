import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type ServerMessage } from "@veloce/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStore } from "./settings-store.js";
import { SyncHub } from "./sync-hub.js";
import { Workspace } from "./workspace.js";

let dir: string;
const logs: string[] = [];
const log = (m: string) => logs.push(m);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "veloce-settings-"));
  logs.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8")) as unknown;

describe("SettingsStore (D91)", () => {
  it("starts from the defaults and creates the file (and its folder) on the first change", async () => {
    const file = join(dir, "config", "veloce", "settings.json");
    const store = await SettingsStore.open(file, log);
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    store.update({ editing: { snapping: false } });
    store.update({ editing: { nudge: 2 } }); // while the first write runs: written right after
    await store.flush();
    expect(await readJson(file)).toEqual({
      ...DEFAULT_SETTINGS,
      editing: { ...DEFAULT_SETTINGS.editing, snapping: false, nudge: 2 },
    });
    const again = await SettingsStore.open(file, log);
    expect(again.settings.editing.nudge).toBe(2);
    expect(logs).toEqual([]);
  });

  it("refuses an invalid change without changing anything", async () => {
    const store = await SettingsStore.open(null);
    const heard = vi.fn();
    store.subscribe(heard);
    expect(() => store.update({ editing: { nudge: -1 } })).toThrow(/Invalid settings: .*nudge/);
    expect(() => store.update({ theme: "light" })).toThrow(/Invalid settings/);
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    store.update({ editing: { nudge: 1 } }); // same as now: nothing to tell
    expect(heard).not.toHaveBeenCalled();
  });

  it("keeps a hand-edited file's valid values, and a copy of one that isn't JSON", async () => {
    const file = join(dir, "settings.json");
    await writeFile(file, JSON.stringify({ ai: { port: 5000, followAI: "no" } }));
    expect((await SettingsStore.open(file, log)).settings.ai).toEqual({
      port: 5000,
      followAI: true,
    });

    await writeFile(file, "{ ai: { port: 5000 }"); // a typo
    const store = await SettingsStore.open(file, log);
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(await readFile(`${file}.broken`, "utf8")).toBe("{ ai: { port: 5000 }");
    expect(logs.at(-1)).toMatch(/isn't valid JSON.*settings\.json\.broken/);
  });

  it("gives every tab the settings, and every tab hears a change", async () => {
    const workspace = await Workspace.open({ dir: join(dir, "decks") });
    const store = await SettingsStore.open(null);
    const hub = new SyncHub(workspace, {
      settings: { store, running: () => ({ decksFolder: workspace.dir, port: 4321 }) },
    });
    const tab = () => {
      const inbox: ServerMessage[] = [];
      const conn = hub.connect((m) => inbox.push(structuredClone(m)));
      const last = <T extends ServerMessage["type"]>(type: T) =>
        inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type).at(-1);
      return { conn, last };
    };
    const a = tab();
    const b = tab();
    expect(a.last("settings")).toEqual({
      type: "settings",
      settings: DEFAULT_SETTINGS,
      file: null,
      running: { decksFolder: workspace.dir, port: 4321 },
    });
    a.conn.receive(
      JSON.stringify({
        type: "settings.update",
        requestId: "r1",
        patch: { ai: { followAI: false } },
      }),
    );
    await vi.waitFor(() => expect(a.last("result")).toMatchObject({ requestId: "r1", ok: true }));
    expect(b.last("settings")?.settings.ai.followAI).toBe(false);
    // A bad value never reaches the store.
    a.conn.receive(
      JSON.stringify({ type: "settings.update", requestId: "r2", patch: { ai: { port: 80 } } }),
    );
    await vi.waitFor(() => expect(a.last("error")?.message).toMatch(/Invalid message.*port/));
    expect(store.settings.ai.port).toBe(4321);
    a.conn.close();
    b.conn.close();
    await workspace.close();
  });

  it("changes the autosave pause and undo depth of a running workspace", async () => {
    const workspace = await Workspace.open({ dir: join(dir, "decks"), autosaveDelayMs: 5 });
    const deck = await workspace.create({ title: "Undo" });
    workspace.configure({ undoSteps: 2 });
    for (const title of ["A", "B", "C"]) {
      deck.apply({
        origin: "user",
        label: title,
        ops: [{ op: "deck.updateMeta", set: { title } }],
      });
    }
    expect(deck.undoLabels("user")).toEqual(["B", "C"]);
    await workspace.close();
  });
});
