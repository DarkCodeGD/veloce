/** Versions inside .veloce files (D93): saved, read back, and never fatal when broken. */
import {
  assetRef,
  createDeck,
  createSlide,
  type Deck,
  type DeckVersion,
  element,
  sha256Hex,
} from "@veloce/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { FormatError } from "../errors.js";
import { readVeloce } from "../read.js";
import { writeVeloce } from "../write.js";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const PHOTO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);

/** A deck with `logo`, optionally `photo` as well. */
async function deckWith(slideText: string, photo = false): Promise<Deck> {
  const logo = await sha256Hex(LOGO);
  const photoId = await sha256Hex(PHOTO);
  return {
    ...createDeck({ id: "deck", title: "Pitch" }),
    assets: {
      [logo]: { mime: "image/png", bytes: LOGO.length },
      ...(photo && { [photoId]: { mime: "image/png", bytes: PHOTO.length } }),
    },
    slides: [
      createSlide({
        id: "s1",
        children: [
          element("text", { content: slideText }, { id: "t" }),
          element("image", { asset: assetRef(logo) }, { id: "logo" }),
          ...(photo ? [element("image", { asset: assetRef(photoId) }, { id: "photo" })] : []),
        ],
      }),
    ],
  };
}

const version = (id: string, name: string, savedAt: string, deck: Deck): DeckVersion => ({
  id,
  name,
  savedAt,
  deck,
});

/** Today's deck (logo only) with an older version that also had a photo. */
async function file() {
  const deck = await deckWith("Now");
  const old = await deckWith("Before", true);
  const bytes = await writeVeloce(
    {
      deck,
      assets: new Map([
        [await sha256Hex(LOGO), LOGO],
        [await sha256Hex(PHOTO), PHOTO],
      ]),
      versions: [version("vr_aaaaaaaaaa", "Before AI", "2026-11-24T10:00:00.000Z", old)],
    },
    { now: NOW },
  );
  return { deck, old, bytes };
}

const rezip = (bytes: Uint8Array, mutate: (entries: Record<string, Uint8Array>) => void) => {
  const entries = unzipSync(bytes);
  mutate(entries);
  return zipSync(entries);
};

describe("versions in a .veloce file (D93)", () => {
  it("round-trips versions, sharing asset files with the deck", async () => {
    const { old, bytes } = await file();
    const names = Object.keys(unzipSync(bytes));
    expect(names).toContain("versions/vr_aaaaaaaaaa.json");
    expect(names.filter((n) => n.startsWith("assets/"))).toHaveLength(2); // logo once

    const read = await readVeloce(bytes);
    expect(read.warnings).toEqual([]);
    expect(read.versions).toEqual([
      version("vr_aaaaaaaaaa", "Before AI", "2026-11-24T10:00:00.000Z", old),
    ]);
    // The photo only the version uses is kept, for a restore.
    expect(read.assets.get(await sha256Hex(PHOTO))).toEqual(PHOTO);
  });

  it("reads versions oldest first", async () => {
    const deck = await deckWith("Now");
    const bytes = await writeVeloce({
      deck,
      assets: new Map([[await sha256Hex(LOGO), LOGO]]),
      versions: [
        version("vr_bbbbbbbbbb", "Second", "2026-11-24T11:00:00.000Z", deck),
        version("vr_aaaaaaaaaa", "First", "2026-11-24T09:00:00.000Z", deck),
      ],
    });
    expect((await readVeloce(bytes)).versions.map((v) => v.name)).toEqual(["First", "Second"]);
  });

  it("skips a broken version with a warning, and still opens the deck", async () => {
    const { bytes } = await file();
    const photo = await sha256Hex(PHOTO);
    const cases: Array<[(e: Record<string, Uint8Array>) => void, RegExp]> = [
      [(e) => (e["versions/vr_aaaaaaaaaa.json"] = strToU8("{oops")), /isn't valid JSON/],
      [(e) => delete e[`assets/${photo}.png`], /asset .* is missing/],
      [(e) => (e[`assets/${photo}.png`] = new Uint8Array([1, 2, 3])), /asset .* is damaged/],
      [
        (e) => {
          const raw = JSON.parse(strFromU8(e["versions/vr_aaaaaaaaaa.json"] as Uint8Array));
          raw.deck.slides = "nope";
          e["versions/vr_aaaaaaaaaa.json"] = strToU8(JSON.stringify(raw));
        },
        /its deck is invalid/,
      ],
      [
        (e) => {
          const raw = JSON.parse(strFromU8(e["versions/vr_aaaaaaaaaa.json"] as Uint8Array));
          raw.deck.formatVersion = 999;
          e["versions/vr_aaaaaaaaaa.json"] = strToU8(JSON.stringify(raw));
        },
        /only understands up to/,
      ],
    ];
    for (const [mutate, warning] of cases) {
      const read = await readVeloce(rezip(bytes, mutate));
      expect(read.versions).toEqual([]);
      expect(read.warnings.join("\n")).toMatch(warning);
      expect(read.deck.slides).toHaveLength(1);
    }
  });

  it("refuses to write a version with a bad ID, or bytes nobody registers", async () => {
    const deck = await deckWith("Now");
    const logo: [string, Uint8Array] = [await sha256Hex(LOGO), LOGO];
    await expect(
      writeVeloce({
        deck,
        assets: new Map([logo]),
        versions: [version("../evil", "x", "2026-11-24T10:00:00.000Z", deck)],
      }),
    ).rejects.toThrow(FormatError);
    await expect(
      writeVeloce({ deck, assets: new Map([logo, [await sha256Hex(PHOTO), PHOTO]]) }),
    ).rejects.toThrow(/isn't registered/);
  });
});
