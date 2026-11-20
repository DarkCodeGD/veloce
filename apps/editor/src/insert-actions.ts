/**
 * Adding a layer from the UI (D81): the tool bar, the Add menu, a click or a drawn box on the
 * canvas. The pure part (what the layer is, where it lands) is model/insert.ts; this measures
 * the slide as laid out now, sends the ONE transaction, then selects the new layer, and a new
 * text layer starts typing with its placeholder selected, so typing replaces it.
 */
import type { Deck, Point } from "@veloce/core";
import { run } from "./actions.js";
import { IMAGE_TYPES } from "./assets.js";
import { EDGE_BAND_PX } from "./components/canvas-drags.js";
import { mainCanvasSpace } from "./components/canvas-space.js";
import { importFiles } from "./components/import-files.js";
import { registry } from "./editor-context.js";
import type { Command } from "./model/commands.js";
import { type ElementInfo, type Insertable, insertCommand } from "./model/insert.js";
import type { SlideIndex } from "./model/slide-index.js";
import { setTool } from "./tools.js";

/** What adding needs from the editor. */
export interface InsertContext {
  deck: Deck;
  slideIndex: SlideIndex;
  selection: readonly string[];
  select(ids: string[]): void;
  /** Start typing into a text layer, all of its text selected. */
  editText(id: string): void;
}

/** The registered element types, as the Add menu and new layers need them. */
export function elementInfos(): ElementInfo[] {
  return registry.types().flatMap((type) => {
    const d = registry.get(type)?.definition;
    if (!d) return [];
    return [
      {
        type: d.type,
        title: d.title,
        description: d.description,
        defaultProps: d.defaultProps,
        ...(d.defaultSize && { defaultSize: d.defaultSize }),
      },
    ];
  });
}

/** Add `item` at a screen point (null: where a paste would go). */
export async function addLayer(
  ctx: InsertContext,
  item: Insertable,
  at: Point | null,
): Promise<void> {
  if (item.make.kind === "image") {
    const files = await pickImages();
    if (files.length === 0) return;
    const ids = await importFiles({
      deck: ctx.deck,
      index: ctx.slideIndex,
      selection: ctx.selection,
      files,
      ...(at && { dropAt: at }),
    });
    if (ids?.length) ctx.select(ids);
    return;
  }
  const space = mainCanvasSpace();
  const command = insertCommand(
    ctx.slideIndex,
    space ? space.frames(ctx.slideIndex, new Set()) : [],
    item,
    elementInfos(),
    at && space ? { point: space.toSlide(at) } : null,
    ctx.selection,
    space ? EDGE_BAND_PX / space.scale : undefined,
  );
  if (command && (await run(command))) afterInsert(ctx, command);
}

/** Once the server applied an addition: back to Select, the new layer selected (and typing). */
export function afterInsert(
  ctx: Pick<InsertContext, "select" | "editText">,
  command: Command,
): void {
  setTool("select");
  const op = command.ops[0];
  const node = op?.op === "node.insert" ? op.node : undefined;
  if (!node) return;
  if (node.kind === "element" && node.type === "text") ctx.editText(node.id);
  else ctx.select([node.id]);
}

/** The system file picker, for images. Resolves with nothing if it's dismissed. */
function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_TYPES;
    input.multiple = true;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}
