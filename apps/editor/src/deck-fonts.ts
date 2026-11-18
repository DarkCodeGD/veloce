/**
 * Fonts the deck carries as assets (dropped in, or added by an agent), registered with the
 * page's `document.fonts` under the family name the server read from each file. Every view
 * in the page (canvas, thumbnails, the render page) then uses them through ordinary font
 * stacks like `"Acme Sans", system-ui, sans-serif`.
 *
 * Switching decks swaps the set: faces the new deck doesn't have are removed, so one deck's
 * fonts never leak into another's rendering (or keep their memory). Faces load right away:
 * a deck font is there because the deck uses it, and measuring needs the real glyphs.
 */
import { type Deck, deckFontFaces } from "@veloce/core";

/** Registered faces, by their asset URL (which names the deck and the file). */
const registered = new Map<string, FontFace>();

/** Make the page's deck fonts exactly this deck's. Resolves when they've loaded (or failed). */
export function syncDeckFonts(
  deck: Pick<Deck, "assets">,
  urlOf: (assetId: string) => string,
): Promise<void> {
  const wanted = new Map(deckFontFaces(deck).map((face) => [urlOf(face.assetId), face]));
  for (const [url, face] of registered) {
    if (wanted.has(url)) continue;
    document.fonts.delete(face);
    registered.delete(url);
  }
  const loading: Array<Promise<unknown>> = [];
  for (const [url, info] of wanted) {
    if (registered.has(url)) continue;
    const face = new FontFace(info.family, `url(${JSON.stringify(url)})`, {
      weight: info.weight,
      style: info.style,
      display: "block",
    });
    document.fonts.add(face);
    registered.set(url, face);
    // A broken file shows the fallback font; it never stops the slide from rendering.
    loading.push(face.load().catch(() => {}));
  }
  return Promise.all(loading).then(() => {});
}
