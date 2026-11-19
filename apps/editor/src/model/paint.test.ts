import {
  createDeck,
  createSlide,
  DEFAULT_THEME,
  type Deck,
  frame,
  type LinearGradient,
  PaintSchema,
} from "@veloce/core";
import { describe, expect, it } from "vitest";
import type { Imported } from "./asset-insert.js";
import {
  addStop,
  colorAt,
  convertPaint,
  flipStops,
  imagePaint,
  isGradient,
  MAX_STOPS,
  moveStop,
  paintCss,
  paintKind,
  paintLabel,
  recolorStop,
  removeStop,
  stopBarCss,
  withPaintAssets,
} from "./paint.js";

const theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: "#ff0000" } };
const linear = (stops: Array<[number, string]>): LinearGradient => ({
  type: "linear-gradient",
  angle: 90,
  stops: stops.map(([offset, color]) => ({ offset, color })),
});
const valid = (paint: unknown) => PaintSchema.safeParse(paint).success;

describe("paint kinds and switching tabs (D66)", () => {
  it("knows which tab a paint is on", () => {
    expect(paintKind(undefined)).toBe("solid");
    expect(paintKind("transparent")).toBe("solid");
    expect(paintKind("$color.primary/30")).toBe("solid");
    expect(
      paintKind(
        linear([
          [0, "#000"],
          [1, "#fff"],
        ]),
      ),
    ).toBe("linear");
    expect(paintKind({ type: "conic-gradient", stops: [] })).toBe("conic");
    expect(paintKind({ type: "image", asset: "asset:x" })).toBe("image");
    expect(isGradient({ type: "radial-gradient", stops: [] })).toBe(true);
    expect(isGradient({ type: "image" })).toBe(false);
    expect(paintLabel({ type: "conic-gradient", stops: [] })).toBe("Angular gradient");
    expect(paintLabel({ type: "image" })).toBe("Image");
  });

  it("turns a color into a gradient fading it out, a theme color staying a theme color", () => {
    const g = convertPaint("$color.primary/80", "linear", "$color.accent");
    expect(g).toEqual({
      type: "linear-gradient",
      angle: 180,
      stops: [
        { offset: 0, color: "$color.primary/80" },
        { offset: 1, color: "$color.primary/0" },
      ],
    });
    expect(valid(g)).toBe(true);
    // A hex fades through its alpha byte; nothing set starts from the fallback.
    expect(convertPaint("#336699", "radial", "$color.accent")).toMatchObject({
      center: { x: 0.5, y: 0.5 },
      stops: [{ color: "#336699" }, { color: "#33669900" }],
    });
    expect(convertPaint(undefined, "conic", "$color.accent")).toMatchObject({
      type: "conic-gradient",
      angle: 0,
      stops: [{ color: "$color.accent" }, { color: "$color.accent/0" }],
    });
  });

  it("keeps stops, angle and center between gradient kinds; a gradient's first stop as a color", () => {
    const conic = {
      type: "conic-gradient" as const,
      angle: 45,
      center: { x: 0.2, y: 0.3 },
      stops: [
        { offset: 0, color: "#000" },
        { offset: 1, color: "#fff" },
      ],
    };
    expect(convertPaint(conic, "linear", "x")).toEqual({
      type: "linear-gradient",
      angle: 45,
      stops: conic.stops,
    });
    expect(convertPaint(conic, "radial", "x")).toEqual({
      type: "radial-gradient",
      center: { x: 0.2, y: 0.3 },
      stops: conic.stops,
    });
    expect(convertPaint(conic, "solid", "x")).toBe("#000");
    expect(convertPaint(conic, "conic", "x")).toBe(conic); // same tab: unchanged
    // An image has no color to keep.
    expect(convertPaint({ type: "image", asset: "asset:x" }, "solid", "$color.accent")).toBe(
      "$color.accent",
    );
  });

  it("an image fill keeps the current image's fit", () => {
    const id = "a".repeat(64);
    expect(imagePaint(id, "#fff")).toEqual({ type: "image", asset: `asset:${id}`, fit: "cover" });
    expect(imagePaint(id, { type: "image", asset: "asset:b", fit: "tile" }).fit).toBe("tile");
  });
});

describe("gradient stops", () => {
  const g = linear([
    [0, "#000000"],
    [1, "#ffffff"],
  ]);

  it("moves a stop past another, keeping them sorted and following the moved one", () => {
    const three = linear([
      [0, "#000"],
      [0.5, "#888"],
      [1, "#fff"],
    ]);
    const moved = moveStop(three, 0, 0.75);
    expect(moved.gradient.stops.map((s) => [s.offset, s.color])).toEqual([
      [0.5, "#888"],
      [0.75, "#000"],
      [1, "#fff"],
    ]);
    expect(moved.index).toBe(1);
    // Clamped to the bar, and rounded (no floating-point noise in the file).
    expect(moveStop(g, 1, 1.4).gradient.stops[1]?.offset).toBe(1);
    expect(moveStop(g, 1, 0.1 + 0.2).gradient.stops[1]?.offset).toBe(0.3);
  });

  it("adds a stop colored like the gradient is there", () => {
    const added = addStop(g, 0.5, theme);
    expect(added?.index).toBe(1);
    expect(added?.gradient.stops[1]).toEqual({ offset: 0.5, color: "#808080" });
    // Past the last stop: that stop's color.
    expect(
      colorAt(
        linear([
          [0.2, "#000"],
          [0.6, "#fff"],
        ]).stops,
        0.9,
        theme,
      ),
    ).toBe("#fff");
    expect(
      colorAt(
        linear([
          [0.2, "#000"],
          [0.6, "#fff"],
        ]).stops,
        0.1,
        theme,
      ),
    ).toBe("#000");
  });

  it("between two stops of one theme color, the new stop is that color at the opacity between", () => {
    const fade = linear([
      [0, "$color.primary"],
      [1, "$color.primary/0"],
    ]);
    expect(colorAt(fade.stops, 0.25, theme)).toBe("$color.primary/75");
    // Two different theme colors mix to a hex (resolved against the theme).
    const two = linear([
      [0, "$color.primary"],
      [1, "#0000ff80"],
    ]);
    expect(colorAt(two.stops, 0.5, theme)).toBe("#800080bf");
  });

  it("stops at 16, and never drops below two stops", () => {
    let full: LinearGradient = g;
    for (let i = 2; i < MAX_STOPS; i++) full = addStop(full, i / 20, theme)?.gradient ?? full;
    expect(full.stops).toHaveLength(MAX_STOPS);
    expect(addStop(full, 0.5, theme)).toBeNull();
    expect(removeStop(g, 0)).toBeNull();
    expect(removeStop(full, 3)?.stops).toHaveLength(MAX_STOPS - 1);
  });

  it("recolors and flips", () => {
    expect(recolorStop(g, 1, "$color.accent").stops[1]?.color).toBe("$color.accent");
    const flipped = flipStops(
      linear([
        [0, "#000"],
        [0.3, "#888"],
        [1, "#fff"],
      ]),
    );
    expect(flipped.stops.map((s) => [s.offset, s.color])).toEqual([
      [0, "#fff"],
      [0.7, "#888"],
      [1, "#000"],
    ]);
  });
});

describe("showing a paint in the inspector", () => {
  it("resolves theme colors (the inspector has no theme variables)", () => {
    expect(paintCss("$color.primary/50", theme, () => "")).toBe("#ff000080");
    expect(paintCss(undefined, theme, () => "")).toBeUndefined();
    expect(
      stopBarCss(
        {
          type: "radial-gradient",
          stops: [
            { offset: 0, color: "$color.primary" },
            { offset: 1, color: "#fff" },
          ],
        },
        theme,
      ),
    ).toBe("linear-gradient(90deg, #ff0000 0%, #fff 100%)");
    // A tiled image covers the chip instead of tiling at full size in it.
    const tile = paintCss(
      { type: "image", asset: `asset:${"a".repeat(64)}`, fit: "tile" },
      theme,
      (id) => `/a/${id.slice(0, 2)}`,
    );
    expect(tile).toBe('url("/a/aa") center / cover no-repeat');
  });
});

describe("a paint change and its files", () => {
  const sha = (c: string) => c.repeat(64);
  const photo: Imported = { id: sha("b"), info: { mime: "image/png", bytes: 10, name: "b.png" } };
  const fill = (c: string) => ({
    type: "image" as const,
    asset: `asset:${sha(c)}` as const,
    fit: "cover" as const,
  });
  function deckWith(users: string[]): Deck {
    const deck = createDeck({
      title: "t",
      slides: [
        createSlide({
          id: "s1",
          rootId: "root",
          children: users.map((id) => frame({ id, style: { fill: fill("a") } })),
        }),
      ],
    });
    return { ...deck, assets: { [sha("a")]: { mime: "image/png", bytes: 10 } } };
  }
  const command = { label: "Change fill", ops: [] };

  it("registers a new upload first and drops the old image only its owner used", () => {
    const deck = deckWith(["card"]);
    const result = withPaintAssets(command, deck, "card", fill("a"), fill("b"), photo);
    expect(result.ops).toEqual([
      { op: "asset.add", id: sha("b"), asset: photo.info },
      { op: "asset.remove", id: sha("a") },
    ]);
  });

  it("keeps an image someone else still uses, and files the deck already has", () => {
    const deck = deckWith(["card", "other"]);
    expect(withPaintAssets(command, deck, "card", fill("a"), "#fff").ops).toEqual([]);
    const already = { id: sha("a"), info: { mime: "image/png", bytes: 10 } };
    expect(withPaintAssets(command, deck, "card", "#fff", fill("a"), already).ops).toEqual([]);
    // Same image, new fit: nothing to add or drop.
    const one = deckWith(["card"]);
    expect(
      withPaintAssets(command, one, "card", fill("a"), { ...fill("a"), fit: "tile" }).ops,
    ).toEqual([]);
  });
});
