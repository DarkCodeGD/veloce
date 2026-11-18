/**
 * SlideView = StageView + SlideRenderer: "show this slide of this deck in that box".
 * What the editor uses for its main canvas and its slide thumbnails.
 */
import type { Deck, SlideMeasurement } from "@veloce/core";
import { SlideRenderer, type SlideRendererOptions } from "./slide-renderer.js";
import { StageView, type StageViewOptions } from "./stage.js";

export class SlideView {
  readonly #view: StageView;
  readonly #renderer: SlideRenderer;

  constructor(viewport: HTMLElement, options: SlideRendererOptions & StageViewOptions) {
    this.#view = new StageView(viewport, options);
    this.#renderer = new SlideRenderer(this.#view.stage, options);
  }

  get stage(): HTMLElement {
    return this.#view.stage;
  }

  get scale(): number {
    return this.#view.scale;
  }

  render(deck: Deck, slideId: string): void {
    this.#view.setStageSize(deck.stage.width, deck.stage.height);
    this.#renderer.render(deck, slideId);
  }

  seek(time: number): void {
    this.#renderer.seek(time);
  }

  ready(): Promise<void> {
    return this.#renderer.ready();
  }

  measure(): SlideMeasurement | null {
    return this.#renderer.measure();
  }

  fit(): void {
    this.#view.fit();
  }

  dispose(): void {
    this.#renderer.dispose();
    this.#view.dispose();
  }
}
