/**
 * Files into the deck, from a drop on the canvas or a paste: upload them (the server works out
 * what each one is), then ONE transaction registers them and places the images: the drop
 * point, or the clipboard's paste rules. Fonts are registered for the theme's font pickers.
 * Bad files are reported one by one; the good ones still land.
 */
import type { Deck, Point } from "@veloce/core";
import { run } from "../actions.js";
import { looksImportable, uploadAll } from "../assets.js";
import {
  addFonts,
  frameAt,
  type ImagePlacement,
  insertImages,
  type Rect,
  splitImports,
} from "../model/asset-insert.js";
import { pasteTarget } from "../model/clipboard.js";
import type { Command } from "../model/commands.js";
import type { SlideIndex } from "../model/slide-index.js";
import { showToast } from "../toasts.js";
import { mainCanvasSpace } from "./canvas-space.js";

const ACCEPTED = "images (PNG, JPEG, GIF, WebP, AVIF, SVG) and fonts (TTF, OTF, WOFF, WOFF2)";

interface ImportOptions {
  deck: Deck;
  index: SlideIndex;
  selection: readonly string[];
  files: readonly File[];
  /** Where they were dropped, in screen pixels. None: a paste. */
  dropAt?: Point;
}

/** Resolves with the IDs of the new image layers (to select), or null if nothing landed. */
export async function importFiles(options: ImportOptions): Promise<string[] | null> {
  const { deck, files } = options;
  const usable = files.filter(looksImportable);
  if (usable.length === 0) {
    showToast({ message: `Veloce can import ${ACCEPTED}`, tone: "error" });
    return null;
  }
  const { imported, errors } = await uploadAll(deck.id, usable);
  if (errors.length > 0) {
    showToast(
      {
        message:
          errors.length === 1
            ? (errors[0] as string)
            : `${errors.length} files couldn't be imported: ${errors.join("; ")}`,
        tone: "error",
      },
      8000,
    );
  }
  if (imported.length === 0) return null;

  const known = new Set(Object.keys(deck.assets));
  const { images, fonts } = splitImports(imported);
  const fontCommand = addFonts(fonts, known);
  const imageCommand = insertImages(options.index, images, known, placement(options));
  const command = merge(fontCommand, imageCommand);
  if (!command || !(await run(command))) return null;
  if (fontCommand) {
    const families = [...new Set(fonts.flatMap((f) => f.info.font?.family ?? []))];
    showToast({
      message: `${families.length === 1 ? `"${families[0]}" is` : `${families.join(", ")} are`} ready: pick it in Theme › Fonts`,
      tone: "info",
    });
  }
  return imageCommand?.select ?? [];
}

/** Where images go: the frame under the drop point, or the paste target. */
function placement({ deck, index, selection, dropAt }: ImportOptions): ImagePlacement {
  const space = mainCanvasSpace();
  const slide: Rect = { x: 0, y: 0, w: deck.stage.width, h: deck.stage.height };
  const rectOf = (id: string) => space?.rect(id) ?? (id === index.rootId ? slide : null);
  if (dropAt && space) {
    const point = space.toSlide(dropAt);
    const parentId = frameAt(index, point, rectOf);
    return { parentId, parentRect: rectOf(parentId) ?? slide, center: point };
  }
  const target = pasteTarget(index, selection, new Set());
  return {
    parentId: target.parentId,
    ...(target.index !== undefined && { index: target.index }),
    parentRect: rectOf(target.parentId) ?? slide,
  };
}

/** One transaction for fonts and images dropped together. */
function merge(fonts: Command | null, images: Command | null): Command | null {
  if (!fonts || !images) return fonts ?? images;
  return {
    label: "Add images and fonts",
    ops: [...fonts.ops, ...images.ops],
    ...(images.select && { select: images.select }),
  };
}
