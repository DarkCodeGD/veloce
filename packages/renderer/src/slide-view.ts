/**
 * SlideView = StageView + SlideRenderer: "show this slide of this deck in that box".
 * What the editor uses for its main canvas and its slide thumbnails.
 */
import type { Box, Deck, MotionClip, MotionState, SlideMeasurement } from "@veloce/core";
import { SlideRenderer, type SlideRendererOptions } from "./slide-renderer.js";
import { type Camera, StageView, type StageViewOptions } from "./stage.js";

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

  /** Where the stage is drawn right now. */
  get camera(): Camera {
    return this.#view.camera;
  }

  /** True while the stage fits its viewport. */
  get fitted(): boolean {
    return this.#view.fitted;
  }

  /** The camera that fits the stage in its viewport. */
  get fitCamera(): Camera {
    return this.#view.fitCamera;
  }

  /** Zoom and pan: draw the stage with this camera, or fit the viewport again with `null`. */
  setCamera(camera: Camera | null): void {
    this.#view.setCamera(camera);
  }

  render(deck: Deck, slideId: string): void {
    this.#view.setStageSize(deck.stage.width, deck.stage.height);
    this.#renderer.render(deck, slideId);
  }

  seek(time: number): void {
    this.#renderer.seek(time);
  }

  /** Draw layers away from their rest position (see `SlideRenderer.setMotion`). */
  setMotion(motion: ReadonlyMap<string, MotionState>): void {
    this.#renderer.setMotion(motion);
  }

  /** Play planned motion on the compositor (see `SlideRenderer.playMotion`, D115). */
  playMotion(clips: ReadonlyMap<string, readonly MotionClip[]>, origin: number): void {
    this.#renderer.playMotion(clips, origin);
  }

  pauseMotion(time?: number): void {
    this.#renderer.pauseMotion(time);
  }

  stopMotion(): void {
    this.#renderer.stopMotion();
  }

  ready(): Promise<void> {
    return this.#renderer.ready();
  }

  /** The slide's layout with some layers taken out, for layout animations (D120). */
  measureLayout(absent: ReadonlySet<string>): Map<string, { x: number; y: number }> {
    return this.#renderer.measureLayout(absent);
  }

  /** Draw nothing until the next `render` (see `SlideRenderer.clear`). */
  clear(): void {
    this.#renderer.clear();
  }

  /** Every layer's box at rest, in stage pixels (see `SlideRenderer.measureBoxes`, D123). */
  measureBoxes(): Map<string, Box> {
    return this.#renderer.measureBoxes();
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
