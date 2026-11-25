/**
 * Playing a slide transition (D123) between two views: the leaving slide underneath, the
 * arriving one on top, each in its own frame (an element holding the view, moved, scaled
 * and faded as the whole slide).
 *
 * Core says what's drawn at every moment (`compileTransition`); this draws it:
 *
 * - **Seeking** draws one moment on the main thread: frames get inline styles, morphing
 *   layers their motion through `setMotion`. Frame-exact (tests, screenshots).
 * - **Playing** samples the same moments into Web Animations on the frames and, for a
 *   morph, into motion clips on the layers, so the compositor plays it however busy the
 *   main thread is (D107), on the timeline everything else plays on.
 *
 * A morph fades the arriving slide's background in behind its layers on a backdrop (the
 * stage's own background is lifted off meanwhile), so the travelling layers stay solid.
 * Once it ends (or is finished early), everything it touched is put back: the frames, the
 * stage's background, the layers' motion as the slides' own players drew it.
 */
import {
  type CompiledTransition,
  compileTransition,
  type Deck,
  isRestMotion,
  type LayerTween,
  type MotionClip,
  type MotionState,
  planMorph,
  type SlideTween,
  transitionInto,
  transitionTimes,
} from "@veloce/core";
import type { SlideView } from "./slide-view.js";

/** One side of a transition. */
export interface TransitionSide {
  view: SlideView;
  /** The element moved, scaled and faded as the whole slide (the view's viewport). */
  frame: HTMLElement;
  /**
   * The slide's own motion while the transition plays: the leaving slide where it stopped,
   * the arriving one as it appears (entrances still to come hidden). Layers it moves or
   * hides aren't morphed.
   */
  motion: ReadonlyMap<string, MotionState>;
}

export interface SlideTransitionOptions {
  /** Milliseconds on the timeline Web Animations use. Default: `document.timeline`. */
  now?: () => number;
}

const timelineNow = () => Number(document.timeline.currentTime ?? performance.now());

/** Layers the slide's own motion moves or hides at that moment. */
const movingIds = (motion: ReadonlyMap<string, MotionState>) =>
  new Set([...motion].filter(([, m]) => !isRestMotion(m)).map(([id]) => id));

/**
 * The transition `toId` arrives with after `fromId`, ready to play over the two sides, or
 * null when it cuts. Both slides must be rendered in their views (a morph measures them).
 */
export function createSlideTransition(
  deck: Deck,
  fromId: string,
  toId: string,
  from: TransitionSide,
  to: TransitionSide,
  options: SlideTransitionOptions = {},
): SlideTransition | null {
  const fromSlide = deck.slides.find((s) => s.id === fromId);
  const toSlide = deck.slides.find((s) => s.id === toId);
  if (!fromSlide || !toSlide) return null;
  const resolved = transitionInto(deck, toSlide);
  if (!resolved) return null;
  const morph =
    resolved.type === "morph"
      ? planMorph({
          from: fromSlide,
          to: toSlide,
          boxes: { from: from.view.measureBoxes(), to: to.view.measureBoxes() },
          moving: { from: movingIds(from.motion), to: movingIds(to.motion) },
        })
      : undefined;
  return new SlideTransition(compileTransition(resolved, deck.stage, morph), from, to, options);
}

export class SlideTransition {
  readonly compiled: CompiledTransition;
  readonly #from: TransitionSide;
  readonly #to: TransitionSide;
  readonly #options: SlideTransitionOptions;
  /** Morph: the arriving background, faded in under its layers. */
  #backdrop: HTMLElement | null = null;
  #stageBackground = "";
  #animations: Animation[] = [];
  #done = false;
  #resolve: (() => void) | null = null;

  constructor(
    compiled: CompiledTransition,
    from: TransitionSide,
    to: TransitionSide,
    options: SlideTransitionOptions = {},
  ) {
    this.compiled = compiled;
    this.#from = from;
    this.#to = to;
    this.#options = options;
    if (this.#morph) this.#liftBackground();
  }

  get duration(): number {
    return this.compiled.transition.duration;
  }

  get #morph(): boolean {
    return this.compiled.transition.type === "morph";
  }

  /** Draw `time` ms into the transition on the main thread; stops playing. */
  seek(time: number): void {
    this.#stopAnimations();
    const frame = this.compiled.at(time);
    applyTween(this.#from.frame, frame.from, this.#from.view.scale);
    applyTween(this.#to.frame, frame.to, this.#to.view.scale);
    if (this.#backdrop) this.#backdrop.style.opacity = String(frame.backdrop ?? 1);
    if (frame.layers) {
      this.#from.view.setMotion(merged(this.#from.motion, frame.layers.from));
      this.#to.view.setMotion(merged(this.#to.motion, frame.layers.to));
    }
  }

  /** Play it on the compositor. Resolves once it has ended (or `finish()` ended it). */
  play(): Promise<void> {
    const origin = (this.#options.now ?? timelineNow)();
    this.seek(0); // the first frame on the main thread, for what no clip changes
    const times = transitionTimes(this.duration);
    const frames = times.map((t) => this.compiled.at(t));
    const animate = (el: HTMLElement, keyframes: Keyframe[]) => {
      const animation = el.animate(keyframes, {
        duration: this.duration,
        easing: "linear",
        fill: "forwards",
      });
      animation.startTime = origin;
      this.#animations.push(animation);
      return animation;
    };
    const offsets = (css: (i: number) => Keyframe) =>
      times.map((t, i) => ({ ...css(i), offset: t / this.duration }));
    // The whole slides (a morph leaves them put).
    if (!this.#morph) {
      animate(
        this.#from.frame,
        offsets((i) => tweenCss(at(frames, i).from, this.#from.view.scale)),
      );
      animate(
        this.#to.frame,
        offsets((i) => tweenCss(at(frames, i).to, this.#to.view.scale)),
      );
    }
    if (this.#backdrop) {
      animate(
        this.#backdrop,
        offsets((i) => ({ opacity: String(at(frames, i).backdrop ?? 1) })),
      );
    }
    if (this.#morph) {
      for (const side of ["from", "to"] as const) {
        const clips = new Map<string, MotionClip[]>();
        for (const id of at(frames, 0).layers?.[side].keys() ?? []) {
          const states = frames.map((f) => motionState(f.layers?.[side].get(id)));
          clips.set(id, [{ start: 0, times, states, loop: false }]);
        }
        this.#side(side).view.playMotion(clips, origin);
      }
    }
    // One clock for its end, whatever it animates.
    const clock = animate(this.#to.frame, []);
    return new Promise<void>((resolve) => {
      this.#resolve = resolve;
      clock.finished.then(
        () => this.finish(),
        () => {}, // cancelled: finish() already ran
      );
    });
  }

  /** End it now (a click while it plays): the arriving slide as it lands; resolves `play()`. */
  finish(): void {
    if (this.#done) return;
    this.#done = true;
    this.#stopAnimations();
    for (const side of [this.#from, this.#to]) {
      clearTween(side.frame);
      side.view.stopMotion();
      side.view.setMotion(side.motion);
    }
    if (this.#backdrop) {
      this.#to.view.stage.style.background = this.#stageBackground;
      this.#backdrop.remove();
      this.#backdrop = null;
    }
    this.#resolve?.();
    this.#resolve = null;
  }

  #side(side: "from" | "to"): TransitionSide {
    return side === "from" ? this.#from : this.#to;
  }

  /**
   * Morph: the arriving stage's background moves to a backdrop under its layers (z-index
   * −1 inside the stage, which the camera's transform makes a stacking context), to fade in.
   */
  #liftBackground(): void {
    const stage = this.#to.view.stage;
    const backdrop = stage.ownerDocument.createElement("div");
    backdrop.dataset.transitionBackdrop = "";
    this.#stageBackground = stage.style.background;
    Object.assign(backdrop.style, {
      position: "absolute",
      inset: "0",
      zIndex: "-1",
      pointerEvents: "none",
      background: this.#stageBackground,
      opacity: "0",
    });
    stage.style.background = "transparent";
    stage.append(backdrop);
    this.#backdrop = backdrop;
  }

  #stopAnimations(): void {
    for (const animation of this.#animations) animation.cancel();
    this.#animations = [];
  }
}

const at = <T>(list: readonly T[], i: number) => list[i] as T;

/** The slide's own motion with the morph's on top (they never share a layer). */
function merged(
  own: ReadonlyMap<string, MotionState>,
  morph: ReadonlyMap<string, LayerTween>,
): Map<string, MotionState> {
  const out = new Map(own);
  for (const [id, tween] of morph) out.set(id, motionState(tween));
  return out;
}

function motionState(t: LayerTween | undefined): MotionState {
  if (!t) return {};
  return {
    x: t.x,
    y: t.y,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    rotate: t.rotate,
    opacity: t.opacity,
  };
}

/** A whole slide's tween as CSS on its frame: stage pixels become screen pixels. */
function tweenCss(t: SlideTween, scale: number): Keyframe {
  const x = Math.round(t.x * scale * 100) / 100;
  const y = Math.round(t.y * scale * 100) / 100;
  return {
    transform: `translate(${x}px, ${y}px) scale(${Math.round(t.scale * 10_000) / 10_000})`,
    opacity: String(Math.round(t.opacity * 10_000) / 10_000),
  };
}

function applyTween(el: HTMLElement, t: SlideTween, scale: number): void {
  const css = tweenCss(t, scale);
  el.style.transform = String(css.transform);
  el.style.opacity = String(css.opacity);
}

function clearTween(el: HTMLElement): void {
  el.style.transform = "";
  el.style.opacity = "";
}
