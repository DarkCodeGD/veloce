/**
 * SlidePlayer: the one clock (golden rule 3) that plays a slide's animations (D107, D115).
 *
 * - **Seeking** (scrubbing, export, screenshots): `seek(step, time)` draws that exact frame
 *   on the main thread: the evaluator's motion through `setMotion`, animated properties by
 *   re-rendering the slide as it looks then, and every plugin's `seek(t)`. Frame-exact and
 *   deterministic.
 * - **Playing** (presenting): `play()` hands motion to the compositor as Web Animations
 *   planned from the evaluator, so it stays at 60 fps however busy the app gets; a frame
 *   loop on the main thread keeps only what the compositor can't do: animated properties,
 *   plugins' `seek(t)` and loops too long to plan. `next()` is a click: the next step starts
 *   now, and motion is planned again from there.
 *
 * Time is the browser's animation timeline (`document.timeline`), the clock Web Animations
 * run on, so the compositor and the main thread can't drift apart.
 */
import {
  type CompiledSlide,
  compileSlide,
  type Deck,
  type EffectResolver,
  hasProperties,
  type MotionClip,
  type MotionState,
  motionOf,
  type PlayPosition,
  planMotion,
  type Slide,
  type SlideFrame,
  type Step,
  seekPosition,
  withProperties,
} from "@veloce/core";
import type { SlideRenderer } from "./slide-renderer.js";

/** What the player drives: a `SlideRenderer` (or anything that draws like one). */
export type PlayerTarget = Pick<
  SlideRenderer,
  "render" | "setMotion" | "seek" | "playMotion" | "pauseMotion" | "stopMotion"
> &
  // Layout animations (D120) measure the slide; without these, layers jump instead of glide.
  Partial<Pick<SlideRenderer, "measureLayout" | "ready">>;

export interface SlidePlayerOptions {
  /** Turns effects into tracks (the effect presets). Without it, effects don't move. */
  effects?: EffectResolver;
  /** Milliseconds on the timeline Web Animations use. Default: `document.timeline`. */
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

const timelineNow = () => Number(document.timeline.currentTime ?? performance.now());

export class SlidePlayer {
  readonly #target: PlayerTarget;
  readonly #options: SlidePlayerOptions;
  #deck: Deck | null = null;
  #slide: Slide | null = null;
  #compiled: CompiledSlide | null = null;
  /** Where it is while not playing. */
  #position: PlayPosition = { time: 0, clicks: [] };
  /** While playing: the timeline time at which the slide's time is 0. */
  #origin: number | null = null;
  /** Layers the main thread moves while playing, and the motion it last drew for all. */
  #clockLayers: string[] = [];
  #drawn = new Map<string, MotionState>();
  /** While playing: whether any property is animated from here on (redrawn each frame). */
  #propertyTracks = false;
  /** True when the renderer shows the slide with animated properties written in. */
  #patched = false;
  #frame: number | null = null;

  constructor(target: PlayerTarget, options: SlidePlayerOptions = {}) {
    this.#target = target;
    this.#options = options;
  }

  /** Show `slideId` of `deck` as it appears (step 0, time 0), ready to seek or play. */
  load(deck: Deck, slideId: string): void {
    this.#stopPlaying();
    const slide = deck.slides.find((s) => s.id === slideId) ?? null;
    this.#deck = deck;
    this.#slide = slide;
    // Rendered first: layout animations measure the slide as drawn (D120).
    this.#target.render(deck, slideId);
    this.#patched = false;
    this.#compiled = slide ? this.#compile(deck, slide) : null;
    this.#position = { time: 0, clicks: [] };
    this.#draw(this.#position);
    if (slide && this.#target.ready && this.#needsLayout(slide)) {
      // Fonts and images can still change the layout: measure again once they're in.
      const loaded = slide;
      void this.#target.ready().then(() => this.#remeasure(loaded));
    }
  }

  /** Back to the slide at rest, as if it had no animations (thumbnails, editing). */
  unload(): void {
    this.#stopPlaying();
    this.#target.setMotion(new Map());
    if (this.#patched && this.#deck && this.#slide) this.#target.render(this.#deck, this.#slide.id);
    this.#patched = false;
    this.#compiled = null;
    this.#position = { time: 0, clicks: [] };
  }

  /**
   * The motion of every layer at `position` (default: where it is): what's moved, hidden or
   * not yet in. A transition (D123) leaves those layers to the slide's own motion.
   */
  motionAt(position: PlayPosition = this.position): Map<string, MotionState> {
    return this.#compiled ? motionOf(this.#compiled.at(position)) : new Map();
  }

  /** The slide's steps (step 0 plays as it appears; each click starts the next). */
  get steps(): readonly Step[] {
    return this.#compiled?.steps ?? [];
  }

  get playing(): boolean {
    return this.#origin !== null;
  }

  /** Where it is now: while playing, where the timeline has got to. */
  get position(): PlayPosition {
    if (this.#origin === null) return this.#position;
    return { time: this.#now() - this.#origin, clicks: this.#position.clicks };
  }

  /** Draw `time` ms into `step`, every step before it played out; stops playing. */
  seek(step: number, time: number): void {
    this.seekTo(seekPosition(this.steps, step, time));
  }

  /** Draw exactly this moment on the main thread; stops playing. */
  seekTo(position: PlayPosition): void {
    this.#stopPlaying();
    this.#position = position;
    this.#draw(position);
  }

  /** Play from `from` (default: where it is), motion on the compositor. */
  play(from: PlayPosition = this.position): void {
    const compiled = this.#compiled;
    if (!compiled) return;
    this.#stopPlaying();
    this.#position = from;
    const frame = this.#draw(from);
    const clips = new Map<string, readonly MotionClip[]>();
    this.#clockLayers = [];
    this.#propertyTracks = [...compiled.activity(from.clicks).values()].some(
      ({ properties: p }) => p !== null && (p.until > from.time || p.period !== null),
    );
    for (const [id, plan] of planMotion(compiled, from)) {
      if (plan === "clock") this.#clockLayers.push(id);
      else clips.set(id, plan);
    }
    this.#drawn = motionOf(frame);
    const origin = this.#now() - from.time;
    this.#origin = origin;
    this.#target.playMotion(clips, origin);
    this.#loop();
  }

  /** A click: the next step starts now. False when the slide has no more steps. */
  next(): boolean {
    const position = this.position;
    if (position.clicks.length >= this.steps.length - 1) return false;
    const clicked = { time: position.time, clicks: [...position.clicks, position.time] };
    if (this.playing) this.play(clicked);
    else this.seekTo(clicked);
    return true;
  }

  /**
   * Freeze where it is (or at slide time `at`): the compositor holds its frame, the main
   * thread draws the rest of that moment. `play()` carries on from there.
   */
  pause(at?: number): PlayPosition {
    const position = { ...this.position, ...(at !== undefined && { time: at }) };
    if (!this.playing) {
      this.seekTo(position);
      return position;
    }
    this.#cancelFrame();
    this.#target.pauseMotion(position.time);
    this.#tick(position);
    this.#origin = null;
    this.#position = position;
    return position;
  }

  dispose(): void {
    this.#stopPlaying();
    this.#compiled = null;
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────

  #compile(deck: Deck, slide: Slide): CompiledSlide {
    const { effects } = this.#options;
    const target = this.#target;
    const measure = target.measureLayout;
    return compileSlide(deck, slide, {
      ...(effects && { effects }),
      ...(measure &&
        this.#needsLayout(slide) && { layout: (absent) => measure.call(target, absent) }),
    });
  }

  /** Whether any of the slide's animations makes a layer join or leave the layout. */
  #needsLayout(slide: Slide): boolean {
    return (slide.animations ?? []).some((a) => a.space !== undefined);
  }

  /** The same slide, measured again (after fonts loaded): carry on from where it is. */
  #remeasure(slide: Slide): void {
    if (this.#slide !== slide || !this.#deck) return;
    const playing = this.playing;
    const position = this.position;
    this.#compiled = this.#compile(this.#deck, slide);
    if (playing) this.play(position);
    else this.#draw(position);
  }

  #now(): number {
    return (this.#options.now ?? timelineNow)();
  }

  /** Everything at one moment, on the main thread. */
  #draw(position: PlayPosition): SlideFrame {
    const frame = this.#compiled?.at(position) ?? new Map();
    this.#target.setMotion(motionOf(frame));
    this.#drawProperties(frame);
    this.#target.seek(position.time / 1000);
    return frame;
  }

  /** While playing: what the compositor doesn't do, for this moment. */
  #tick(position: PlayPosition): void {
    const compiled = this.#compiled;
    if (!compiled) return;
    if (this.#clockLayers.length > 0) {
      for (const id of this.#clockLayers) {
        this.#drawn.set(id, compiled.layerAt(id, position)?.motion ?? {});
      }
      this.#target.setMotion(this.#drawn);
    }
    if (this.#propertyTracks) this.#drawProperties(compiled.at(position));
    this.#target.seek(position.time / 1000);
  }

  #drawProperties(frame: SlideFrame): void {
    const deck = this.#deck;
    const slide = this.#slide;
    if (!deck || !slide || (!this.#patched && !hasProperties(frame))) return;
    const patched = withProperties(slide, frame);
    this.#target.render(
      { ...deck, slides: deck.slides.map((s) => (s === slide ? patched : s)) },
      slide.id,
    );
    this.#patched = patched !== slide;
  }

  #loop(): void {
    const request = this.#options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    const step = () => {
      if (this.#origin === null) return;
      this.#tick(this.position);
      this.#frame = request(step);
    };
    this.#frame = request(step);
  }

  #cancelFrame(): void {
    if (this.#frame === null) return;
    (this.#options.cancelFrame ?? ((h) => cancelAnimationFrame(h)))(this.#frame);
    this.#frame = null;
  }

  #stopPlaying(): void {
    this.#cancelFrame();
    this.#origin = null;
    this.#clockLayers = [];
    this.#target.stopMotion();
  }
}
