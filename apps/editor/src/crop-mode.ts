/**
 * Crop mode (D84): which layer is being cropped on the canvas, and what the editor knows
 * about a layer's picture. A layer can be cropped when its element's schema has a crop field
 * (an `{ x, y, w, h }` prop next to an asset prop, model/schema-fields.ts), so a plugin's
 * picture element gets crop mode without editor code (golden rule 5).
 *
 * Crop mode is view state, like the tool: entering or leaving it changes nothing in the deck.
 * Every gesture inside it is its own transaction.
 */
import { type Deck, type Node, parseAssetRef } from "@veloce/core";
import { registry } from "./editor-context.js";
import type { Size } from "./model/focus-point.js";
import { propFields } from "./model/schema-fields.js";
import { createStore } from "./store.js";

/** A layer's picture, as crop mode needs it. */
export interface Picture {
  /** The prop holding the crop, and the focus prop if the element has one. */
  cropKey: string;
  focusKey: string | undefined;
  assetId: string;
  /** The picture's pixel size from the deck's asset info, when it was recorded. */
  size: Size | null;
}

/** The picture of a layer that can be cropped, or null. */
export function pictureOf(deck: Deck, node: Node | undefined): Picture | null {
  if (node?.kind !== "element") return null;
  const definition = registry.get(node.type)?.definition;
  if (!definition) return null;
  const fields = propFields(definition);
  const crop = fields.find((f) => f.kind === "crop");
  if (crop?.kind !== "crop") return null;
  const assetId = parseAssetRef(node.props[crop.asset]);
  if (!assetId) return null;
  const info = deck.assets[assetId];
  return {
    cropKey: crop.key,
    focusKey: fields.find((f) => f.kind === "focus")?.key,
    assetId,
    size: info?.width && info.height ? { w: info.width, h: info.height } : null,
  };
}

/** The layer being cropped, or null. */
export const cropStore = createStore<string | null>(null);
export const useCropping = cropStore.use;
export const enterCrop = (id: string) => cropStore.set(id);
export const exitCrop = () => cropStore.set(null);
