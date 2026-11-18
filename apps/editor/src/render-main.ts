/**
 * The headless render page (render.html). The server's render worker loads it in Chromium
 * and calls `window.veloceRender` to measure slides and to stage them for screenshots.
 * Same renderer and plugins as the editor, so agents see exactly what users see.
 */
import { createBuiltinRegistry } from "@veloce/builtins";
import type { Deck, SlideMeasurement } from "@veloce/core";
import { SlideRenderer } from "@veloce/renderer";
import { syncDeckFonts } from "./deck-fonts.js";
import { loadFonts } from "./fonts.js";

let deckId = "";
const host = document.createElement("div");
host.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0";
const stage = document.createElement("div");
host.append(stage);
document.body.append(host);

const assetUrl = (id: string) => `/api/decks/${encodeURIComponent(deckId)}/assets/${id}`;
const renderer = new SlideRenderer(stage, {
  registry: createBuiltinRegistry(),
  assetUrl,
  onPluginError: (error, info) =>
    console.error(`Plugin error in ${info.nodeId} (${info.phase})`, error),
});
const fonts = loadFonts();

async function draw(deck: Deck, id: string, slideId: string, scale: number): Promise<void> {
  await fonts;
  deckId = id;
  await syncDeckFonts(deck, assetUrl); // the deck's own fonts, before anything is measured
  host.style.transform = scale === 1 ? "" : `scale(${scale})`;
  renderer.render(deck, slideId);
  await renderer.ready();
}

const api = {
  async measure(
    deck: Deck,
    id: string,
    slideIds: readonly string[] | null,
  ): Promise<SlideMeasurement[]> {
    const out: SlideMeasurement[] = [];
    for (const slide of deck.slides) {
      if (slideIds && !slideIds.includes(slide.id)) continue;
      await draw(deck, id, slide.id, 1);
      const m = renderer.measure();
      if (m) out.push(m);
    }
    return out;
  },
  async show(
    deck: Deck,
    id: string,
    slideId: string,
    width: number,
  ): Promise<{ width: number; height: number }> {
    const scale = width / deck.stage.width;
    await draw(deck, id, slideId, scale);
    return { width: Math.round(width), height: Math.round(deck.stage.height * scale) };
  },
};

Object.assign(window, { veloceRender: api });
