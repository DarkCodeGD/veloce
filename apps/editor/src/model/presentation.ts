/**
 * Presenting a deck (D116): which slide shows and how far it has built, as clicks move it
 * on. Pure navigation over a `SlidePlayer` (or anything that plays like one), so the keys
 * behave as in PowerPoint, Keynote and Google Slides and tests can check that without a
 * browser:
 *
 * - **Next** (click, →, Space…) starts the slide's next step; after its last step, the next
 *   slide appears and plays its step 0; after the last slide, the end screen; then out.
 * - **Previous** goes back one step, shown played out (as if it just finished); from a
 *   slide's first step, to the previous slide fully built.
 * - **First / Last** jump to a slide as it appears / fully built.
 *
 * Hidden slides are skipped, as every presentation tool does. A slide shown "played out" is
 * still playing: what loops keeps looping.
 */
import { type Deck, type PlayPosition, type Slide, type Step, seekPosition } from "@veloce/core";

/** What presenting drives: `SlidePlayer`'s navigation. */
export interface PresentationPlayer {
  load(deck: Deck, slideId: string): void;
  play(from?: PlayPosition): void;
  next(): boolean;
  readonly steps: readonly Step[];
  readonly position: PlayPosition;
}

export interface PresentationState {
  /** Index into the slides presented (hidden ones left out). */
  index: number;
  /** Past the last slide: the end screen. */
  ended: boolean;
}

/** The slides a presentation shows, in order. */
export const presentedSlides = (deck: Deck): Slide[] => deck.slides.filter((s) => !s.hidden);

/** Where presenting starts: at `slideId`, or the next shown slide after it if it's hidden. */
export function startIndex(deck: Deck, slideId: string | null): number {
  if (slideId === null) return 0;
  const at = deck.slides.findIndex((s) => s.id === slideId);
  if (at < 0) return 0;
  const shown = deck.slides.slice(at).find((s) => !s.hidden);
  const index = shown ? presentedSlides(deck).indexOf(shown) : -1;
  return index < 0 ? Math.max(0, presentedSlides(deck).length - 1) : index;
}

/** The moment `step` has played out: what's on screen once it ends, loops still going. */
function playedOut(steps: readonly Step[], step: number): PlayPosition {
  return seekPosition(steps, step, steps[step]?.duration ?? 0);
}

export class Presentation {
  readonly #deck: Deck;
  readonly #slides: Slide[];
  readonly #player: PresentationPlayer;
  /** Waits for the slide's fonts and images, so motion starts on a finished frame. */
  readonly #ready: () => Promise<void>;
  readonly #onChange: (state: PresentationState) => void;
  #state: PresentationState = { index: 0, ended: false };
  /**
   * Navigation runs one move at a time: a click while the next slide is still loading
   * waits for it, then starts its next step, rather than being lost or racing it.
   */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    deck: Deck,
    player: PresentationPlayer,
    options: { ready?: () => Promise<void>; onChange?: (state: PresentationState) => void } = {},
  ) {
    this.#deck = deck;
    this.#slides = presentedSlides(deck);
    this.#player = player;
    this.#ready = options.ready ?? (() => Promise.resolve());
    this.#onChange = options.onChange ?? (() => {});
  }

  get state(): PresentationState {
    return this.#state;
  }

  get slideCount(): number {
    return this.#slides.length;
  }

  /** Show slide `index` as it appears and play it. Resolves once it plays. */
  start(index = 0): Promise<void> {
    return this.#enqueue(() => this.#show(index, "start"));
  }

  /** A click. Resolves false once past the end screen (time to leave). */
  next(): Promise<boolean> {
    return this.#enqueue(async () => {
      if (this.#state.ended) return false;
      if (this.#player.next()) return true;
      if (this.#state.index + 1 < this.#slides.length) {
        await this.#show(this.#state.index + 1, "start");
      } else {
        this.#set({ index: this.#state.index, ended: true });
      }
      return true;
    });
  }

  previous(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#state.ended) return this.#show(this.#state.index, "end");
      const clicks = this.#player.position.clicks.length;
      if (clicks > 0) this.#player.play(playedOut(this.#player.steps, clicks - 1));
      else if (this.#state.index > 0) await this.#show(this.#state.index - 1, "end");
    });
  }

  first(): Promise<void> {
    return this.#enqueue(() => this.#show(0, "start"));
  }

  last(): Promise<void> {
    return this.#enqueue(() => this.#show(this.#slides.length - 1, "end"));
  }

  #enqueue<T>(move: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(move);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #show(index: number, at: "start" | "end"): Promise<void> {
    const slide = this.#slides[index];
    if (!slide) return;
    this.#player.load(this.#deck, slide.id);
    this.#set({ index, ended: false });
    await this.#ready();
    const steps = this.#player.steps;
    this.#player.play(
      at === "start" ? { time: 0, clicks: [] } : playedOut(steps, Math.max(0, steps.length - 1)),
    );
  }

  #set(state: PresentationState): void {
    this.#state = state;
    this.#onChange(state);
  }
}
