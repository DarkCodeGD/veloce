/** Components in .veloce files (D94): they live in document.json and keep their images. */
import { assetRef, type Component, createDeck, element, frame, sha256Hex } from "@veloce/core";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readVeloce } from "../read.js";
import { writeVeloce } from "../write.js";

const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7, 8]);

describe("components in a .veloce file (D94)", () => {
  it("round-trip in document.json, with the assets only a component uses", async () => {
    const logo = await sha256Hex(LOGO);
    const badge: Component = {
      description: "Logo and a label",
      params: { label: { targets: ["badge-label.props.content"] } },
      node: frame({
        id: "badge",
        layout: { mode: "stack", direction: "row" },
        children: [
          element("image", { asset: assetRef(logo) }, { id: "badge-logo" }),
          element("text", { content: "New" }, { id: "badge-label" }),
        ],
      }),
    };
    const deck = {
      ...createDeck({ id: "deck", title: "Components" }),
      assets: { [logo]: { mime: "image/png", bytes: LOGO.length } },
      components: { Badge: badge },
    };
    const bytes = await writeVeloce({ deck, assets: new Map([[logo, LOGO]]) });
    const entries = unzipSync(bytes);
    expect(JSON.parse(strFromU8(entries["document.json"] as Uint8Array)).components).toEqual({
      Badge: badge,
    });
    expect(Object.keys(entries).some((n) => n.startsWith(`assets/${logo}`))).toBe(true);

    const read = await readVeloce(bytes);
    expect(read.deck.components).toEqual({ Badge: badge });
    expect(read.assets.get(logo)).toEqual(LOGO);
  });
});
