/**
 * Built-in effect presets (D117): entrances, exits and emphasis for any layer, through the
 * public plugin API like any third-party effect (golden rule 6).
 *
 * Each turns into ordinary keyframe tracks (D110), so the clock plays them, the compositor
 * runs them (D115) and the timeline panel can open them up later. **The motion level shapes
 * them** (D111): how far a slide travels, how small a scale-in starts, how hard a pop
 * bounces and how much a shake moves all follow `tokens.distance`, and durations and easings
 * are `$motion` tokens, so a calm deck glides a little and an absurd one flies. A number an
 * agent or person gives (`distance: 200`) is used as given, never scaled.
 *
 * Entrances land where the layer rests and emphasis returns there (the conformance kit
 * checks it), so effects stack with each other and with the layout. Exits leave the layer
 * where they end (hidden, moved away) until the slide changes.
 */
import { type Easing, MOTION_LEVEL_SCALES, type MotionTokens, type Tracks } from "@veloce/core";
import { defineEffect, definePlugin, type EffectDefinition, z } from "@veloce/plugin-api";

/** How far things travel at `subtle`, in stage pixels: the level multiplies it. */
const TRAVEL = 80;

const DirectionSchema = z
  .enum(["up", "down", "left", "right"])
  .describe("Which way the layer moves");
const FadeSchema = z.boolean().describe("Also fade (default true)");
const PixelsSchema = (what: string) =>
  z.number().min(0).max(10_000).describe(`${what}, in stage pixels (default: set by the level)`);

type Direction = z.infer<typeof DirectionSchema>;

/** The motion channel and sign of a move in `direction`. */
function axis(direction: Direction): { channel: "x" | "y"; sign: 1 | -1 } {
  return {
    up: { channel: "y", sign: -1 },
    down: { channel: "y", sign: 1 },
    left: { channel: "x", sign: -1 },
    right: { channel: "x", sign: 1 },
  }[direction] as { channel: "x" | "y"; sign: 1 | -1 };
}

/** `value` rounded to 3 decimals: tidy tracks, and the same numbers on every machine. */
const round = (value: number) => Math.round(value * 1000) / 1000;

/** At the start (entrances) or the end (exits). */
type End = 0 | 1;
const ENTER: End = 0;
const EXIT: End = 1;

/** One keyframe at an end of the animation; the other end is the layer's own value. */
const at = (end: End, value: number) => [{ at: end, value: round(value) }];

/** An opacity track to or from 0, if `fade`. */
const fade = (end: End, on: boolean | undefined): Tracks =>
  on === false ? {} : { opacity: at(end, 0) };

const ENTRANCE = { duration: "$motion.normal", easing: "$motion.enter" } as const;
const EXITING = { duration: "$motion.fast", easing: "$motion.exit" } as const;
const EMPHASIS = { duration: "$motion.slow", easing: "$motion.move" } as const;

/** A spring whose bounce follows the level: `calm` lands without one (D111 §4). */
function levelSpring(tokens: MotionTokens, bounce: number): Easing {
  return {
    spring: { bounce: round(Math.min(1, bounce * MOTION_LEVEL_SCALES[tokens.level].bounce)) },
  };
}

// ── Entrances and exits ──────────────────────────────────────────────────────────────

const fadeIn = defineEffect({
  name: "fade-in",
  title: "Fade in",
  description: "Fades the layer in where it is.",
  kind: "entrance",
  paramsSchema: z.strictObject({}),
  defaultParams: {},
  aiDocs:
    "Fades in where it rests. The quietest entrance: right at every level, the one for `calm`.",
  resolve: () => ({ ...ENTRANCE, tracks: fade(ENTER, true) }),
});

const fadeOut = defineEffect({
  name: "fade-out",
  title: "Fade out",
  description: "Fades the layer out where it is.",
  kind: "exit",
  paramsSchema: z.strictObject({}),
  defaultParams: {},
  aiDocs: "Fades out where it is; it stays hidden until the slide changes.",
  resolve: () => ({ ...EXITING, tracks: fade(EXIT, true) }),
});

const SlideParams = z.strictObject({
  direction: DirectionSchema.optional(),
  distance: PixelsSchema("How far it travels").optional(),
  fade: FadeSchema.optional(),
});
type SlideParams = z.infer<typeof SlideParams>;

function slideTracks(end: End, p: SlideParams, tokens: MotionTokens): Tracks {
  const { channel, sign } = axis(p.direction ?? "up");
  const distance = p.distance ?? TRAVEL * tokens.distance;
  // Entering while moving up starts below (+y); leaving while moving down ends below.
  const offset = end === ENTER ? -sign * distance : sign * distance;
  return { [channel]: at(end, offset), ...fade(end, p.fade) };
}

const slideIn = defineEffect<SlideParams>({
  name: "slide-in",
  title: "Slide in",
  description: "Slides the layer into place, fading in.",
  kind: "entrance",
  paramsSchema: SlideParams,
  defaultParams: { direction: "up", fade: true },
  aiDocs:
    'Moves into place from a little way off, fading in. `direction` is the way it moves: "up" (default) rises from below, "left" comes in from the right. `distance` in stage pixels; by default 80 at `subtle`, 40 at `calm`, 320 at `absurd`.',
  resolve: (p, { tokens }) => ({ ...ENTRANCE, tracks: slideTracks(ENTER, p, tokens) }),
});

const slideOut = defineEffect<SlideParams>({
  name: "slide-out",
  title: "Slide out",
  description: "Slides the layer away, fading out.",
  kind: "exit",
  paramsSchema: SlideParams,
  defaultParams: { direction: "down", fade: true },
  aiDocs:
    'Moves away and fades out. `direction` is the way it leaves: "down" (default), "up", "left", "right". `distance` as in slide-in.',
  resolve: (p, { tokens }) => ({ ...EXITING, tracks: slideTracks(EXIT, p, tokens) }),
});

const ScaleParams = z.strictObject({
  scale: z
    .number()
    .min(0)
    .max(20)
    .describe("The size it starts from or ends at (1 is its own; default: set by the level)")
    .optional(),
  fade: FadeSchema.optional(),
});
type ScaleParams = z.infer<typeof ScaleParams>;

/** Smaller than its own size, by the level: 0.85 at `subtle`, 0.4 at `absurd`. */
const smaller = (tokens: MotionTokens) => Math.max(0.05, 1 - 0.15 * tokens.distance);
/** Bigger than its own size, by the level: 1.25 at `subtle`, 2 at `absurd`. */
const bigger = (tokens: MotionTokens) => 1 + 0.25 * tokens.distance;

const scaleIn = defineEffect<ScaleParams>({
  name: "scale-in",
  title: "Scale in",
  description: "Grows to its size from a little smaller, fading in.",
  kind: "entrance",
  paramsSchema: ScaleParams,
  defaultParams: { fade: true },
  aiDocs:
    "Grows into its size, fading in. `scale` is where it starts (default 0.85 at `subtle`, smaller at wilder levels).",
  resolve: (p, { tokens }) => ({
    ...ENTRANCE,
    tracks: { scale: at(ENTER, p.scale ?? smaller(tokens)), ...fade(ENTER, p.fade) },
  }),
});

const scaleOut = defineEffect<ScaleParams>({
  name: "scale-out",
  title: "Scale out",
  description: "Shrinks away, fading out.",
  kind: "exit",
  paramsSchema: ScaleParams,
  defaultParams: { fade: true },
  aiDocs: "Shrinks and fades out. `scale` is where it ends (default 0.85 at `subtle`).",
  resolve: (p, { tokens }) => ({
    ...EXITING,
    tracks: { scale: at(EXIT, p.scale ?? smaller(tokens)), ...fade(EXIT, p.fade) },
  }),
});

const zoomIn = defineEffect<ScaleParams>({
  name: "zoom-in",
  title: "Zoom in",
  description: "Comes down to its size from bigger, fading in, as if from the viewer.",
  kind: "entrance",
  paramsSchema: ScaleParams,
  defaultParams: { fade: true },
  aiDocs:
    "Lands from bigger (towards the viewer), fading in: a title's arrival. `scale` is where it starts (default 1.25 at `subtle`, 2 at `absurd`).",
  resolve: (p, { tokens }) => ({
    ...ENTRANCE,
    tracks: { scale: at(ENTER, p.scale ?? bigger(tokens)), ...fade(ENTER, p.fade) },
  }),
});

const zoomOut = defineEffect<ScaleParams>({
  name: "zoom-out",
  title: "Zoom out",
  description: "Grows past its size and fades away, towards the viewer.",
  kind: "exit",
  paramsSchema: ScaleParams,
  defaultParams: { fade: true },
  aiDocs:
    "Grows and fades out, as if flying past the viewer. `scale` is where it ends (default 1.25 at `subtle`).",
  resolve: (p, { tokens }) => ({
    ...EXITING,
    tracks: { scale: at(EXIT, p.scale ?? bigger(tokens)), ...fade(EXIT, p.fade) },
  }),
});

const PopParams = z.strictObject({
  bounce: z
    .number()
    .min(0)
    .max(1)
    .describe("How much it overshoots, 0 to 1 (default 0.4, scaled by the level)")
    .optional(),
});
type PopParams = z.infer<typeof PopParams>;

const popIn = defineEffect<PopParams>({
  name: "pop-in",
  title: "Pop in",
  description: "Springs up from small, overshooting a little.",
  kind: "entrance",
  paramsSchema: PopParams,
  defaultParams: {},
  aiDocs:
    "Springs up from small and settles with a bounce: badges, icons, numbers, playful moments. The level sets how small it starts and how much it bounces; at `calm` it doesn't bounce at all. `bounce` 0 to 1 overrides it.",
  resolve: (p, { tokens }) => ({
    duration: "$motion.normal",
    easing: p.bounce !== undefined ? { spring: { bounce: p.bounce } } : levelSpring(tokens, 0.4),
    tracks: {
      scale: at(ENTER, Math.max(0, 1 - 0.5 * tokens.distance)),
      // The fade doesn't spring: it's in before the bounce.
      opacity: [{ at: 0, value: 0, easing: "$motion.enter" }],
    },
  }),
});

const BlurParams = z.strictObject({
  blur: PixelsSchema("How blurred it starts or ends").optional(),
  fade: FadeSchema.optional(),
});
type BlurParams = z.infer<typeof BlurParams>;

const blurIn = defineEffect<BlurParams>({
  name: "blur-in",
  title: "Blur in",
  description: "Comes into focus, fading in.",
  kind: "entrance",
  paramsSchema: BlurParams,
  defaultParams: { fade: true },
  aiDocs:
    "Sharpens into focus while fading in: soft, cinematic. `blur` in pixels (default 8 at `subtle`). Blur costs the GPU: keep it to a few layers at once.",
  resolve: (p, { tokens }) => ({
    ...ENTRANCE,
    tracks: { blur: at(ENTER, p.blur ?? 8 * tokens.distance), ...fade(ENTER, p.fade) },
  }),
});

const blurOut = defineEffect<BlurParams>({
  name: "blur-out",
  title: "Blur out",
  description: "Goes out of focus, fading out.",
  kind: "exit",
  paramsSchema: BlurParams,
  defaultParams: { fade: true },
  aiDocs: "Blurs away while fading out. `blur` in pixels (default 8 at `subtle`).",
  resolve: (p, { tokens }) => ({
    ...EXITING,
    tracks: { blur: at(EXIT, p.blur ?? 8 * tokens.distance), ...fade(EXIT, p.fade) },
  }),
});

const FlipParams = z.strictObject({
  axis: z
    .enum(["x", "y"])
    .describe('"x" tips over a horizontal line, "y" turns like a door')
    .optional(),
  angle: z
    .number()
    .min(0)
    .max(180)
    .describe("Degrees (default: set by the level, 45 at subtle)")
    .optional(),
  fade: FadeSchema.optional(),
});
type FlipParams = z.infer<typeof FlipParams>;

function flipTracks(end: End, p: FlipParams, tokens: MotionTokens): Tracks {
  const angle = p.angle ?? Math.min(90, 45 * tokens.distance);
  const channel = p.axis === "y" ? "rotateY" : "rotateX";
  return { [channel]: at(end, end === ENTER ? -angle : angle), ...fade(end, p.fade) };
}

const FLIP_DOCS =
  'Turns in 3D. `axis` "x" (default) tips over a horizontal line, "y" turns like a door; `angle` in degrees (45 at `subtle`, 90 from `intense`). It looks 3D inside a frame with `perspective` (the slide\'s root frame counts); without one it reads as a squash.';

const flipIn = defineEffect<FlipParams>({
  name: "flip-in",
  title: "Flip in",
  description: "Turns into place in 3D, fading in.",
  kind: "entrance",
  paramsSchema: FlipParams,
  defaultParams: { axis: "x", fade: true },
  aiDocs: `Turns into place, fading in. ${FLIP_DOCS}`,
  resolve: (p, { tokens }) => ({ ...ENTRANCE, tracks: flipTracks(ENTER, p, tokens) }),
});

const flipOut = defineEffect<FlipParams>({
  name: "flip-out",
  title: "Flip out",
  description: "Turns away in 3D, fading out.",
  kind: "exit",
  paramsSchema: FlipParams,
  defaultParams: { axis: "x", fade: true },
  aiDocs: `Turns away, fading out. ${FLIP_DOCS}`,
  resolve: (p, { tokens }) => ({ ...EXITING, tracks: flipTracks(EXIT, p, tokens) }),
});

// ── Emphasis ─────────────────────────────────────────────────────────────────────────

const LOOP_TIP =
  'Loop it with `"repeat": "forever"` for ambient motion (lively and wilder levels).';

const PulseParams = z.strictObject({
  scale: z
    .number()
    .min(0.1)
    .max(10)
    .describe("Its size at the peak (default 1.06 at subtle, by the level)")
    .optional(),
});
type PulseParams = z.infer<typeof PulseParams>;

const pulse = defineEffect<PulseParams>({
  name: "pulse",
  title: "Pulse",
  description: "Swells a little and settles back.",
  kind: "emphasis",
  paramsSchema: PulseParams,
  defaultParams: {},
  aiDocs: `Swells and settles back once: draws the eye to a number or a call to action. \`scale\` at the peak (default 1.06 at \`subtle\`, 1.24 at \`absurd\`). ${LOOP_TIP}`,
  resolve: (p, { tokens }) => ({
    ...EMPHASIS,
    tracks: { scale: [{ at: 0.5, value: round(p.scale ?? 1 + 0.06 * tokens.distance) }] },
  }),
});

const AmountParams = (what: string) => z.strictObject({ distance: PixelsSchema(what).optional() });
type AmountParams = z.infer<ReturnType<typeof AmountParams>>;

/** Back and forth, dying down: offsets as fractions of the amount. */
const SHAKE = [-1, 1, -0.8, 0.8, -0.5, 0.3];

const shake = defineEffect<AmountParams>({
  name: "shake",
  title: "Shake",
  description: "Shakes side to side: no, wrong, look here.",
  kind: "emphasis",
  paramsSchema: AmountParams("How far it shakes each way"),
  defaultParams: {},
  aiDocs:
    "Shakes side to side and stops: a warning, a wrong answer, a nudge. `distance` each way in stage pixels (default 8 at `subtle`).",
  resolve: (p, { tokens }) => {
    const distance = p.distance ?? 8 * tokens.distance;
    return {
      duration: "$motion.normal",
      easing: "ease-in-out",
      tracks: {
        x: SHAKE.map((k, i) => ({
          at: round((i + 1) / (SHAKE.length + 1)),
          value: round(k * distance),
        })),
      },
    };
  },
});

const WiggleParams = z.strictObject({
  angle: z
    .number()
    .min(0)
    .max(90)
    .describe("Degrees each way (default 4 at subtle, by the level)")
    .optional(),
});
type WiggleParams = z.infer<typeof WiggleParams>;

const wiggle = defineEffect<WiggleParams>({
  name: "wiggle",
  title: "Wiggle",
  description: "Rocks back and forth: playful, look at me.",
  kind: "emphasis",
  paramsSchema: WiggleParams,
  defaultParams: {},
  aiDocs: `Rocks back and forth and settles: playful attention. \`angle\` each way (default 4° at \`subtle\`). ${LOOP_TIP}`,
  resolve: (p, { tokens }) => {
    const angle = Math.min(45, p.angle ?? 4 * tokens.distance);
    return {
      duration: "$motion.normal",
      easing: "ease-in-out",
      tracks: {
        rotate: SHAKE.map((k, i) => ({
          at: round((i + 1) / (SHAKE.length + 1)),
          value: round(k * angle),
        })),
      },
    };
  },
});

const bounce = defineEffect<AmountParams>({
  name: "bounce",
  title: "Bounce",
  description: "Hops up twice and lands.",
  kind: "emphasis",
  paramsSchema: AmountParams("How high it hops"),
  defaultParams: {},
  aiDocs: `Hops up, lands, hops a little again: cheerful emphasis. \`distance\` is the first hop's height (default 24 at \`subtle\`). ${LOOP_TIP}`,
  resolve: (p, { tokens }) => {
    const height = p.distance ?? 24 * tokens.distance;
    return {
      ...EMPHASIS,
      tracks: {
        y: [
          { at: 0.3, value: round(-height) },
          { at: 0.55, value: 0 },
          { at: 0.75, value: round(-height * 0.35) },
        ],
      },
    };
  },
});

const float = defineEffect<AmountParams>({
  name: "float",
  title: "Float",
  description: "Drifts up and back down, gently.",
  kind: "emphasis",
  paramsSchema: AmountParams("How far it drifts"),
  defaultParams: {},
  aiDocs:
    'Drifts up and back down, slowly: made to loop (`"repeat": "forever"`) behind a hero image or a key visual. `distance` in stage pixels (default 10 at `subtle`). Give it a long duration (2000 or more) for a calm float.',
  resolve: (p, { tokens }) => ({
    ...EMPHASIS,
    easing: "ease-in-out",
    tracks: { y: [{ at: 0.5, value: round(-(p.distance ?? 10 * tokens.distance)) }] },
  }),
});

const FlashParams = z.strictObject({
  opacity: z.number().min(0).max(1).describe("How faint it gets (default 0.2)").optional(),
});
type FlashParams = z.infer<typeof FlashParams>;

const flash = defineEffect<FlashParams>({
  name: "flash",
  title: "Flash",
  description: "Dims and comes back.",
  kind: "emphasis",
  paramsSchema: FlashParams,
  defaultParams: { opacity: 0.2 },
  aiDocs:
    "Dims and comes back once: a blink that says this changed. `opacity` at its faintest (default 0.2).",
  resolve: (p) => ({
    duration: "$motion.normal",
    easing: "$motion.move",
    tracks: { opacity: [{ at: 0.5, value: p.opacity ?? 0.2 }] },
  }),
});

// ── The plugin ───────────────────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: each effect has its own params type
export const BUILTIN_EFFECTS: readonly EffectDefinition<any>[] = [
  fadeIn,
  slideIn,
  scaleIn,
  zoomIn,
  popIn,
  blurIn,
  flipIn,
  fadeOut,
  slideOut,
  scaleOut,
  zoomOut,
  blurOut,
  flipOut,
  pulse,
  shake,
  wiggle,
  bounce,
  float,
  flash,
];

export const effectsPlugin = definePlugin({
  manifest: {
    id: "veloce.effects",
    name: "Effects",
    version: "0.1.0",
    description: "Built-in effect presets: entrances, exits and emphasis.",
    license: "Apache-2.0",
  },
  elements: [],
  effects: BUILTIN_EFFECTS,
});
