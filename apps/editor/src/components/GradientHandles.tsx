/**
 * On-canvas gradient handles (D87). While the paint picker edits a gradient, its handles sit
 * on the painted layer (or the slide, for its background):
 *
 *   linear   a line; its end knobs go anywhere: shorter, longer, past the edges, turned
 *            (Shift: 15° steps) — the dragged knob follows the pointer (D88)
 *   radial   the centre knob (anywhere, outside the box too), and two knobs on its ellipse
 *            that size it (Shift keeps its proportions)
 *   angular  a ring around the centre knob; the knob on the ring turns where it starts
 *
 * Each stop is a chip beside the guide, on a stem to where it is. Drag a chip along the guide
 * to move it, or away from the guide to remove it (at least two stay); click the guide to
 * add a stop there; Delete removes the selected stop, never the layer (D88). Every change
 * goes through the picker's own preview/commit, so a drag here is one undo step like a drag
 * on its stop bar, and the selected stop is the picker's. Esc cancels a drag.
 *
 * Geometry lives in `model/gradient-handles.ts`, in the box's own axes: this layer is sized
 * and rotated like the selection outline, so it draws in those axes directly.
 */
import { type Gradient, resolveColor } from "@veloce/core";
import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react";
import { type GradientSession, setGradientDragging } from "../gradient-edit.js";
import { typing } from "../keyboard.js";
import type { Box, Point } from "../model/geometry.js";
import {
  angleTowards,
  centerOf,
  direction,
  dragLinearKnob,
  dragRadius,
  type Guide,
  guideOf,
  moveCenter,
  offsetAt,
  pointAt,
  radiusKnobs,
  radiusOf,
} from "../model/gradient-handles.js";
import { addStop, moveStop, removeStop } from "../model/paint.js";
import { showToast } from "../toasts.js";

/** How far a stop's chip sits beside the guide, in screen pixels. */
const CHIP_OFFSET = 18;
/** How far past the chip a stop is dragged before letting go removes it (like the bar). */
const REMOVE_DISTANCE = 32;
/** A gradient's default center. */
const MID = { x: 0.5, y: 0.5 };
/** Pixels a press moves before it's a drag rather than a click. */
const CLICK_SLOP = 3;

type Part =
  | { kind: "stop"; index: number }
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "center" }
  | { kind: "angle" }
  | { kind: "radius"; axis: "x" | "y" };

const partKey = (part: Part) => (part.kind === "radius" ? `radius-${part.axis}` : part.kind);

interface Drag {
  part: Part;
  pointerId: number;
  /** The gradient and its guide as the press found them: the drag is relative to these. */
  from: Gradient;
  guide: Guide;
  down: Point;
  moved: boolean;
  /** What letting go commits, and the stop selected afterwards (null: nothing changed). */
  result: { gradient: Gradient; selected: number } | null;
}

/** The gradient with its angle and center written out (D66 §6: objects are written whole). */
function whole(g: Gradient): Gradient {
  if (g.type === "linear-gradient") return { ...g, angle: g.angle ?? 180 };
  if (g.type === "radial-gradient") return { ...g, center: g.center ?? MID };
  return { ...g, angle: g.angle ?? 0, center: g.center ?? MID };
}

/** Where a stop's chip sits: beside a line (on its left), or outside a ring. */
function chipAt(guide: Guide, offset: number): Point {
  const p = pointAt(guide, offset);
  if (guide.kind === "ring") {
    const d = direction(guide.angle + offset * 360);
    return { x: p.x + d.x * CHIP_OFFSET, y: p.y + d.y * CHIP_OFFSET };
  }
  const vx = guide.end.x - guide.start.x;
  const vy = guide.end.y - guide.start.y;
  const len = Math.hypot(vx, vy) || 1;
  return { x: p.x + (vy / len) * CHIP_OFFSET, y: p.y - (vx / len) * CHIP_OFFSET };
}

export function GradientHandles({
  box,
  session,
  onPan,
}: {
  /** The painted box on the overlay (screen pixels, rotated like the layer). */
  box: Box;
  session: GradientSession;
  /** Starts a pan for a middle-button or Space press; true when it did. */
  onPan(e: PointerEvent): boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** The gradient a drag shows, until the picker shows the committed one. */
  const [draft, setDraft] = useState<Gradient | null>(null);
  // The committed gradient arrived (or the picker moved on): drop the draft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the gradient changes
  useEffect(() => {
    if (!drag.current) setDraft(null);
  }, [session.gradient]);

  const size = { w: box.w, h: box.h };
  const gradient = draft ?? session.gradient;
  const guide = guideOf(gradient, size);
  const center = centerOf(gradient, size);
  /** A radial gradient's ellipse (where offset 1 is), outlined. */
  const ellipse = gradient.type === "radial-gradient" ? radiusOf(gradient, size) : null;

  /** A pointer in the box's own axes (rotation undone). */
  const local = (e: { clientX: number; clientY: number }): Point => {
    const overlay = root.current?.parentElement?.getBoundingClientRect();
    const dx = e.clientX - (overlay?.left ?? 0) - box.cx;
    const dy = e.clientY - (overlay?.top ?? 0) - box.cy;
    const r = (-box.rotation * Math.PI) / 180;
    return {
      x: dx * Math.cos(r) - dy * Math.sin(r) + box.w / 2,
      y: dx * Math.sin(r) + dy * Math.cos(r) + box.h / 2,
    };
  };

  /** Ends a drag: commits what it made, or drops the preview. */
  const finish = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setGradientDragging(false);
    if (commit && d.result) {
      session.commit(whole(d.result.gradient), d.result.selected);
    } else {
      setDraft(null);
      if (d.moved) session.preview(null);
    }
  };

  // Unmounted mid-drag (the picker closed): Esc belongs to the popover again.
  useEffect(
    () => () => {
      if (drag.current) setGradientDragging(false);
    },
    [],
  );

  // Esc cancels a drag (the popover leaves it alone, the canvas doesn't see it). Delete and
  // Backspace remove the selected stop, never the layer whose paint is being edited (D88).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
        return;
      }
      if ((e.key !== "Delete" && e.key !== "Backspace") || typing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.current) return;
      const next = removeStop(session.gradient, session.selected);
      if (next) session.commit(whole(next), Math.max(0, session.selected - 1));
      else showToast({ message: "A gradient needs at least two stops", tone: "info" }, 2500);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const press = (e: PointerEvent<Element>, part: Part) => {
    if (onPan(e)) return;
    if (e.button !== 0) return;
    e.stopPropagation(); // not a press on the slide (selecting, marquee)
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (part.kind === "stop") session.select(part.index);
    setGradientDragging(true);
    drag.current = {
      part,
      pointerId: e.pointerId,
      from: gradient,
      guide,
      down: local(e),
      moved: false,
      result: null,
    };
  };

  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = local(e);
    if (!d.moved && Math.hypot(p.x - d.down.x, p.y - d.down.y) < CLICK_SLOP) return;
    d.moved = true;
    const result = dragTo(d, p, e.shiftKey);
    d.result = result;
    const shown = result?.gradient ?? d.from;
    setDraft(shown);
    session.preview(result ? whole(shown) : null);
  };

  /** What dragging `d`'s part to `p` makes (null: nothing, e.g. a stop past removal). */
  const dragTo = (d: Drag, p: Point, shift: boolean) => {
    const g = d.from;
    const c = centerOf(g, size);
    const selected = session.selected;
    switch (d.part.kind) {
      case "stop": {
        const at = offsetAt(d.guide, p);
        if (at.away > CHIP_OFFSET + REMOVE_DISTANCE) {
          const removed = removeStop(g, d.part.index);
          if (removed) return { gradient: removed, selected: Math.max(0, d.part.index - 1) };
        }
        const moved = moveStop(g, d.part.index, at.offset);
        return { gradient: moved.gradient, selected: moved.index };
      }
      case "start":
      case "end":
        if (g.type !== "linear-gradient") return null;
        return { gradient: dragLinearKnob(g, size, d.part.kind, p, shift), selected };
      case "angle":
        return { gradient: { ...g, angle: angleTowards(c, p, shift) }, selected };
      case "center":
        return { gradient: moveCenter(g, size, p), selected };
      case "radius":
        if (g.type !== "radial-gradient") return null;
        return { gradient: dragRadius(g, size, d.part.axis, p, shift), selected };
    }
  };

  const release = (e: PointerEvent) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    finish(drag.current.moved);
  };

  /** A click on the guide adds a stop there, colored like the gradient is (one step). */
  const pressTrack = (e: PointerEvent<SVGElement>) => {
    if (onPan(e) || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const added = addStop(gradient, offsetAt(guide, local(e)).offset, session.theme);
    if (added) session.commit(whole(added.gradient), added.index);
  };

  const knob = (part: Part, at: Point, label: string) => (
    <div
      key={partKey(part)}
      className={`gradient-knob is-${part.kind}`}
      data-gradient={partKey(part)}
      title={label}
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => press(e, part)}
    />
  );

  const knobs: Array<[Part, Point, string]> =
    guide.kind === "line"
      ? gradient.type === "linear-gradient"
        ? [
            [{ kind: "start" }, guide.start, "Drag to place where it starts"],
            [{ kind: "end" }, guide.end, "Drag to place where it ends"],
          ]
        : gradient.type === "radial-gradient"
          ? [
              [{ kind: "center" }, center, "Drag to move the center"],
              [{ kind: "radius", axis: "x" }, radiusKnobs(gradient, size).x, "Drag to size it"],
              [{ kind: "radius", axis: "y" }, radiusKnobs(gradient, size).y, "Drag to size it"],
            ]
          : [[{ kind: "center" }, center, "Drag to move the center"]]
      : [
          [{ kind: "center" }, center, "Drag to move the center"],
          [{ kind: "angle" }, pointAt(guide, 0), "Drag to turn where it starts"],
        ];

  return (
    <div
      ref={root}
      className="gradient-handles"
      data-testid="gradient-handles"
      style={{
        left: box.cx - box.w / 2,
        top: box.cy - box.h / 2,
        width: box.w,
        height: box.h,
        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={() => finish(false)}
    >
      <svg className="gradient-guide" width={box.w} height={box.h} aria-hidden="true">
        {ellipse && (
          <ellipse
            className="guide-ellipse"
            cx={center.x}
            cy={center.y}
            rx={ellipse.w}
            ry={ellipse.h}
          />
        )}
        {guide.kind === "line" ? (
          <>
            <line
              className="guide-shadow"
              x1={guide.start.x}
              y1={guide.start.y}
              x2={guide.end.x}
              y2={guide.end.y}
            />
            <line
              className="guide-line"
              x1={guide.start.x}
              y1={guide.start.y}
              x2={guide.end.x}
              y2={guide.end.y}
            />
            <line
              className="guide-track"
              data-gradient="track"
              x1={guide.start.x}
              y1={guide.start.y}
              x2={guide.end.x}
              y2={guide.end.y}
              onPointerDown={pressTrack}
            />
          </>
        ) : (
          <>
            <circle
              className="guide-shadow"
              cx={guide.center.x}
              cy={guide.center.y}
              r={guide.radius}
            />
            <circle
              className="guide-line"
              cx={guide.center.x}
              cy={guide.center.y}
              r={guide.radius}
            />
            <circle
              className="guide-track"
              data-gradient="track"
              cx={guide.center.x}
              cy={guide.center.y}
              r={guide.radius}
              onPointerDown={pressTrack}
            />
          </>
        )}
        {gradient.stops.map((stop, i) => {
          const p = pointAt(guide, stop.offset);
          const chip = chipAt(guide, stop.offset);
          // biome-ignore lint/suspicious/noArrayIndexKey: stops are positional
          return <line key={i} className="guide-stem" x1={p.x} y1={p.y} x2={chip.x} y2={chip.y} />;
        })}
      </svg>
      {knobs.map(([part, at, label]) => knob(part, at, label))}
      {gradient.stops.map((stop, i) => {
        const chip = chipAt(guide, stop.offset);
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: stops are positional
            key={i}
            className="gradient-stop"
            data-stop={i}
            data-selected={i === session.selected || undefined}
            title="Drag along the line to move it, away to remove it"
            style={{ left: chip.x, top: chip.y }}
            onPointerDown={(e) => press(e, { kind: "stop", index: i })}
          >
            <span style={{ "--chip": resolveColor(session.theme, stop.color) } as CSSProperties} />
          </div>
        );
      })}
    </div>
  );
}
