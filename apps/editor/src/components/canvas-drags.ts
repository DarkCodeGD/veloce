/**
 * The canvas drags (move, resize, rotate, marquee, draw). Each is created when the gesture starts,
 * captures the layout as it was then (a CanvasSpace), and from there on is a pure function
 * of the pointer: `update(pointer, modifiers)` → the command to preview/commit, plus what to
 * draw on the canvas (guides, the insertion line, a size badge…). useCanvasGestures drives
 * them; the pure maths lives in model/.
 */
import { createId, type Layout } from "@veloce/core";
import { resolvedSizing } from "../editor-context.js";
import type { Command } from "../model/commands.js";
import {
  cropFor,
  moveWindow,
  panPicture,
  pictureRect,
  scalePicture,
  startingCrop,
  trimWindow,
} from "../model/crop.js";
import { focusOf, type Size } from "../model/focus-point.js";
import {
  anchoredBox,
  type Box,
  type Handle,
  handleDirection,
  type Point,
  type Rect,
  resizeBox,
  rotateBox,
  rotateVector,
  topLeft,
} from "../model/geometry.js";
import { drawnRect, type ElementInfo, type Insertable, insertCommand } from "../model/insert.js";
import {
  ancestorRotation,
  dropInto,
  freeSizing,
  isFree,
  movedPosition,
  moveTo,
  placeFreely,
  resizeTo,
  rotateTo,
} from "../model/manipulate.js";
import { marqueeCandidates, marqueeHits, rectBetween } from "../model/marquee.js";
import {
  childIndexForSlot,
  dropTarget,
  type FrameSnapshot,
  insertionIndex,
  insertionLine,
} from "../model/reorder.js";
import { type SlideIndex, topmost } from "../model/slide-index.js";
import { type Guide, guidesFor, snapAxis, snapMove } from "../model/snapping.js";
import { type Measure, spacingAround } from "../model/spacing.js";
import { type CanvasSpace, subtree } from "./canvas-space.js";

/** Snapping reach and the "beside a frame" edge band, in screen pixels (zoom-independent). */
const SNAP_PX = 6;
export const EDGE_BAND_PX = 12;

export interface Modifiers {
  /** Move: lock to one axis. Resize: keep the aspect ratio. Rotate: 15° steps. */
  shift: boolean;
  /** Move: no snapping. Resize: from the centre. */
  alt: boolean;
  /**
   * Ctrl/Cmd. Move: stay in the current frame, at the spot you drop it (a layer in a stack or
   * grid leaves the flow: free positioning). Never drops into another frame.
   */
  mod: boolean;
}

/** What to draw while dragging, in slide pixels. */
export interface Feedback {
  guides?: Guide[];
  /** Where a dropped layer will be inserted. */
  line?: { x1: number; y1: number; x2: number; y2: number };
  /** The frame it will be dropped into. */
  target?: Rect;
  /** The dragged layer following the pointer (while the layout shows where it will land). */
  ghost?: Box;
  /** A small readout next to the pointer: size, angle. */
  badge?: { text: string; at: Point };
  /** Distances to the neighbours (spacing indicators). */
  measures?: Measure[];
  /** The marquee being dragged. */
  marquee?: Rect;
}

export interface Drag {
  update(pointer: Point, mods: Modifiers): { command: Command | null; feedback: Feedback };
}

interface Context {
  index: SlideIndex;
  space: CanvasSpace;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const offset = (r: Rect, d: Point): Rect => ({ ...r, x: r.x + d.x, y: r.y + d.y });
const union = (rects: readonly Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
};

/** Shift while moving: keep only the larger of the two axes. */
const constrain = (d: Point, shift: boolean): Point =>
  !shift ? d : Math.abs(d.x) >= Math.abs(d.y) ? { x: d.x, y: 0 } : { x: 0, y: d.y };

/** What a free layer in `frame` snaps to: its siblings and the frame's content box. */
const snapTargets = (frame: FrameSnapshot | undefined, exclude: ReadonlySet<string>): Rect[] =>
  frame
    ? [frame.content, ...frame.children.filter((c) => !exclude.has(c.id)).map((c) => c.rect)]
    : [];

/** The layer's box in slide pixels: centre, own size and on-screen rotation. */
function boxOf(ctx: Context, id: string): Box | null {
  const rect = ctx.space.rect(id);
  const size = ctx.space.size(id);
  const node = ctx.index.nodes.get(id)?.node;
  if (!rect || !size || !node) return null;
  return {
    cx: rect.x + rect.w / 2,
    cy: rect.y + rect.h / 2,
    w: size.w,
    h: size.h,
    rotation: (node.rotation ?? 0) + ancestorRotation(ctx.index, id),
  };
}

/** Gaps from `rect` to its siblings in a free `frame` (those not in `exclude`), or its edges. */
const spacingIn = (frame: FrameSnapshot, rect: Rect, exclude: ReadonlySet<string>): Measure[] =>
  spacingAround(
    rect,
    frame.children.filter((c) => !exclude.has(c.id)).map((c) => c.rect),
    frame.content,
  );

// ── Move ────────────────────────────────────────────────────────────────────────────

/**
 * Move the selected layers. One layer can go anywhere: free layers move by `position` (with
 * snapping), layers in stacks and grids reorder, and either can be dropped into another
 * frame. Several layers move together by `position` (free ones only).
 */
export function moveDrag(ctx: Context, ids: readonly string[], start: Point): Drag | null {
  const { index, space } = ctx;
  const layers = topmost(index, ids).filter((id) => id !== index.rootId);
  if (layers.length === 1 && layers[0]) return singleMove(ctx, layers[0], start);

  const free = layers.filter((id) => isFree(index, id));
  const starts = free.flatMap((id) => {
    const rect = space.rect(id);
    const node = index.nodes.get(id)?.node;
    return rect && node ? [{ id, rect, node, turn: ancestorRotation(index, id) }] : [];
  });
  const first = starts[0];
  if (!first) return null;
  const parentId = index.nodes.get(first.id)?.parentId ?? null;
  // Snap as a group when they share an unrotated parent.
  const snappable = starts.every(
    (s) => s.turn === 0 && index.nodes.get(s.id)?.parentId === parentId,
  );
  const exclude = new Set(free);
  const parent = snappable
    ? space.frames(index, exclude).find((f) => f.id === parentId)
    : undefined;
  const targets = snapTargets(parent, exclude);
  const bounds = union(starts.map((s) => s.rect));
  const p0 = space.toSlide(start);

  return {
    update(pointer, mods) {
      let d = constrain(sub(space.toSlide(pointer), p0), mods.shift);
      d = { x: Math.round(d.x), y: Math.round(d.y) };
      let guides: Guide[] = [];
      if (targets.length > 0 && !mods.alt) {
        const snap = snapMove(offset(bounds, d), targets, SNAP_PX / space.scale);
        d = add(d, { x: snap.dx, y: snap.dy });
        guides = snap.guides;
      }
      const positions = new Map(
        starts.map((s) => [s.id, movedPosition(s.node, rotateVector(d, -s.turn))] as const),
      );
      const measures = parent ? spacingIn(parent, offset(bounds, d), exclude) : [];
      return { command: moveTo(index, positions), feedback: { guides, measures } };
    },
  };
}

function singleMove(ctx: Context, id: string, start: Point): Drag | null {
  const { index, space } = ctx;
  const at = index.nodes.get(id);
  const box = boxOf(ctx, id);
  const rect = space.rect(id);
  if (!at?.parentId || !box || !rect) return null;
  const frames = space.frames(index, subtree(index, id));
  const parent = frames.find((f) => f.id === at.parentId);
  const parentNode = index.nodes.get(at.parentId)?.node;
  if (!parent || parentNode?.kind !== "frame") return null;
  const free = isFree(index, id);
  const turn = ancestorRotation(index, id);
  const self = new Set([id]);
  const targets = turn === 0 ? snapTargets(parent, self) : [];
  const p0 = space.toSlide(start);
  // Ctrl on a layer in a stack/grid pulls it out of the flow, starting from where it is, at
  // the size it has. Its siblings close up live, so it snaps only to the frame's content box
  // (their start rectangles would be stale guides).
  const pull = free ? null : pullOut(ctx, id, parentNode.layout);
  const pullTargets = turn === 0 ? [parent.content] : [];

  return {
    update(pointer, mods) {
      const p = space.toSlide(pointer);
      let d = constrain(sub(p, p0), mods.shift);
      const target = (!mods.mod && dropTarget(frames, p, EDGE_BAND_PX / space.scale)) || parent;

      if (target.id === parent.id && !free && mods.mod && pull) {
        d = { x: Math.round(d.x), y: Math.round(d.y) };
        let guides: Guide[] = [];
        if (pullTargets.length > 0 && !mods.alt) {
          const snap = snapMove(offset(rect, d), pullTargets, SNAP_PX / space.scale);
          d = add(d, { x: snap.dx, y: snap.dy });
          guides = snap.guides;
        }
        const command = placeFreely(
          index,
          id,
          add(pull.position, rotateVector(d, -turn)),
          pull.size,
        );
        return { command, feedback: { guides } };
      }

      // Stay in the frame, placed by position (a free frame's child, or a free layer in a
      // stack or grid): move, snapping to the siblings.
      if (target.id === parent.id && free) {
        d = { x: Math.round(d.x), y: Math.round(d.y) };
        let guides: Guide[] = [];
        if (targets.length > 0 && !mods.alt) {
          const snap = snapMove(offset(rect, d), targets, SNAP_PX / space.scale);
          d = add(d, { x: snap.dx, y: snap.dy });
          guides = snap.guides;
        }
        const command = dropInto(index, id, {
          parentId: parent.id,
          position: movedPosition(at.node, rotateVector(d, -turn)),
        });
        const measures = turn === 0 ? spacingIn(parent, offset(rect, d), self) : [];
        return { command, feedback: { guides, measures } };
      }

      const ghost = { ...box, cx: box.cx + d.x, cy: box.cy + d.y };
      // Into another free frame: keep the layer where it was dropped.
      if (target.flow === "absolute") {
        // Free layers are measured from the frame's edge (not its padding).
        const corner = sub(topLeft(ghost), { x: target.rect.x, y: target.rect.y });
        const command = dropInto(index, id, {
          parentId: target.id,
          position: { x: Math.round(corner.x), y: Math.round(corner.y) },
        });
        return { command, feedback: { target: target.rect, ghost } };
      }

      // Into a stack or grid: the slot under the pointer (siblings as laid out at the start).
      // Free siblings float above the flow, so they're not slots.
      const others = target.children.filter((c) => c.id !== id);
      const siblings = others.filter((c) => !c.free).map((c) => c.rect);
      const slot = insertionIndex(p, siblings, target.flow);
      return {
        command: dropInto(index, id, {
          parentId: target.id,
          index: childIndexForSlot(others, slot),
        }),
        feedback: {
          target: target.rect,
          ghost,
          line: insertionLine(siblings, slot, target.flow, target.content),
        },
      };
    },
  };
}

/**
 * Where a layer in a stack or grid sits now, as a free `position`, and the sizes that keep it
 * looking the same once it's out of the flow. Null if it can't be measured.
 */
function pullOut(
  ctx: Context,
  id: string,
  parentLayout: Layout,
): { position: Point; size: ReturnType<typeof freeSizing> } | null {
  const node = ctx.index.nodes.get(id)?.node;
  const position = ctx.space.offsetInParent(id);
  const size = ctx.space.size(id);
  if (!node || !position || !size) return null;
  return { position, size: freeSizing(parentLayout, resolvedSizing(node), size) };
}

// ── Resize ──────────────────────────────────────────────────────────────────────────

/**
 * Resize one layer from a handle. Sides change one dimension (the other keeps its sizing,
 * e.g. a text's "hug" height), corners both. Shift keeps the ratio, Alt resizes around the
 * centre. Unrotated free layers snap their moving edges.
 */
/**
 * Resize one layer by a handle. A picture layer (D84, `picture` given) keeps its aspect
 * ratio on corner handles unless Shift is held (the other way round from other layers), so
 * resizing scales the picture instead of re-cropping it; with Ctrl/Cmd held, any handle trims
 * it like crop mode does (read live, so pressing Ctrl mid-drag switches).
 */
export function resizeDrag(
  ctx: Context,
  id: string,
  handle: Handle,
  start: Point,
  picture?: CropPicture,
): Drag | null {
  const { index, space } = ctx;
  const node = index.nodes.get(id)?.node;
  const size = space.size(id);
  const rect = space.rect(id);
  if (!node || !size || !rect) return null;
  const trim = picture ? cropDrag(ctx, id, { kind: "trim", handle }, start, picture) : null;
  const corner = handle.length === 2;
  const turn = ancestorRotation(index, id);
  const rotation = node.rotation ?? 0;
  const free = isFree(index, id);
  // In the parent's own axes, with the top-left at the origin: topLeft() is then the offset.
  const b0: Box = { cx: size.w / 2, cy: size.h / 2, w: size.w, h: size.h, rotation };
  const dir = handleDirection(handle);
  const parentId = index.nodes.get(id)?.parentId;
  const snappable = free && rotation === 0 && turn === 0;
  const parent = snappable
    ? space.frames(index, subtree(index, id)).find((f) => f.id === parentId)
    : undefined;
  const targets = snapTargets(parent, new Set([id]));
  const p0 = space.toSlide(start);

  return {
    update(pointer, mods) {
      if (trim && mods.mod) return trim.update(pointer, mods);
      const p = space.toSlide(pointer);
      const d = rotateVector(sub(p, p0), -turn);
      const keepRatio = picture && corner ? !mods.shift : mods.shift;
      const raw = resizeBox(b0, handle, d, { keepRatio, fromCenter: mods.alt });
      let w = Math.max(1, Math.round(raw.w));
      let h = Math.max(1, Math.round(raw.h));

      // Snap the dragged edge(s) (plain resizes of unrotated free layers only).
      const snapped = { x: false, y: false };
      if (targets.length > 0 && !keepRatio && !mods.alt) {
        const reach = SNAP_PX / space.scale;
        const lines = (axis: "x" | "y") =>
          targets.flatMap((t) => (axis === "x" ? [t.x, t.x + t.w] : [t.y, t.y + t.h]));
        if (dir.x !== 0) {
          const edge = dir.x > 0 ? rect.x + w : rect.x + rect.w - w;
          const c = snapAxis([edge], lines("x"), reach);
          if (c !== null) w = Math.max(1, w + dir.x * c);
          snapped.x = c !== null;
        }
        if (dir.y !== 0) {
          const edge = dir.y > 0 ? rect.y + h : rect.y + rect.h - h;
          const c = snapAxis([edge], lines("y"), reach);
          if (c !== null) h = Math.max(1, h + dir.y * c);
          snapped.y = c !== null;
        }
      }

      const next = anchoredBox(b0, handle, w, h, mods.alt);
      const moved = sub(topLeft(next), topLeft(b0));
      const command = resizeTo(index, id, {
        ...(dir.x !== 0 || w !== size.w ? { width: w } : {}),
        ...(dir.y !== 0 || h !== size.h ? { height: h } : {}),
        ...(free ? { position: movedPosition(node, moved, { w: w - size.w, h: h - size.h }) } : {}),
      });
      const now = offset({ ...rect, w, h }, moved);
      return {
        command,
        feedback: {
          guides: snapped.x || snapped.y ? guidesFor(now, targets, snapped) : [],
          badge: { text: `${Math.round(w)} × ${Math.round(h)}`, at: p },
          measures: parent ? spacingIn(parent, now, new Set([id])) : [],
        },
      };
    },
  };
}

// ── Crop (D84) ──────────────────────────────────────────────────────────────────────

/** What a crop gesture needs about the layer's picture (crop-mode.ts's `Picture`). */
export interface CropPicture {
  cropKey: string;
  focusKey: string | undefined;
  /** The picture's pixel size. */
  size: Size;
}

/** The part of crop mode being dragged. */
export type CropPart =
  | { kind: "move" }
  | { kind: "pan" }
  | { kind: "trim"; handle: Handle }
  | { kind: "scale"; corner: Handle };

/**
 * A crop gesture on one picture layer (model/crop.ts has the maths): move the layer over a
 * fixed picture, pan the picture behind the layer, trim the layer's edges over a fixed
 * picture, or scale the picture by a corner (Alt: from its centre). Worked out in the
 * layer's own axes, so rotated layers crop too. One transaction: the crop, plus the size and
 * position a move or trim gives the layer. A layer its stack or grid places can't move, so
 * there a move pans the picture the other way instead: the same part ends up in view.
 */
export function cropDrag(
  ctx: Context,
  id: string,
  part: CropPart,
  start: Point,
  picture: CropPicture,
): Drag | null {
  const { index, space } = ctx;
  const node = index.nodes.get(id)?.node;
  const size = space.size(id);
  if (node?.kind !== "element" || !size || size.w <= 0 || size.h <= 0) return null;
  const turn = ancestorRotation(index, id);
  const rotation = node.rotation ?? 0;
  const free = isFree(index, id);
  const focus = focusOf(picture.focusKey ? node.props[picture.focusKey] : undefined);
  const crop0 = startingCrop(node.props[picture.cropKey], picture.size, size, focus);
  const window0: Rect = { x: 0, y: 0, w: size.w, h: size.h };
  const picture0 = pictureRect(crop0, size);
  const b0: Box = { cx: size.w / 2, cy: size.h / 2, w: size.w, h: size.h, rotation };
  const p0 = space.toSlide(start);

  return {
    update(pointer, mods) {
      const p = space.toSlide(pointer);
      // Into the layer's own axes: undo its frames' rotation, then its own.
      const d = rotateVector(rotateVector(sub(p, p0), -turn), -rotation);
      let shown = picture0;
      let window = window0;
      if (part.kind === "pan") shown = panPicture(picture0, window0, d);
      if (part.kind === "move" && !free) shown = panPicture(picture0, window0, scaleBy(d, -1));
      if (part.kind === "move" && free) window = moveWindow(picture0, window0, d);
      if (part.kind === "scale") shown = scalePicture(picture0, window0, part.corner, d, mods.alt);
      let resize: Command | null = null;
      if (part.kind === "trim") {
        const trimmed = trimWindow(picture0, window0, part.handle, d);
        // Whole pixels, like any resize; the crop is read from the rounded window.
        window = { ...trimmed, w: Math.round(trimmed.w), h: Math.round(trimmed.h) };
      }
      if (window !== window0) {
        // The window's centre moved in the layer's axes: turn that into the parent's.
        const shift = rotateVector(
          { x: window.x + window.w / 2 - size.w / 2, y: window.y + window.h / 2 - size.h / 2 },
          rotation,
        );
        const next: Box = { ...b0, cx: b0.cx + shift.x, cy: b0.cy + shift.y, ...wh(window) };
        const moved = sub(topLeft(next), topLeft(b0));
        const grow = { w: window.w - size.w, h: window.h - size.h };
        resize = resizeTo(index, id, {
          width: window.w,
          height: window.h,
          ...(free ? { position: movedPosition(node, moved, grow) } : {}),
        });
      }
      const crop = cropFor(shown, window);
      const command: Command = {
        label: "Crop image",
        ops: [
          ...(resize?.ops ?? []),
          { op: "node.update", id, set: { props: { [picture.cropKey]: crop } } },
        ],
      };
      return {
        command,
        feedback:
          part.kind === "trim"
            ? { badge: { text: `${window.w} × ${window.h}`, at: p } }
            : { badge: { text: `${Math.round((shown.w / picture.size.w) * 100)}%`, at: p } },
      };
    },
  };
}

const wh = (r: Rect) => ({ w: r.w, h: r.h });
const scaleBy = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });

// ── Rotate ──────────────────────────────────────────────────────────────────────────

/** Rotate one layer around its centre with the knob above it; Shift snaps to 15°. */
export function rotateDrag(ctx: Context, id: string, start: Point): Drag | null {
  const { index, space } = ctx;
  const node = index.nodes.get(id)?.node;
  const el = space.element(id);
  if (!node || !el) return null;
  const r = el.getBoundingClientRect(); // screen pixels, like the pointer
  const centre: Box = {
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    w: 0,
    h: 0,
    rotation: node.rotation ?? 0,
  };
  return {
    update(pointer, mods) {
      const degrees = rotateBox(centre, start, pointer, mods.shift);
      return {
        command: rotateTo(index, id, degrees),
        feedback: { badge: { text: `${degrees}°`, at: space.toSlide(pointer) } },
      };
    },
  };
}

// ── Marquee ─────────────────────────────────────────────────────────────────────────

/**
 * Drag on the empty canvas to select every layer the box touches: top-level layers, or the
 * deepest ones with Ctrl/Cmd (model/marquee.ts). The selection updates live; `base` is kept
 * (Shift at the press adds to the selection). Selecting isn't an edit: no command, ever.
 */
export function marqueeDrag(
  ctx: Context,
  start: Point,
  base: readonly string[],
  select: (ids: string[]) => void,
): Drag {
  const { index, space } = ctx;
  // Measured once, at the press (the layout doesn't change while selecting).
  const measured = (deep: boolean) =>
    marqueeCandidates(index, deep).flatMap((id) => {
      const rect = space.rect(id);
      return rect ? [{ id, rect }] : [];
    });
  const candidates = { top: measured(false), deep: measured(true) };
  const p0 = space.toSlide(start);
  let last = "";

  return {
    update(pointer, mods) {
      const area = rectBetween(p0, space.toSlide(pointer));
      const hits = marqueeHits(mods.mod ? candidates.deep : candidates.top, area);
      const ids = [...base, ...hits.filter((id) => !base.includes(id))];
      const key = ids.join("\n");
      if (key !== last) {
        last = key;
        select(ids); // only when it changes: not a re-render per frame
      }
      return { command: null, feedback: { marquee: area } };
    },
  };
}

/**
 * Drawing a new layer with a tool (D81): a box from the press to the pointer (Shift: square,
 * Alt: from the centre). The layer itself previews live, in the frame and slot the press
 * picked, so what you see while drawing is what you get.
 */
export function drawDrag(
  ctx: Context,
  item: Insertable,
  elements: readonly ElementInfo[],
  start: Point,
): Drag {
  const { index, space } = ctx;
  const frames = space.frames(index, new Set()); // the layout as it was at the press
  const p0 = space.toSlide(start);
  const band = EDGE_BAND_PX / space.scale;
  // One ID for the whole drag, so the preview updates one layer instead of remounting it.
  const id = createId("nd");
  return {
    update(pointer, mods) {
      const rect = drawnRect(p0, space.toSlide(pointer), mods);
      const made = insertCommand(index, frames, item, elements, { point: p0, rect }, [], band);
      const command: Command | null = made && {
        ...made,
        ops: made.ops.map((op) =>
          op.op === "node.insert" ? { ...op, node: { ...op.node, id } } : op,
        ),
        select: [id],
      };
      const w = Math.round(rect.w);
      const h = Math.round(rect.h);
      return {
        command,
        feedback: {
          ghost: {
            cx: rect.x + rect.w / 2,
            cy: rect.y + rect.h / 2,
            w: rect.w,
            h: rect.h,
            rotation: 0,
          },
          badge: { text: `${w} × ${h}`, at: { x: rect.x + rect.w / 2, y: rect.y + rect.h } },
        },
      };
    },
  };
}
