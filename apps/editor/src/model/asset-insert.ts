/**
 * Putting imported files into the deck, as pure op builders. The server has already stored
 * the bytes and said what each file is (`{ id, info }`); here that becomes ONE transaction:
 * `asset.add` for files the deck doesn't have yet, then the layers that use them. So an image
 * drop is one undo step, and undoing it unregisters the file too.
 *
 * Images land where they were dropped: in the deepest unlocked frame under the pointer,
 * centred on it in a free frame, or appended in a stack/grid. Without a drop point (pasting a
 * screenshot), they follow the clipboard's rules. They're sized to their own pixels, scaled
 * down to cover at most 60% of the frame, never up. Fonts only register (`asset.add`): they're
 * used through the theme's font tokens.
 */
import {
  type AssetInfo,
  assetKind,
  assetUsage,
  type Deck,
  type ElementNode,
  element,
  type Op,
  type Point,
  parseAssetRef,
} from "@veloce/core";
import type { Command } from "./commands.js";
import { chainOf, type SlideIndex } from "./slide-index.js";

/** An uploaded file, as the server described it. */
export interface Imported {
  id: string;
  info: AssetInfo;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The most of its frame a new image may cover, per side. */
const MAX_COVER = 0.6;
/** For an image without a known size (some SVGs). */
const DEFAULT_SIZE = { width: 400, height: 300 };
/** Several images dropped at once fan out by this much in a free frame. */
const CASCADE = 24;

const plural = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);
const stem = (name: string | undefined) => name?.replace(/\.[^.]+$/, "") || undefined;

export function splitImports(files: readonly Imported[]) {
  return {
    images: files.filter((f) => assetKind(f.info.mime) === "image"),
    fonts: files.filter((f) => assetKind(f.info.mime) === "font"),
  };
}

/** `asset.add` for each file the deck doesn't have yet (each once). */
export function assetAddOps(files: readonly Imported[], deckAssets: ReadonlySet<string>): Op[] {
  const seen = new Set(deckAssets);
  return files.flatMap(({ id, info }) => {
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ op: "asset.add", id, asset: info } satisfies Op];
  });
}

/** The image's own size, scaled down (never up) to cover at most 60% of `room`. */
export function fitSize(info: AssetInfo, room: { w: number; h: number }) {
  const width = info.width ?? DEFAULT_SIZE.width;
  const height = info.height ?? DEFAULT_SIZE.height;
  const scale = Math.min(1, (room.w * MAX_COVER) / width, (room.h * MAX_COVER) / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The deepest frame under a slide point that can take new layers: not locked or hidden (nor
 * inside one that is). The slide's root frame when nothing else is there.
 */
export function frameAt(
  index: SlideIndex,
  point: Point,
  rectOf: (id: string) => Rect | null,
): string {
  let best = { id: index.rootId, depth: -1 };
  for (const [id, { node, depth }] of index.nodes) {
    if (node.kind !== "frame" || depth <= best.depth || id === index.rootId) continue;
    const blocked = chainOf(index, id).some((c) => {
      const n = index.nodes.get(c)?.node;
      return n?.locked || n?.hidden;
    });
    const r = blocked ? null : rectOf(id);
    if (r && point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) {
      best = { id, depth };
    }
  }
  return best.id;
}

export interface ImagePlacement {
  parentId: string;
  /** Insert here among the parent's children (a stack/grid); default: at the end. */
  index?: number;
  /** The parent's box on the slide: room for sizing, and the origin for positions. */
  parentRect: Rect;
  /** Where to centre the images, in slide pixels (a free frame). Default: the frame's middle. */
  center?: Point;
}

export function insertImages(
  index: SlideIndex,
  images: readonly Imported[],
  deckAssets: ReadonlySet<string>,
  at: ImagePlacement,
): Command | null {
  if (images.length === 0) return null;
  const parent = index.nodes.get(at.parentId)?.node;
  if (parent?.kind !== "frame") return null;
  const free = parent.layout.mode === "absolute";
  const { parentRect: room } = at;
  const center = at.center ?? { x: room.x + room.w / 2, y: room.y + room.h / 2 };
  const nodes = images.map(({ id, info }, i): ElementNode => {
    const size = fitSize(info, room);
    const name = stem(info.name);
    return element(
      "image",
      { asset: `asset:${id}`, alt: "" },
      {
        ...(name && { name }),
        ...size,
        ...(free && {
          position: {
            x: Math.round(center.x - room.x - size.width / 2 + i * CASCADE),
            y: Math.round(center.y - room.y - size.height / 2 + i * CASCADE),
          },
        }),
      },
    );
  });
  const inserts: Op[] = nodes.map((node, i) => ({
    op: "node.insert",
    parentId: at.parentId,
    node,
    ...(at.index !== undefined && { index: at.index + i }),
  }));
  const only = images.length === 1 ? images[0] : undefined;
  return {
    label: only?.info.name
      ? `Add image "${only.info.name}"`
      : `Add ${plural(images.length, "image")}`,
    ops: [...assetAddOps(images, deckAssets), ...inserts],
    select: nodes.map((n) => n.id),
  };
}

/**
 * Point a layer's asset prop at another file: register the new file if needed, and drop the
 * old one when nothing else uses it (so a swapped-out photo doesn't stay in the .veloce file).
 * One transaction; undo brings the old picture back.
 */
export function replaceAsset(
  deck: Pick<Deck, "assets" | "slides">,
  nodeId: string,
  key: string,
  previous: unknown,
  next: Imported,
): Command {
  const ops: Op[] = [
    ...assetAddOps([next], new Set(Object.keys(deck.assets))),
    { op: "node.update", id: nodeId, set: { props: { [key]: `asset:${next.id}` } } },
  ];
  const old = parseAssetRef(previous);
  const users = old ? (assetUsage(deck as Deck).get(old) ?? []) : [];
  if (old && old !== next.id && users.every((id) => id === nodeId)) {
    ops.push({ op: "asset.remove", id: old });
  }
  return { label: `Replace image with "${next.info.name ?? "a file"}"`, ops };
}

/** Register font files (they're then picked in the theme). Null if the deck has them all. */
export function addFonts(
  fonts: readonly Imported[],
  deckAssets: ReadonlySet<string>,
): Command | null {
  const ops = assetAddOps(fonts, deckAssets);
  if (ops.length === 0) return null;
  const families = [...new Set(fonts.map((f) => f.info.font?.family ?? f.info.name ?? "font"))];
  return {
    label:
      families.length === 1
        ? `Add font "${families[0]}"`
        : `Add ${plural(families.length, "font")}`,
    ops,
  };
}
