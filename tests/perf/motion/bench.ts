/**
 * Motion benchmark page (D104 §4). Renders one busy slide with the real renderer and plays the
 * same animation on every layer in one of two ways:
 *
 * - `main`: the main thread evaluates every layer's motion each frame and draws it through
 *   `SlideRenderer.setMotion` (the motion slot, D103), the way a timeline would.
 * - `compositor`: the same motion is sampled into keyframes once, composed by the renderer's
 *   own `drawnCss`, and handed to the browser with the Web Animations API, which plays
 *   transform and opacity on the compositor thread.
 *
 * `longTasks` blocks the main thread for 250 ms every second, standing in for the app doing
 * something heavy while a slide plays: autosave serializing a big deck, a React re-render, a
 * plugin mounting, an image decoding. (Short repeated tasks barely matter: Chrome fits frames
 * between them, measured while writing this.)
 *
 * Driven by `run.ts`; nothing here is shipped.
 */
import { createBuiltinRegistry } from "@veloce/builtins";
import {
  createDeck,
  createSlide,
  type Deck,
  element,
  type MotionState,
  type Node,
} from "@veloce/core";
import { drawnCss, NODE_ID_ATTR, SlideRenderer } from "@veloce/renderer";

/** One loop of the animation, and how far each layer starts behind the one before it. */
const LOOP_MS = 2000;
const STAGGER_MS = 37;
/** Keyframes sampled per loop for the compositor path; linear between them. */
const SAMPLES = 32;

export interface SetupOptions {
  layers: number;
  /** Every n-th layer also blurs while it moves (0: none). */
  blurEvery: number;
}

export interface RunOptions {
  mode: "main" | "compositor";
  longTasks: boolean;
}

export interface PageStats {
  /** Frames the main thread drew motion in (main mode). */
  motionFrames: number;
  /** Longest wait between two of those frames, in ms (main mode). */
  longestMotionGapMs: number;
  /** Time spent evaluating and drawing motion per frame, in ms (main mode). */
  motionMs: number[];
  /** Web animations running (compositor mode). */
  animations: number;
  durationMs: number;
}

const stage = document.createElement("div");
document.body.append(stage);
const renderer = new SlideRenderer(stage, {
  registry: createBuiltinRegistry(),
  assetUrl: (id) => id,
  onPluginError: (error) => console.error(error),
});

let layers: Node[] = [];
let blurEvery = 0;

/** A slide of `count` layers in a loose grid: two shapes for every text label. */
function benchDeck(count: number): Deck {
  const columns = Math.ceil(Math.sqrt(count * (16 / 9)));
  const cell = 1920 / columns;
  const children: Node[] = [];
  for (let i = 0; i < count; i++) {
    const position = { x: (i % columns) * cell + 4, y: Math.floor(i / columns) * cell + 4 };
    const size = { width: cell - 8, height: cell - 8 };
    children.push(
      i % 3 === 2
        ? element("text", { content: `Item ${i}`, style: "$text.small" }, { position, ...size })
        : element(
            "shape",
            {
              shape: i % 2 ? "ellipse" : "rect",
              fill: i % 2 ? "$color.accent" : "$color.primary",
              radius: 8,
            },
            { position, ...size },
          ),
    );
  }
  const slide = createSlide({ id: "bench", layout: { mode: "absolute" }, children });
  return createDeck({ title: "Motion benchmark", slides: [slide] });
}

/** Where layer `i` is at time `t`: a smooth there-and-back move, turn, grow and fade. */
function motionAt(i: number, t: number): MotionState {
  const phase = (((t + i * STAGGER_MS) % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const p = 0.5 - 0.5 * Math.cos((2 * Math.PI * phase) / LOOP_MS);
  const motion: MotionState = {
    x: 40 * p,
    y: -24 * p,
    rotate: 90 * p,
    scale: 1 + 0.3 * p,
    opacity: 1 - 0.6 * p,
  };
  if (blurEvery > 0 && i % blurEvery === 0) motion.blur = 6 * p;
  return motion;
}

function layerElement(node: Node): HTMLElement {
  const el = stage.querySelector<HTMLElement>(`[${NODE_ID_ATTR}="${node.id}"]`);
  if (!el) throw new Error(`Layer ${node.id} isn't drawn`);
  return el;
}

/**
 * The renderer's own CSS for a motion, as a Web Animations keyframe. `filter` only on layers
 * that blur: animating `filter: none` would still make Chrome build a filter effect per layer.
 */
function keyframe(node: Node, motion: MotionState, blurs: boolean): Keyframe {
  const css = drawnCss(node, null, motion);
  const frame: Keyframe = { transform: css.transform ?? "none", opacity: css.opacity ?? "1" };
  if (blurs) frame.filter = css.filter ?? "blur(0px)";
  return frame;
}

let stopRun: (() => PageStats) | null = null;

function startLongTasks(): () => void {
  const timer = setInterval(() => {
    const until = performance.now() + 250;
    while (performance.now() < until) {
      /* the app doing something heavy */
    }
  }, 1000);
  return () => clearInterval(timer);
}

const bench = {
  async setup(options: SetupOptions): Promise<number> {
    blurEvery = options.blurEvery;
    const deck = benchDeck(options.layers);
    renderer.render(deck, "bench");
    await renderer.ready();
    layers = deck.slides[0]?.root.kind === "frame" ? deck.slides[0].root.children : [];
    return layers.length;
  },

  start(options: RunOptions): void {
    const begin = performance.now();
    const stopBusy = options.longTasks ? startLongTasks() : () => {};
    if (options.mode === "main") {
      const motionMs: number[] = [];
      let raf = 0;
      let last = 0;
      let longestGap = 0;
      const frame = (now: number) => {
        if (last) longestGap = Math.max(longestGap, now - last);
        last = now;
        const t0 = performance.now();
        const motion = new Map<string, MotionState>();
        layers.forEach((node, i) => {
          motion.set(node.id, motionAt(i, now - begin));
        });
        renderer.setMotion(motion);
        motionMs.push(performance.now() - t0);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      stopRun = () => {
        cancelAnimationFrame(raf);
        stopBusy();
        renderer.setMotion(new Map());
        const durationMs = performance.now() - begin;
        return {
          motionFrames: motionMs.length,
          longestMotionGapMs: longestGap,
          motionMs,
          animations: 0,
          durationMs,
        };
      };
      return;
    }
    const animations = layers.map((node, i) => {
      const frames: Keyframe[] = [];
      const blurs = blurEvery > 0 && i % blurEvery === 0;
      for (let k = 0; k <= SAMPLES; k++)
        frames.push(keyframe(node, motionAt(i, (k / SAMPLES) * LOOP_MS), blurs));
      return layerElement(node).animate(frames, {
        duration: LOOP_MS,
        iterations: Number.POSITIVE_INFINITY,
        delay: -((i * STAGGER_MS) % LOOP_MS),
      });
    });
    stopRun = () => {
      const running = document.getAnimations().filter((a) => a.playState === "running").length;
      for (const a of animations) a.cancel();
      stopBusy();
      const durationMs = performance.now() - begin;
      return {
        motionFrames: 0,
        longestMotionGapMs: 0,
        motionMs: [],
        animations: running,
        durationMs,
      };
    };
  },

  stop(): PageStats {
    if (!stopRun) throw new Error("Nothing is running");
    const stats = stopRun();
    stopRun = null;
    return stats;
  },
};

Object.assign(window, { bench });
export type Bench = typeof bench;
