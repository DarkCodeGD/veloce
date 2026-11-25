/**
 * SlideShow: slides one after another in a container, with transitions between them (D123).
 * Two stacked views take turns: the slide on screen is in the front one; the next slide is
 * drawn in the back one, then arrives over it with its transition, and they swap.
 *
 * Plays like one `SlidePlayer` (load, play, next, steps, position: what presenting drives,
 * D116) plus `transition()`, which brings the next slide in. Each view fills the container;
 * the container's own background shows around the stage (letterboxing).
 */
import type { Deck, EffectResolver, MotionState, PlayPosition, Step } from "@veloce/core";
import { SlidePlayer } from "./slide-player.js";
import type { SlideRendererOptions } from "./slide-renderer.js";
import { createSlideTransition, type SlideTransition } from "./slide-transition.js";
import { SlideView } from "./slide-view.js";
import type { StageViewOptions } from "./stage.js";

export interface SlideShowOptions extends SlideRendererOptions, StageViewOptions {
  /** Turns effects into tracks (the effect presets). */
  effects?: EffectResolver;
}

interface Layer {
  frame: HTMLElement;
  view: SlideView;
  player: SlidePlayer;
  slideId: string | null;
}

export class SlideShow {
  readonly #layers: [Layer, Layer];
  /** Which layer is on screen. */
  #front = 0;
  #deck: Deck | null = null;
  #transition: SlideTransition | null = null;

  constructor(container: HTMLElement, options: SlideShowOptions) {
    if (!container.style.position) container.style.position = "relative";
    const layer = (): Layer => {
      const frame = container.ownerDocument.createElement("div");
      Object.assign(frame.style, { position: "absolute", inset: "0" });
      container.append(frame);
      const view = new SlideView(frame, options);
      const player = new SlidePlayer(view, options.effects ? { effects: options.effects } : {});
      return { frame, view, player, slideId: null };
    };
    this.#layers = [layer(), layer()];
    this.#stack();
  }

  /** The view on screen. */
  get view(): SlideView {
    return this.#current.view;
  }

  get #current(): Layer {
    return this.#layers[this.#front] as Layer;
  }

  get #back(): Layer {
    return this.#layers[1 - this.#front] as Layer;
  }

  /** True while a transition plays. */
  get transitioning(): boolean {
    return this.#transition !== null;
  }

  // ── Playing the slide on screen (SlidePlayer's API) ─────────────────────────────────

  /** Show `slideId` at once (a cut), as it appears. */
  load(deck: Deck, slideId: string): void {
    this.#transition?.finish();
    this.#deck = deck;
    const layer = this.#current;
    layer.player.load(deck, slideId);
    layer.slideId = slideId;
    this.#retire(this.#back);
  }

  play(from?: PlayPosition): void {
    this.#current.player.play(from);
  }

  next(): boolean {
    return this.#current.player.next();
  }

  get steps(): readonly Step[] {
    return this.#current.player.steps;
  }

  get position(): PlayPosition {
    return this.#current.player.position;
  }

  /** Fonts and images of the slide on screen have loaded. */
  ready(): Promise<void> {
    return this.#current.view.ready();
  }

  // ── Transitions ─────────────────────────────────────────────────────────────────────

  /**
   * Bring `slideId` in over the slide on screen with its transition (or cut, when it has
   * none or nothing is on screen). Resolves once it has arrived, shown as it appears (time
   * 0 of its first step), ready to `play()`.
   */
  async transition(deck: Deck, slideId: string): Promise<void> {
    this.#transition?.finish();
    const leaving = this.#current;
    if (leaving.slideId === null || this.#deck === null) {
      this.load(deck, slideId);
      await this.ready();
      return;
    }
    this.#deck = deck;
    const arriving = this.#back;
    arriving.player.load(deck, slideId);
    arriving.slideId = slideId;
    arriving.frame.style.visibility = "hidden"; // laid out to measure, not shown yet
    await arriving.view.ready();

    // The leaving slide stops where it is: a morph moves its layers from there.
    const position = leaving.player.position;
    leaving.player.seekTo(position);
    const side = (layer: Layer, motion: ReadonlyMap<string, MotionState>) => ({
      view: layer.view,
      frame: layer.frame,
      motion,
    });
    const transition = createSlideTransition(
      deck,
      leaving.slideId,
      slideId,
      side(leaving, leaving.player.motionAt(position)),
      side(arriving, arriving.player.motionAt()),
    );
    this.#front = 1 - this.#front;
    this.#stack();
    if (transition) {
      this.#transition = transition;
      await transition.play();
      if (this.#transition === transition) this.#transition = null;
    }
    this.#retire(leaving);
  }

  /** End a playing transition now (a click while it plays): the new slide has arrived. */
  finishTransition(): void {
    this.#transition?.finish();
  }

  dispose(): void {
    this.#transition?.finish();
    for (const layer of this.#layers) {
      layer.player.dispose();
      layer.view.dispose();
      layer.frame.remove();
    }
  }

  /** The front layer on top and shown, the back one under it and hidden. */
  #stack(): void {
    this.#current.frame.style.zIndex = "1";
    this.#current.frame.style.visibility = "";
    this.#back.frame.style.zIndex = "0";
  }

  /** A layer that's no longer on screen: hidden, its slide stopped. */
  #retire(layer: Layer): void {
    if (layer === this.#current) return;
    layer.frame.style.visibility = "hidden";
    layer.player.unload();
    layer.view.clear(); // its layers (and their plugins' resources) go until it's used again
    layer.slideId = null;
  }
}
