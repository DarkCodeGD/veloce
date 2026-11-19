import { brotliCompressSync, deflateSync } from "node:zlib";
import { MAX_ASSET_BYTES } from "@veloce/core";
import { describe, expect, it } from "vitest";
import { inspectAsset } from "./asset-import.js";

// ── Fixture builders ────────────────────────────────────────────────────────────────────

const bytes = (...parts: Array<number[] | Uint8Array | string>) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : [...p])),
  );
const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >> 8) & 255];

interface FontSpec {
  /** Windows name records: [nameID, text]. */
  names?: Array<[number, string]>;
  weight?: number;
  italic?: boolean;
  /** Variable weight axis. */
  wght?: [number, number];
  /** OS/2 PANOSE bytes (family kind, serif style, weight, proportion…). */
  panose?: number[];
  /** OS/2 sFamilyClass's class (high byte). */
  familyClass?: number;
}

/** The `name`, `OS/2` (and `fvar`) tables of a font, as raw bytes. */
function fontTables({
  names = [],
  weight = 400,
  italic = false,
  wght,
  panose,
  familyClass,
}: FontSpec) {
  const tables = new Map<string, Uint8Array>();
  const encoded = names.map(([id, text]) => ({
    id,
    data: [...text].flatMap((c) => u16(c.charCodeAt(0))),
  }));
  let offset = 0;
  const records = encoded.flatMap(({ id, data }) => {
    const record = [
      ...u16(3),
      ...u16(1),
      ...u16(0x409),
      ...u16(id),
      ...u16(data.length),
      ...u16(offset),
    ];
    offset += data.length;
    return record;
  });
  const header = [...u16(0), ...u16(encoded.length), ...u16(6 + records.length)];
  tables.set(
    "name",
    bytes(
      header,
      records,
      encoded.flatMap((e) => e.data),
    ),
  );
  const os2 = new Array(96).fill(0);
  os2.splice(4, 2, ...u16(weight));
  os2.splice(62, 2, ...u16(italic ? 1 : 0x40));
  if (familyClass !== undefined) os2[30] = familyClass;
  if (panose) os2.splice(32, panose.length, ...panose);
  tables.set("OS/2", Uint8Array.from(os2));
  if (wght) {
    const fixed = (n: number) => u32(n * 65536);
    tables.set(
      "fvar",
      bytes(
        u16(1),
        u16(0),
        u16(16),
        u16(2),
        u16(1),
        u16(20),
        u16(0),
        u16(0),
        "wght",
        fixed(wght[0]),
        fixed(400),
        fixed(wght[1]),
        u16(0),
        u16(256),
      ),
    );
  }
  return tables;
}

function ttf(spec: FontSpec, signature: number[] = [0, 1, 0, 0]): Uint8Array {
  const tables = [...fontTables(spec)];
  let offset = 12 + tables.length * 16;
  const directory = tables.flatMap(([tag, data]) => {
    const entry = [
      ...[...tag].map((c) => c.charCodeAt(0)),
      ...u32(0),
      ...u32(offset),
      ...u32(data.length),
    ];
    offset += data.length;
    return entry;
  });
  return bytes(
    signature,
    u16(tables.length),
    u16(0),
    u16(0),
    u16(0),
    directory,
    ...tables.map(([, d]) => d),
  );
}

function woff(spec: FontSpec): Uint8Array {
  const tables = [...fontTables(spec)].map(([tag, data]) => ({
    tag,
    data,
    packed: deflateSync(data),
  }));
  let offset = 44 + tables.length * 20;
  const directory = tables.flatMap(({ tag, data, packed }) => {
    const entry = [
      ...[...tag].map((c) => c.charCodeAt(0)),
      ...u32(offset),
      ...u32(packed.length),
      ...u32(data.length),
      ...u32(0),
    ];
    offset += packed.length;
    return entry;
  });
  const header = bytes("wOFF", [0, 1, 0, 0], u32(0), u16(tables.length), new Array(30).fill(0));
  return bytes(header, directory, ...tables.map((t) => t.packed));
}

const WOFF2_INDEX: Record<string, number> = { name: 5, "OS/2": 6, fvar: 47 };

function woff2(spec: FontSpec, { totalSfnt }: { totalSfnt?: number } = {}): Uint8Array {
  const tables = [...fontTables(spec)];
  const base128 = (n: number) => {
    const out = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  const directory = tables.flatMap(([tag, data]) => [
    WOFF2_INDEX[tag] ?? 63,
    ...base128(data.length),
  ]);
  const stream = brotliCompressSync(bytes(...tables.map(([, d]) => d)));
  const size = totalSfnt ?? tables.reduce((n, [, d]) => n + d.length, 12);
  const header = bytes(
    "wOF2",
    [0, 1, 0, 0],
    u32(0),
    u16(tables.length),
    u16(0),
    u32(size),
    u32(stream.length),
    new Array(24).fill(0),
  );
  return bytes(header, directory, stream);
}

const ok = (result: ReturnType<typeof inspectAsset>) => {
  if (!result.ok) throw new Error(result.message);
  return result.info;
};

// ── Tests ───────────────────────────────────────────────────────────────────────────────

describe("inspectAsset: images", () => {
  it("reads PNG, JPEG, GIF and WebP sizes from their headers", () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      u32(13),
      "IHDR",
      u32(1920),
      u32(1080),
      [8, 6, 0, 0, 0],
    );
    expect(ok(inspectAsset(png, "photo.png"))).toEqual({
      mime: "image/png",
      bytes: png.length,
      name: "photo.png",
      width: 1920,
      height: 1080,
    });
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0],
      u16(16),
      "JFIF",
      new Array(10).fill(0),
      [0xff, 0xc4],
      u16(4),
      [0, 0],
      [0xff, 0xc2],
      u16(17),
      [8],
      u16(600),
      u16(800),
      new Array(12).fill(0),
    );
    expect(ok(inspectAsset(jpeg))).toMatchObject({ mime: "image/jpeg", width: 800, height: 600 });
    const gif = bytes("GIF89a", u16le(64), u16le(32), new Array(8).fill(0));
    expect(ok(inspectAsset(gif))).toMatchObject({ mime: "image/gif", width: 64, height: 32 });
    const vp8x = bytes(
      "RIFF",
      u32(0),
      "WEBP",
      "VP8X",
      u32(10),
      [0, 0, 0, 0],
      [0xff, 0x04, 0],
      [0x7f, 0x02, 0],
    );
    expect(ok(inspectAsset(vp8x))).toMatchObject({ mime: "image/webp", width: 1280, height: 640 });
    const bits = 99 | (49 << 14); // 100 x 50
    const vp8l = bytes(
      "RIFF",
      u32(0),
      "WEBP",
      "VP8L",
      u32(5),
      [0x2f],
      [bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, bits >>> 24],
    );
    expect(ok(inspectAsset(vp8l))).toMatchObject({ mime: "image/webp", width: 100, height: 50 });
  });

  it("recognizes AVIF and finds its size", () => {
    const avif = bytes(
      u32(24),
      "ftyp",
      "avif",
      u32(0),
      "mif1",
      "miaf",
      u32(20),
      "ispe",
      u32(0),
      u32(4000),
      u32(3000),
    );
    expect(ok(inspectAsset(avif))).toMatchObject({ mime: "image/avif", width: 4000, height: 3000 });
  });

  it("recognizes SVG by its root element and sizes it from width/height or the viewBox", () => {
    const svg = (text: string) => ok(inspectAsset(new TextEncoder().encode(text)));
    expect(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"/>')).toMatchObject({
      mime: "image/svg+xml",
      width: 120,
      height: 40,
    });
    expect(
      svg(
        '\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg width="300px" viewBox="0 0 120 40"></svg>',
      ),
    ).toMatchObject({ width: 300, height: 100 });
    // A size we can't tell (percentages) is simply left out.
    expect(svg('<svg width="100%" height="100%"></svg>')).toEqual({
      mime: "image/svg+xml",
      bytes: 38,
    });
    expect(inspectAsset(new TextEncoder().encode("<html><svg/></html>")).ok).toBe(false);
  });

  it("refuses what it can't use, saying what it accepts", () => {
    const text = inspectAsset(new TextEncoder().encode("hello"));
    expect(text).toEqual({ ok: false, message: expect.stringContaining("PNG, JPEG") });
    expect(inspectAsset(new Uint8Array())).toEqual({ ok: false, message: "The file is empty" });
    const huge = new Uint8Array(MAX_ASSET_BYTES + 1);
    expect(inspectAsset(huge)).toEqual({ ok: false, message: expect.stringContaining("at most") });
  });

  it("keeps only the file's own name", () => {
    const gif = bytes("GIF89a", u16le(1), u16le(1));
    expect(ok(inspectAsset(gif, "C:\\Users\\me\\Pictures\\cat.gif")).name).toBe("cat.gif");
    expect(ok(inspectAsset(gif, "../../etc/passwd")).name).toBe("passwd");
  });
});

describe("inspectAsset: fonts", () => {
  const acme: FontSpec = {
    names: [
      [1, "Acme Sans Bold"],
      [16, "Acme Sans"],
    ],
    weight: 700,
  };

  it("reads family, weight and style from TTF, OTF, WOFF and WOFF2", () => {
    const expected = { family: "Acme Sans", weight: 700 };
    expect(ok(inspectAsset(ttf(acme))).font).toEqual(expected);
    expect(ok(inspectAsset(ttf(acme), "a.ttf")).mime).toBe("font/ttf");
    expect(ok(inspectAsset(ttf(acme, [0x4f, 0x54, 0x54, 0x4f])))).toMatchObject({
      mime: "font/otf",
      font: expected,
    });
    expect(ok(inspectAsset(woff(acme)))).toMatchObject({ mime: "font/woff", font: expected });
    expect(ok(inspectAsset(woff2(acme)))).toMatchObject({ mime: "font/woff2", font: expected });
  });

  it("tells serif, sans and monospace faces apart (for the fallback in font stacks)", () => {
    const category = (spec: Partial<FontSpec>) =>
      ok(inspectAsset(ttf({ names: [[1, "Face"]], ...spec }))).font?.category;
    expect(category({ panose: [2, 4, 5, 3, 5, 4, 6, 3, 2, 4] })).toBe("serif"); // Caladea
    expect(category({ panose: [2, 11, 7, 4, 2, 2, 2, 2, 2, 4] })).toBe("sans-serif"); // FreeSans
    expect(category({ panose: [2, 0, 8, 9, 3, 0, 0, 0, 0, 4], familyClass: 8 })).toBe("monospace");
    expect(category({ familyClass: 1 })).toBe("serif"); // no PANOSE: the IBM class
    expect(category({})).toBeUndefined();
  });

  it("prefers the typographic family, and reads italics and variable weight ranges", () => {
    const italicVariable: FontSpec = {
      names: [[1, "Brand Serif Italic"]],
      italic: true,
      wght: [200, 800],
    };
    expect(ok(inspectAsset(woff2(italicVariable))).font).toEqual({
      family: "Brand Serif", // the italic face of the "Brand Serif" family
      weight: [200, 800],
      style: "italic",
    });
  });

  it("drops the default instance's style from a variable font's legacy family name", () => {
    const variable = (family: string) =>
      ok(inspectAsset(woff2({ names: [[1, family]], wght: [200, 800] }))).font?.family;
    expect(variable("Manrope ExtraLight")).toBe("Manrope");
    expect(variable("Space Grotesk Light")).toBe("Space Grotesk");
    // A static font's name is what it is: "Archivo Black" is a real family.
    expect(ok(inspectAsset(ttf({ names: [[1, "Archivo Black"]] }))).font?.family).toBe(
      "Archivo Black",
    );
  });

  it("cleans family names so they're safe in a CSS font stack", () => {
    const evil = ttf({ names: [[1, 'Evil", serif; } body { x: "\\\u0007']] });
    const family = ok(inspectAsset(evil)).font?.family;
    expect(family).toBe("Evil, serif; } body { x:");
  });

  it("falls back to the file name, dropping only style words", () => {
    const nameless = ttf({ names: [] });
    expect(ok(inspectAsset(nameless, "Acme Sans-SemiBoldItalic.ttf")).font?.family).toBe(
      "Acme Sans",
    );
    expect(ok(inspectAsset(nameless, "Brand_Display[wght].ttf")).font?.family).toBe(
      "Brand_Display",
    );
    expect(ok(inspectAsset(nameless, "Bold.ttf")).font?.family).toBe("Bold");
    expect(ok(inspectAsset(nameless)).font).toBeUndefined();
  });

  it("refuses damaged fonts, collections and decompression bombs", () => {
    const truncated = woff2(acme).subarray(0, 60);
    expect(inspectAsset(truncated)).toEqual({
      ok: false,
      message: expect.stringContaining("damaged"),
    });
    expect(inspectAsset(bytes("ttcf", new Array(20).fill(0)))).toEqual({
      ok: false,
      message: expect.stringContaining("collections"),
    });
    const bomb = woff2(acme, { totalSfnt: 2 ** 31 });
    expect(inspectAsset(bomb).ok).toBe(false);
  });
});
