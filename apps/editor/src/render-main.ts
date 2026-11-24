/**
 * The headless render page (render.html). The server's render worker loads it in Chromium
 * and calls `window.veloceRender` to measure slides and to stage them for screenshots.
 * Same renderer and plugins as the editor, so agents see exactly what users see.
 */
import { createBuiltinRegistry } from "@veloce/builtins";
import type { Deck, SlideMeasurement } from "@veloce/core";
import { seekPosition } from "@veloce/core";
import { SlidePlayer, SlideRenderer } from "@veloce/renderer";
import { syncDeckFonts } from "./deck-fonts.js";
import { loadFonts } from "./fonts.js";

let deckId = "";
const host = document.createElement("div");
host.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0";
const stage = document.createElement("div");
host.append(stage);
document.body.append(host);

const assetUrl = (id: string) => `/api/decks/${encodeURIComponent(deckId)}/assets/${id}`;
const registry = createBuiltinRegistry();
const renderer = new SlideRenderer(stage, {
  registry,
  assetUrl,
  onPluginError: (error, info) =>
    console.error(`Plugin error in ${info.nodeId} (${info.phase})`, error),
});
const player = new SlidePlayer(renderer, { effects: registry.resolveEffect });
const fonts = loadFonts();

/**
 * A moment of a slide's animations (D115): `time` ms into `step`, every step before it
 * played out. Drawn by the clock (`seek`, like export), or with `playback: "compositor"` by
 * the Web Animations presenting uses, frozen at that moment: the pixel test that proves
 * both draw the same frame compares the two.
 */
interface Moment {
  step: number;
  time: number;
  playback?: "clock" | "compositor";
}

async function draw(deck: Deck, id: string, slideId: string, scale: number): Promise<void> {
  await fonts;
  deckId = id;
  await syncDeckFonts(deck, assetUrl); // the deck's own fonts, before anything is measured
  host.style.transform = scale === 1 ? "" : `scale(${scale})`;
  player.unload(); // at rest: measurements and plain previews show the layout, no motion
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
    at?: Moment,
  ): Promise<{ width: number; height: number }> {
    const scale = width / deck.stage.width;
    await draw(deck, id, slideId, scale);
    if (at) {
      player.load(deck, slideId);
      if (at.playback === "compositor") {
        player.play(seekPosition(player.steps, at.step, 0));
        player.pause(seekPosition(player.steps, at.step, at.time).time);
      } else {
        player.seek(at.step, at.time);
      }
      await renderer.ready();
    }
    return { width: Math.round(width), height: Math.round(deck.stage.height * scale) };
  },
};

Object.assign(window, { veloceRender: api });
