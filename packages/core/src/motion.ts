/**
 * Motion: how far a layer is drawn from its rest position at one moment (D83 §5, D103).
 *
 * Layout decides where a layer rests; motion is drawn on top of that and never changes the
 * layout. So an animation can't reflow the slide, every layer can be animated whether it's
 * free or in a stack, and `seek(t)` only has to compute numbers. The renderer combines a
 * layer's motion with its own rotation, anchor and opacity (`SlideRenderer.setMotion`).
 *
 * Pure data, not part of the document: the timeline (Phase 4) produces it for a moment on
 * the one clock (golden rule #3), and nothing stores it.
 */

/** Offsets from a layer's rest position. Every field is optional; omitted = at rest. */
export interface MotionState {
  /** Move, in stage pixels, along the frame's axes (not the layer's own rotation). */
  x?: number;
  y?: number;
  /** Depth in stage pixels, towards the viewer. Shows once a frame has perspective (2.5D). */
  z?: number;
  /** Turn in degrees, clockwise, added to the layer's own rotation. */
  rotate?: number;
  /** Flip around the layer's own vertical (rotateY) and horizontal (rotateX) axis, in degrees. */
  rotateX?: number;
  rotateY?: number;
  /** Size multiplier around the layer's centre; scaleX and scaleY multiply it per axis. */
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  /** Multiplies the layer's own opacity (0–1). */
  opacity?: number;
  /** Gaussian blur radius in stage pixels. */
  blur?: number;
}

const FIELDS = [
  "x",
  "y",
  "z",
  "rotate",
  "rotateX",
  "rotateY",
  "scale",
  "scaleX",
  "scaleY",
  "opacity",
  "blur",
] as const satisfies readonly (keyof MotionState)[];

/** The value each field has at rest. */
const REST: Required<MotionState> = {
  x: 0,
  y: 0,
  z: 0,
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  blur: 0,
};

/**
 * A motion with every field finite and in range: opacity clamped to 0–1, blur and scales at
 * least 0, anything not a finite number at rest. A broken value from a plugin effect or an
 * easing overshoot can't produce invalid CSS or a flipped layer.
 */
export function resolveMotion(motion: MotionState | undefined): Required<MotionState> {
  const out = { ...REST };
  if (!motion) return out;
  for (const field of FIELDS) {
    const value = motion[field];
    if (typeof value === "number" && Number.isFinite(value)) out[field] = value;
  }
  out.opacity = Math.min(1, Math.max(0, out.opacity));
  out.blur = Math.max(0, out.blur);
  out.scale = Math.max(0, out.scale);
  out.scaleX = Math.max(0, out.scaleX);
  out.scaleY = Math.max(0, out.scaleY);
  return out;
}

/** True when the motion draws the layer exactly at rest. */
export function isRestMotion(motion: MotionState | undefined): boolean {
  if (!motion) return true;
  const resolved = resolveMotion(motion);
  return FIELDS.every((field) => resolved[field] === REST[field]);
}

/** True when both draw the layer the same way (field by field, after resolving). */
export function sameMotion(a: MotionState | undefined, b: MotionState | undefined): boolean {
  if (a === b) return true;
  const ra = resolveMotion(a);
  const rb = resolveMotion(b);
  return FIELDS.every((field) => ra[field] === rb[field]);
}
