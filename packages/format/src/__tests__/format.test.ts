import { readFileSync } from "node:fs";
import {
  assetRef,
  createDeck,
  createSlide,
  type Deck,
  deepEqual,
  element,
  FORMAT_VERSION,
  sha256Hex,
} from "@veloce/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DeckBundle } from "../bundle.js";
import { FormatError } from "../errors.js";
import { MIGRATIONS, migrateDocument } from "../migrations.js";
import { readVeloce } from "../read.js";
import { writeVeloce } from "../write.js";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

async function bundleWithAsset(): Promise<DeckBundle> {
  const id = await sha256Hex(PNG);
  const deck: Deck = {
    ...createDeck({ id: "deck", title: "Pitch", authors: ["Ada"] }),
    assets: { [id]: { mime: "image/png", bytes: PNG.length, name: "logo.png" } },
    slides: [
      createSlide({
        id: "s1",
        rootId: "s1-root",
        children: [
          element("text", { content: "Hello" }, { id: "title" }),
          element("image", { asset: assetRef(id), alt: "Logo" }, { id: "logo" }),
        ],
      }),
    ],
  };
  return {
    deck,
    assets: new Map([[id, PNG]]),
    plugins: { "veloce.text": "1.0.0" },
    preview: PNG,
    fallbacks: new Map([["logo", PNG]]),
  };
}

/** Unzip, let the test tamper with the entries, zip again. */
function rezip(
  file: Uint8Array,
  mutate: (entries: Record<string, Uint8Array>) => void,
): Uint8Array {
  const entries = unzipSync(file);
  mutate(entries);
  return zipSync(entries);
}

async function readError(
  file: Uint8Array,
  options?: Parameters<typeof readVeloce>[1],
): Promise<FormatError> {
  try {
    await readVeloce(file, options);
  } catch (error) {
    if (error instanceof FormatError) return error;
    throw error;
  }
  throw new Error("expected readVeloce to fail");
}

async function writeError(bundle: DeckBundle): Promise<FormatError> {
  try {
    await writeVeloce(bundle);
  } catch (error) {
    if (error instanceof FormatError) return error;
    throw error;
  }
  throw new Error("expected writeVeloce to fail");
}

describe("write → read round trip", () => {
  it("restores the exact deck, assets and extras", async () => {
    const bundle = await bundleWithAsset();
    const file = await writeVeloce(bundle, {
      now: NOW,
      generator: { name: "test", version: "0.0.0" },
    });
    const read = await readVeloce(file);

    expect(deepEqual(read.deck, bundle.deck)).toBe(true);
    expect(read.assets).toEqual(bundle.assets);
    expect(read.plugins).toEqual(bundle.plugins);
    expect(read.preview).toEqual(PNG);
    expect(read.fallbacks.get("logo")).toEqual(PNG);
    expect(read.manifest).toMatchObject({
      format: "veloce",
      formatVersion: FORMAT_VERSION,
      title: "Pitch",
      createdAt: NOW.toISOString(),
      generator: { name: "test", version: "0.0.0" },
    });
    expect(read.warnings).toEqual([]);
    expect(read.migratedFrom).toBeUndefined();
  });

  it("lays the zip out as documented, manifest first", async () => {
    const file = await writeVeloce(await bundleWithAsset(), { now: NOW });
    const names = Object.keys(unzipSync(file));
    expect(names[0]).toBe("manifest.json");
    expect(names).toEqual(
      expect.arrayContaining([
        "document.json",
        "theme.json",
        "plugins.lock.json",
        "preview.png",
        "fallbacks/logo.png",
      ]),
    );
    expect(names.some((n) => /^assets\/[0-9a-f]{64}\.png$/.test(n))).toBe(true);
    // The theme lives in its own file, not inside document.json.
    expect(
      JSON.parse(strFromU8(unzipSync(file)["document.json"] as Uint8Array)).theme,
    ).toBeUndefined();
  });

  it("is reproducible: same input + same timestamp → identical bytes", async () => {
    const bundle = await bundleWithAsset();
    expect(await writeVeloce(bundle, { now: NOW })).toEqual(
      await writeVeloce(bundle, { now: NOW }),
    );
  });
});

describe("writing refuses inconsistent input", () => {
  it("missing, mismatched or unregistered asset bytes", async () => {
    const bundle = await bundleWithAsset();
    expect((await writeError({ ...bundle, assets: new Map() })).message).toMatch(
      /No bytes provided for asset "logo.png"/,
    );
    const [id] = bundle.assets.keys();
    const wrong = await writeError({
      ...bundle,
      assets: new Map([[id as string, new Uint8Array([9])]]),
    });
    expect(wrong.message).toMatch(/don't match its SHA-256/);
    const extra = await writeError({
      ...bundle,
      assets: new Map([...bundle.assets, ["b".repeat(64), PNG]]),
    });
    expect(extra.message).toMatch(/isn't registered/);
  });

  it("an invalid deck or an unsafe fallback key", async () => {
    const bundle = await bundleWithAsset();
    const invalid = await writeError({ ...bundle, deck: { ...bundle.deck, meta: { title: "" } } });
    expect(invalid.code).toBe("INVALID_DOCUMENT");
    const unsafe = await writeError({ ...bundle, fallbacks: new Map([["../evil", PNG]]) });
    expect(unsafe.code).toBe("INCONSISTENT");
  });
});

describe("reading untrusted files", () => {
  it("rejects things that aren't .veloce files", async () => {
    expect((await readError(new Uint8Array([1, 2, 3]))).code).toBe("NOT_VELOCE");
    expect((await readError(zipSync({ "hello.txt": strToU8("hi") }))).code).toBe("NOT_VELOCE");
    const notOurs = zipSync({ "manifest.json": strToU8('{"format":"other"}') });
    expect((await readError(notOurs)).code).toBe("NOT_VELOCE");
  });

  it("blocks path traversal and absolute paths", async () => {
    const good = await writeVeloce(await bundleWithAsset(), { now: NOW });
    for (const evil of [
      "../../etc/passwd",
      "/abs/path",
      "assets/../../x",
      "C:/windows/x",
      "a\\b",
    ]) {
      const file = rezip(good, (e) => {
        e[evil] = strToU8("pwned");
      });
      const error = await readError(file);
      expect(error.code, evil).toBe("UNSAFE");
    }
  });

  it("enforces entry-count and size limits (zip bomb defense)", async () => {
    const good = await writeVeloce(await bundleWithAsset(), { now: NOW });
    expect((await readError(good, { limits: { maxEntries: 3 } })).message).toMatch(
      /too many entries/,
    );
    expect((await readError(good, { limits: { maxJsonBytes: 10 } })).message).toMatch(/too large/);
    expect((await readError(good, { limits: { maxTotalBytes: 100 } })).code).toBe("UNSAFE");
  });

  it("detects tampered or missing assets", async () => {
    const good = await writeVeloce(await bundleWithAsset(), { now: NOW });
    const assetPath = (e: Record<string, Uint8Array>) =>
      Object.keys(e).find((n) => n.startsWith("assets/")) as string;
    const tampered = rezip(good, (e) => {
      e[assetPath(e)] = new Uint8Array([6, 6, 6]);
    });
    expect((await readError(tampered)).message).toMatch(/"logo.png" .* is damaged/);
    const missing = rezip(good, (e) => {
      delete e[assetPath(e)];
    });
    expect((await readError(missing)).message).toMatch(/is missing from the file/);
  });

  it("refuses files from a newer Veloce with an actionable message", async () => {
    const good = await writeVeloce(await bundleWithAsset(), { now: NOW });
    const future = rezip(good, (e) => {
      for (const name of ["manifest.json", "document.json"]) {
        const json = JSON.parse(strFromU8(e[name] as Uint8Array));
        e[name] = strToU8(JSON.stringify({ ...json, formatVersion: FORMAT_VERSION + 1 }));
      }
    });
    const error = await readError(future);
    expect(error.code).toBe("TOO_NEW");
    expect(error.message).toMatch(/Update Veloce/);
  });

  it("reports invalid documents with their validation issues", async () => {
    const good = await writeVeloce(await bundleWithAsset(), { now: NOW });
    const broken = rezip(good, (e) => {
      const doc = JSON.parse(strFromU8(e["document.json"] as Uint8Array));
      doc.slides[0].root.children.push({ ...doc.slides[0].root.children[0] }); // duplicate ID
      e["document.json"] = strToU8(JSON.stringify(doc));
    });
    const error = await readError(broken);
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.issues[0]?.message).toBe('Duplicate ID "title"');
  });

  it("skips unknown files and bad optional parts with warnings instead of failing", async () => {
    const good = await writeVeloce(await bundleWithAsset(), { now: NOW });
    const extra = rezip(good, (e) => {
      e["notes/readme.txt"] = strToU8("hi");
      e["plugins.lock.json"] = strToU8('{"x": 5}');
    });
    const read = await readVeloce(extra);
    expect(read.warnings).toEqual([
      'Ignored unknown file "notes/readme.txt"',
      "Ignored plugins.lock.json: it isn't valid",
    ]);
    expect(read.plugins).toEqual({});
  });

  it("passes plugin validation through: unknown element types become warnings", async () => {
    const file = await writeVeloce(await bundleWithAsset(), { now: NOW });
    const read = await readVeloce(file, {
      context: {
        validateElement: (type) =>
          type === "image"
            ? { ok: false, reason: "unknown-type", message: "no image plugin" }
            : { ok: true },
      },
    });
    expect(read.warnings).toEqual(['Element "logo" (image): no image plugin']);
  });
});

describe("migrations", () => {
  const migrations = {
    1: (doc: Record<string, unknown>) => ({ ...doc, renamed: doc.old, old: undefined }),
    2: (doc: Record<string, unknown>) => ({ ...doc, added: true }),
  };

  it("chains migrations and stamps the new version", () => {
    expect(migrateDocument({ formatVersion: 1, old: "x" }, 1, 3, migrations)).toEqual({
      formatVersion: 3,
      renamed: "x",
      old: undefined,
      added: true,
    });
  });

  it("opens a v1 file with the lead style added, from its own body style (v2, D98)", async () => {
    const fixture = (name: string) =>
      readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    const good = await writeVeloce(await bundleWithAsset(), { now: NOW });
    const v1 = rezip(good, (e) => {
      const manifest = JSON.parse(strFromU8(e["manifest.json"] as Uint8Array));
      e["manifest.json"] = strToU8(JSON.stringify({ ...manifest, formatVersion: 1 }));
      e["document.json"] = strToU8(fixture("v1-document.json"));
      e["theme.json"] = strToU8(fixture("v1-theme.json"));
      for (const name of Object.keys(e)) if (name.startsWith("assets/")) delete e[name];
    });
    const read = await readVeloce(v1);
    expect(read.migratedFrom).toBe(1);
    expect(read.deck.formatVersion).toBe(FORMAT_VERSION);
    const text = read.deck.theme.text;
    // Paper's body: Lora (the body font), 32px at line height 1.5. Lead: 48px, the rest alike.
    expect(text.lead).toEqual({ font: "body", size: 48, weight: 400, lineHeight: 1.5 });
    expect(Object.keys(text).indexOf("lead")).toBe(Object.keys(text).indexOf("body") - 1);
  });

  it("keeps a theme's own lead, and leaves themes without a body style alone", () => {
    const own = { font: "heading", size: 50 };
    const doc = (text: Record<string, unknown>) => ({ formatVersion: 1, theme: { text } });
    expect(MIGRATIONS[1]?.(doc({ lead: own, body: { size: 32 } }))).toEqual(
      doc({ lead: own, body: { size: 32 } }),
    );
    expect(MIGRATIONS[1]?.(doc({ h1: { size: 80 } }))).toEqual(doc({ h1: { size: 80 } }));
    expect(MIGRATIONS[1]?.(doc({ body: { size: 30, weight: 300 } }))).toEqual(
      doc({ lead: { size: 45, weight: 300 }, body: { size: 30, weight: 300 } }),
    );
  });

  it("fails loudly on gaps and on newer documents", () => {
    expect(() => migrateDocument({}, 1, 4, migrations)).toThrow(
      /Missing migration from format version 3/,
    );
    expect(() => migrateDocument({}, 5, 3, migrations)).toThrow(FormatError);
  });
});
