/**
 * The canvas drags (move, resize, rotate, marquee). Each is created when the gesture starts,
 * captures the layout as it was then (a CanvasSpace), and from there on is a pure function
 * of the pointer: `update(pointer, modifiers)` → the command to preview/commit, plus what to
 * draw on the canvas (guides, the insertion line, a size badge…). useCanvasGestures drives
 * them; the pure maths lives in model/.
 */
import type { Layout } from "@veloce/core";
import { resolvedSizing } from "../editor-context.js";
import type { Command } from "../model/commands.js";
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
const EDGE_BAND_PX = 12;

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
export function resizeDrag(ctx: Context, id: string, handle: Handle, start: Point): Drag | null {
  const { index, space } = ctx;
  const node = index.nodes.get(id)?.node;
  const size = space.size(id);
  const rect = space.rect(id);
  if (!node || !size || !rect) return null;
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
      const p = space.toSlide(pointer);
      const d = rotateVector(sub(p, p0), -turn);
      const raw = resizeBox(b0, handle, d, { keepRatio: mods.shift, fromCenter: mods.alt });
      let w = Math.max(1, Math.round(raw.w));
      let h = Math.max(1, Math.round(raw.h));

      // Snap the dragged edge(s) (plain resizes of unrotated free layers only).
      const snapped = { x: false, y: false };
      if (targets.length > 0 && !mods.shift && !mods.alt) {
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
