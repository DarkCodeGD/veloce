/**
 * Playing animation on the editor's canvas (D106 §2, D118): the Animate panel's Play (the
 * whole slide, clicks taken for you) and its previews (one effect on the selection, once
 * or looping while the pointer rests on it). Never ops: the canvas draws motion on top of
 * the document and goes back to it at rest when it ends, so nothing enters undo.
 *
 * `CanvasPlayback` sequences a `SlidePlayer` (D115) on the canvas's own view; the canvas
 * registers it here, and the panel asks for playback through `playOnCanvas`, so neither
 * holds the other.
 */
import type { Deck } from "@veloce/core";
import { useSyncExternalStore } from "react";

/** What to play: the whole slide, step after step, or a preview once or on a loop. */
export interface PlaybackRequest {
  deck: Deck;
  slideId: string;
  mode: "slide" | "once" | "loop";
}

/** The `SlidePlayer` calls playback uses. */
export interface PlaybackPlayer {
  readonly steps: ReadonlyArray<{ duration: number }>;
  load(deck: Deck, slideId: string): void;
  play(): void;
  next(): boolean;
  unload(): void;
}

export interface PlaybackTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** A beat between steps, as if someone clicked; and how long the end stays before it goes. */
export const STEP_GAP_MS = 400;
export const END_HOLD_MS = 700;

const browserTimers: PlaybackTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class CanvasPlayback {
  readonly #player: PlaybackPlayer;
  readonly #timers: PlaybackTimers;
  readonly #onChange: (mode: PlaybackRequest["mode"] | null) => void;
  #timer: unknown = null;
  #request: PlaybackRequest | null = null;

  constructor(
    player: PlaybackPlayer,
    onChange: (mode: PlaybackRequest["mode"] | null) => void,
    timers: PlaybackTimers = browserTimers,
  ) {
    this.#player = player;
    this.#onChange = onChange;
    this.#timers = timers;
  }

  get mode(): PlaybackRequest["mode"] | null {
    return this.#request?.mode ?? null;
  }

  start(request: PlaybackRequest): void {
    this.#clearTimer();
    this.#request = request;
    this.#onChange(request.mode);
    this.#run(request);
  }

  /** Back to the slide at rest. */
  stop(): void {
    this.#clearTimer();
    if (!this.#request) return;
    this.#request = null;
    this.#player.unload();
    this.#onChange(null);
  }

  #run(request: PlaybackRequest): void {
    this.#player.load(request.deck, request.slideId);
    this.#player.play();
    this.#after(0, request);
  }

  /** Once `step` has played out: the next click, a loop, or the end. */
  #after(step: number, request: PlaybackRequest): void {
    const steps = this.#player.steps;
    const duration = steps[step]?.duration ?? 0;
    if (step < steps.length - 1) {
      // Nothing plays as the slide appears: the first click comes at once.
      const wait = step === 0 && duration === 0 ? 0 : duration + STEP_GAP_MS;
      this.#wait(wait, () => {
        this.#player.next();
        this.#after(step + 1, request);
      });
      return;
    }
    this.#wait(duration + END_HOLD_MS, () => {
      if (request.mode === "loop") this.#run(request);
      else this.stop();
    });
  }

  #wait(ms: number, then: () => void): void {
    this.#timer = this.#timers.set(() => {
      this.#timer = null;
      then();
    }, ms);
  }

  #clearTimer(): void {
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
  }
}

// ── The canvas's playback, for the panel ──────────────────────────────────────────────

let current: CanvasPlayback | null = null;
let mode: PlaybackRequest["mode"] | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** The canvas registers its playback while it's mounted (null when it goes). */
export function setCanvasPlayback(playback: CanvasPlayback | null): void {
  current = playback;
  mode = playback?.mode ?? null;
  notify();
}

/** Called by the canvas's playback when it starts or stops. */
export function playbackChanged(next: PlaybackRequest["mode"] | null): void {
  if (next === mode) return;
  mode = next;
  notify();
}

export const playOnCanvas = (request: PlaybackRequest): void => current?.start(request);
export const stopOnCanvas = (): void => current?.stop();

/** What the canvas is playing now, re-rendering when that changes. */
export function useCanvasPlayback(): PlaybackRequest["mode"] | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => mode,
  );
}
