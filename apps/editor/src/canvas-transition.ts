/**
 * Previewing a slide's transition on the canvas (D123): a `SlideShow` laid exactly over the
 * slide on the canvas, clipped to it as PowerPoint's preview is, plays the slide before into
 * this one; the canvas's own slide hides meanwhile. The first slide arrives from black, as
 * a show starts. Nothing here is an op: it's gone once the preview ends.
 */
import { createSlide, type Deck } from "@veloce/core";
import { SlideShow, type SlideShowOptions, type SlideView } from "@veloce/renderer";
import type { TransitionPreview } from "./canvas-playback.js";

/** What the first slide arrives from in a preview. */
const BLANK_ID = "veloce-preview-blank";

export class CanvasTransitionPreview implements TransitionPreview {
  readonly #view: () => SlideView | null;
  readonly #options: SlideShowOptions;
  #overlay: HTMLElement | null = null;
  #show: SlideShow | null = null;
  #hidden: SlideView | null = null;

  constructor(view: () => SlideView | null, options: SlideShowOptions) {
    this.#view = view;
    this.#options = options;
  }

  async play(deck: Deck, slideId: string): Promise<void> {
    this.stop();
    const view = this.#view();
    const viewport = view?.stage.parentElement;
    const index = deck.slides.findIndex((s) => s.id === slideId);
    if (!view || !viewport || index < 0) return;

    const before = deck.slides[index - 1];
    const shown: Deck = before
      ? deck
      : {
          ...deck,
          slides: [{ ...createSlide({ id: BLANK_ID }), background: "#000000" }, ...deck.slides],
        };
    // Over the slide exactly: where the canvas's camera draws it, at its size.
    const { x, y, scale } = view.camera;
    const overlay = viewport.ownerDocument.createElement("div");
    overlay.className = "transition-preview";
    Object.assign(overlay.style, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      width: `${deck.stage.width * scale}px`,
      height: `${deck.stage.height * scale}px`,
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "1",
    });
    viewport.append(overlay);
    const show = new SlideShow(overlay, { ...this.#options, padding: 0 });
    this.#overlay = overlay;
    this.#show = show;
    view.stage.style.visibility = "hidden";
    this.#hidden = view;

    show.load(shown, before?.id ?? BLANK_ID);
    await show.ready();
    if (this.#show !== show) return; // stopped meanwhile
    await show.transition(shown, slideId);
  }

  stop(): void {
    this.#show?.dispose();
    this.#show = null;
    this.#overlay?.remove();
    this.#overlay = null;
    if (this.#hidden) this.#hidden.stage.style.visibility = "";
    this.#hidden = null;
  }
}
