/**
 * The editable slide: the live render plus an overlay with hover/selection outlines, resize
 * and rotate handles, and drag feedback (snapping guides, insertion line, size badge).
 * Outlines come from the rendered DOM (auto-layout computes the pixels), so they're always
 * exactly where the layer is, rotation included. The overlay only takes pointer events on
 * its handles: clicks go to the slide, and the selection rules (model/selection.ts) decide
 * what they select. Dragging a selected layer moves it (components/canvas-drags.ts);
 * dragging on the empty canvas draws a marquee. Red spacing indicators show the gaps while
 * moving/resizing, and with Alt held between the selection and the hovered layer.
 * Double-clicking a text layer types into it (components/TextEditSession.tsx).
 * With a drawing tool (D81), a click adds a layer at its default size and a drag draws one;
 * the Hand tool pans. A right-click opens the Add menu at the click.
 * Zoom and pan (useCanvasCamera) only move the picture: the overlay re-measures from the
 * rendered DOM, so outlines, handles and guides stay on their layers at every zoom.
 * Double-clicking a picture layer enters crop mode (D84): the whole picture shows dimmed
 * around the layer; drag inside the layer to move it over the picture, drag the dimmed
 * picture to pan it, drag the layer's edges to trim, drag the picture's corners to scale it. Enter, Esc, a double-click or a click elsewhere leaves.
 */
import { type Deck, fieldValues, type TextContent } from "@veloce/core";
import { NODE_ID_ATTR, SlideView } from "@veloce/renderer";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { openAddMenu } from "../add-menu.js";
import { enterCrop, exitCrop, pictureOf, useCropping } from "../crop-mode.js";
import { assetUrl, registry } from "../editor-context.js";
import { useGradientSession } from "../gradient-edit.js";
import { addLayer, afterInsert, elementInfos, type InsertContext } from "../insert-actions.js";
import { typing } from "../keyboard.js";
import { type Crop, pictureRect, startingCrop } from "../model/crop.js";
import { focusOf } from "../model/focus-point.js";
import {
  type Box,
  boundingRect,
  HANDLES,
  type Handle,
  type Point,
  type Rect,
  resizeCursor,
} from "../model/geometry.js";
import { BUILTIN_INSERTABLES } from "../model/insert.js";
import { ancestorRotation } from "../model/manipulate.js";
import { editableText, pick, pickTarget } from "../model/selection.js";
import { indexSlide, nodeLabel, type SlideIndex } from "../model/slide-index.js";
import { type Measure, measureBetween } from "../model/spacing.js";
import { textBoxOf } from "../model/text-box.js";
import { isDrawTool, useTool } from "../tools.js";
import {
  type CropPart,
  type CropPicture,
  cropDrag,
  drawDrag,
  marqueeDrag,
  moveDrag,
  resizeDrag,
  rotateDrag,
} from "./canvas-drags.js";
import { CanvasSpace } from "./canvas-space.js";
import { GradientHandles } from "./GradientHandles.js";
import {
  type Caret,
  inTextEditor,
  prefetchTextEditor,
  TextEditSession,
} from "./TextEditSession.js";
import { useCanvasCamera } from "./useCanvasCamera.js";
import { DRAG_THRESHOLD, useCanvasGestures } from "./useCanvasGestures.js";
import { useFileDrop } from "./useFileDrop.js";

interface Props {
  /** What to show: the document, with any live preview applied. */
  deck: Deck;
  deckId: string;
  slideId: string;
  /** The committed slide (selection rules and drags act on what's stored, not the preview). */
  index: SlideIndex;
  selection: readonly string[];
  hover: string | null;
  onSelect(ids: string[]): void;
  /** The layer under the pointer, before the selection rules apply. */
  onHoverHit(hitId: string | null): void;
  /** The text layer being typed into, if any. */
  editing: TextEdit | null;
  onEditText(edit: TextEdit | null): void;
}

export interface TextEdit {
  id: string;
  caret: Caret;
}

/** A layer's box in overlay pixels: centre, own size, on-screen rotation. */
interface OverlayBox extends Box {
  id: string;
}

/** Where the slide sits in the overlay, to draw slide-pixel feedback. */
interface StageFrame {
  x: number;
  y: number;
  scale: number;
}

export function EditorCanvas({
  deck,
  deckId,
  slideId,
  index,
  selection,
  hover,
  onSelect,
  onHoverHit,
  editing,
  onEditText,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const view = useRef<SlideView | null>(null);
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const indexRef = useRef(index);
  indexRef.current = index;
  const { begin, active, feedback } = useCanvasGestures();
  const tool = useTool();
  const dropping = useFileDrop(wrapperRef, { deck, index, selection, onSelect });
  const [boxes, setBoxes] = useState<{
    hover: OverlayBox | null;
    selected: OverlayBox[];
    stage: StageFrame;
  }>({ hover: null, selected: [], stage: { x: 0, y: 0, scale: 1 } });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    view.current = new SlideView(viewport, {
      registry,
      padding: 48,
      assetUrl: (id) => assetUrl(deckIdRef.current, id),
    });
    view.current.stage.classList.add("slide-surface");
    return () => {
      view.current?.dispose();
      view.current = null;
    };
  }, []);

  // ── Outline geometry ────────────────────────────────────────────────────────────
  // Rotations come from the shown deck, so outlines turn with a rotate preview.
  const shown = deck.slides.find((s) => s.id === slideId);
  const shownIndex = shown ? indexSlide(shown) : null;
  const measure = useCallback(() => {
    const v = view.current;
    const wrapper = wrapperRef.current;
    if (!v || !wrapper) return;
    const origin = wrapper.getBoundingClientRect();
    const stageRect = v.stage.getBoundingClientRect();
    const scale = v.scale || 1;
    const boxOf = (id: string): OverlayBox | null => {
      const el = v.stage.querySelector<HTMLElement>(`[${NODE_ID_ATTR}="${CSS.escape(id)}"]`);
      const node = shownIndex?.nodes.get(id)?.node;
      if (!el || !node || !shownIndex) return null;
      const r = el.getBoundingClientRect(); // rotation turns a box around its centre
      return {
        id,
        cx: r.left + r.width / 2 - origin.left,
        cy: r.top + r.height / 2 - origin.top,
        w: el.offsetWidth * scale,
        h: el.offsetHeight * scale,
        rotation: (node.rotation ?? 0) + ancestorRotation(shownIndex, id),
      };
    };
    setBoxes({
      hover: hover && !selection.includes(hover) ? boxOf(hover) : null,
      selected: selection.flatMap((id) => boxOf(id) ?? []),
      stage: {
        x: stageRect.left - origin.left,
        y: stageRect.top - origin.top,
        scale,
      },
    });
  }, [hover, selection, shownIndex]);

  // ── Zoom and pan ────────────────────────────────────────────────────────────────
  /** The selection's bounds in slide pixels (Zoom to selection). */
  const selectionRect = (): Rect | null => {
    const v = view.current;
    if (!v || selection.length === 0) return null;
    const space = new CanvasSpace(v.stage, v.scale);
    const rects = selection.flatMap((id) => space.rect(id) ?? []);
    if (rects.length === 0) return null;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    return { x, y, w: right - x, h: bottom - y };
  };
  const camera = useCanvasCamera({
    wrapper: wrapperRef,
    view,
    stage: { w: deck.stage.width, h: deck.stage.height },
    deckId,
    busy: active !== null,
    hand: tool === "hand",
    selectionRect,
    onChange: measure,
  });

  useLayoutEffect(() => {
    view.current?.render(deck, slideId);
    measure();
    // Plugins may finish laying out a frame later (images, fonts): measure again then.
    const frame = requestAnimationFrame(measure);
    void document.fonts.ready.then(measure);
    return () => cancelAnimationFrame(frame);
  }, [deck, slideId, measure]);

  // A font that finishes loading later (a deck font just added) reflows text: re-measure.
  useEffect(() => {
    document.fonts.addEventListener("loadingdone", measure);
    return () => document.fonts.removeEventListener("loadingdone", measure);
  }, [measure]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    observer.observe(wrapper);
    const onLoad = () => measure();
    wrapper.addEventListener("load", onLoad, true); // images inside the slide
    return () => {
      observer.disconnect();
      wrapper.removeEventListener("load", onLoad, true);
    };
  }, [measure]);

  // A text layer is selected: typing is one double-click away, so load the editor now.
  useEffect(() => {
    if (selection.some((id) => editableText(index, id))) prefetchTextEditor().catch(() => {});
  }, [selection, index]);

  // ── Alt + hover: measure from the selection to the hovered layer (or to its parent) ──
  const [altHeld, setAltHeld] = useState(false);
  const [altMeasures, setAltMeasures] = useState<Measure[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt" && !typing(e.target)) setAltHeld(e.type === "keydown");
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const measured = selection.length === 1 ? selection[0] : undefined;
  useLayoutEffect(() => {
    const v = view.current;
    const other =
      hover && hover !== measured ? hover : measured && index.nodes.get(measured)?.parentId;
    if (!altHeld || active || editing || !v || !measured || !other) {
      setAltMeasures((m) => (m.length === 0 ? m : []));
      return;
    }
    const space = new CanvasSpace(v.stage, v.scale);
    const a = space.rect(measured);
    const b =
      other === index.rootId
        ? { x: 0, y: 0, w: deck.stage.width, h: deck.stage.height }
        : space.rect(other);
    setAltMeasures(a && b ? measureBetween(a, b) : []);
  }, [altHeld, active, editing, measured, hover, index, deck]);

  // ── Pointer → layer ─────────────────────────────────────────────────────────────
  const hitAt = (target: EventTarget | null): string | null => {
    const stage = view.current?.stage;
    if (!(target instanceof Element) || !stage?.contains(target)) return null;
    return target.closest(`[${NODE_ID_ATTR}]`)?.getAttribute(NODE_ID_ATTR) ?? null;
  };
  /** The layout as it is right now, for a drag that starts now. */
  const context = () => {
    const v = view.current;
    return v ? { index, space: new CanvasSpace(v.stage, v.scale) } : null;
  };

  /** What adding a layer needs from here (D81). */
  const insertContext = (): InsertContext => ({
    deck,
    slideIndex: index,
    selection,
    select: onSelect,
    editText: (id) => {
      onSelect([id]);
      onEditText({ id, caret: "all" });
    },
  });

  // ── Crop mode (D84) ─────────────────────────────────────────────────────────────
  const cropping = useCropping();
  const gradientSession = useGradientSession();
  /** A layer's picture and its pixel size (the asset's info, else the rendered image). */
  const cropPicture = (id: string): CropPicture | undefined => {
    const picture = pictureOf(deck, index.nodes.get(id)?.node);
    if (!picture) return undefined;
    const img = view.current?.stage.querySelector<HTMLImageElement>(
      `[${NODE_ID_ATTR}="${CSS.escape(id)}"] img`,
    );
    const natural = img?.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    const size = picture.size ?? natural;
    return size ? { cropKey: picture.cropKey, focusKey: picture.focusKey, size } : undefined;
  };
  // Crop mode lasts while its layer is the one selected, with the Select tool, not typing.
  const cropId =
    cropping !== null &&
    selection.length === 1 &&
    selection[0] === cropping &&
    tool === "select" &&
    !editing &&
    pictureOf(deck, index.nodes.get(cropping)?.node) !== null
      ? cropping
      : null;
  useEffect(() => {
    if (cropping !== null && cropId === null) exitCrop();
  }, [cropping, cropId]);
  // Another slide, or the canvas going away, ends it too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the slide changes
  useEffect(() => () => exitCrop(), [slideId]);
  // Enter or Esc leaves crop mode (Esc during a crop drag cancels the drag instead).
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!cropId) return;
    const onKey = (e: KeyboardEvent) => {
      if (activeRef.current || typing(e.target)) return;
      if (e.key !== "Escape" && e.key !== "Enter") return;
      e.preventDefault();
      e.stopImmediatePropagation(); // not the editor's "select parent"
      exitCrop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cropId]);

  const onCropDown = (e: React.PointerEvent, part: CropPart) => {
    if (camera.startPan(e)) return;
    if (e.button !== 0 || !cropId) return;
    e.stopPropagation(); // not a click on the slide (which would leave crop mode)
    const id = cropId;
    const picture = cropPicture(id);
    if (!picture) return;
    const start = { x: e.clientX, y: e.clientY };
    begin(
      e,
      "crop",
      () => {
        const ctx = context();
        return ctx ? cropDrag(ctx, id, part, start, picture) : null;
      },
      {
        threshold: part.kind === "pan" ? DRAG_THRESHOLD : 1,
        capture: wrapperRef.current ?? e.currentTarget,
      },
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (camera.startPan(e)) return; // Space + drag, the middle button, or the Hand tool
    if (cropId) exitCrop(); // a press off the picture leaves crop mode
    if (inTextEditor(e.target)) return; // placing the caret, selecting text
    if (editing) onEditText(null); // a press anywhere else on the canvas ends typing
    if (e.button !== 0 || e.detail > 1) return;
    const item = isDrawTool(tool) ? BUILTIN_INSERTABLES.find((i) => i.id === tool) : undefined;
    if (item) {
      // A drawing tool: a click adds the layer at its default size there, a drag draws it.
      const start = { x: e.clientX, y: e.clientY };
      const ctx = insertContext();
      begin(
        e,
        "draw",
        () => {
          const c = context();
          return c ? drawDrag(c, item, elementInfos(), start) : null;
        },
        {
          capture: e.currentTarget,
          onClick: () => void addLayer(ctx, item, start),
          onCommitted: (command) => afterInsert(ctx, command),
        },
      );
      return;
    }
    const hit = hitAt(e.target);
    const target = pickTarget(index, hit, selection);
    // Pressing a layer of a multi-selection keeps the group (to drag it); a click without
    // dragging then selects just that layer, like Figma.
    const keepGroup =
      !e.shiftKey && target !== null && selection.length > 1 && selection.includes(target);
    const ids = keepGroup ? [...selection] : pick(index, hit, selection, { additive: e.shiftKey });
    if (!keepGroup) onSelect(ids);
    const start = { x: e.clientX, y: e.clientY };
    if (!target) {
      // The empty canvas (or a locked layer): draw a marquee. Shift adds to the selection.
      const base = e.shiftKey ? ids : [];
      begin(e, "marquee", () => {
        const ctx = context();
        return ctx ? marqueeDrag(ctx, start, base, onSelect) : null;
      });
      return;
    }
    if (!ids.includes(target)) return;
    begin(
      e,
      "move",
      () => {
        const ctx = context();
        return ctx ? moveDrag(ctx, ids, start) : null;
      },
      { capture: e.currentTarget, ...(keepGroup ? { onClick: () => onSelect([target]) } : {}) },
    );
  };

  const onHandleDown = (e: React.PointerEvent, id: string, handle: Handle | "rotate") => {
    if (camera.startPan(e)) return; // Space held over a handle still pans
    if (e.button !== 0) return;
    e.stopPropagation(); // not a click on the slide
    const start = { x: e.clientX, y: e.clientY };
    begin(
      e,
      handle === "rotate" ? "rotate" : "resize",
      () => {
        const ctx = context();
        if (!ctx) return null;
        return handle === "rotate"
          ? rotateDrag(ctx, id, start)
          : resizeDrag(ctx, id, handle, start, cropPicture(id));
      },
      { threshold: 1, capture: wrapperRef.current ?? e.currentTarget },
    );
  };

  const labelFor = (id: string) => {
    const node = shownIndex?.nodes.get(id)?.node;
    return node ? nodeLabel(node) : "";
  };
  const primary = boxes.selected.length === 1 ? boxes.selected[0] : undefined;
  /** Space held or the Hand tool on: dragging pans, nothing else is grabbed. */
  const handUp = camera.spaceHeld || tool === "hand";
  const editable =
    !editing &&
    !handUp && // the hand tool is up: nothing to grab but the canvas
    !camera.panning &&
    primary &&
    primary.id !== index.rootId &&
    !index.nodes.get(primary.id)?.node.locked;
  const { stage } = boxes;
  /** What crop mode draws: the crop as shown now (live preview included), and the picture. */
  const cropView = (() => {
    const box = cropId ? boxes.selected.find((b) => b.id === cropId) : undefined;
    const node = cropId ? shownIndex?.nodes.get(cropId)?.node : undefined;
    const picture = cropId ? cropPicture(cropId) : undefined;
    const asset = pictureOf(deck, node)?.assetId;
    if (!box || node?.kind !== "element" || !picture || !asset) return null;
    const size = { w: box.w / stage.scale, h: box.h / stage.scale };
    const focus = focusOf(picture.focusKey ? node.props[picture.focusKey] : undefined);
    const crop = startingCrop(node.props[picture.cropKey], picture.size, size, focus);
    return { box, crop, size, src: assetUrl(deckId, asset) };
  })();
  /**
   * The gradient the paint picker is editing gets handles on what it paints (D87): the
   * selected layer, or the slide for its background. Not while another gesture runs.
   */
  const gradientBox: Box | null = (() => {
    if (!gradientSession || active || editing || cropView) return null;
    if (gradientSession.owner === slideId) {
      const w = deck.stage.width * stage.scale;
      const h = deck.stage.height * stage.scale;
      return { cx: stage.x + w / 2, cy: stage.y + h / 2, w, h, rotation: 0 };
    }
    return boxes.selected.find((b) => b.id === gradientSession.owner) ?? null;
  })();
  /**
   * The size badge under the selection (`176 × 36`, slide pixels), live while resizing:
   * one layer's own size (rotation aside), or the bounds of several. Below the rotate knob
   * when that's showing underneath.
   */
  const sizeBadge = (() => {
    const selected = boxes.selected;
    if (editing || selected.length === 0 || active === "marquee") return null;
    const bounds = unionRects(selected.map(boundingRect));
    const single = selected.length === 1 ? selected[0] : undefined;
    const size = single ? single : bounds;
    let top = bounds.y + bounds.h + BADGE_GAP;
    if (
      single &&
      single === primary &&
      editable &&
      active !== "move" &&
      !cropView &&
      !gradientBox
    ) {
      // The knob's centre sits KNOB_REACH past the box's bottom edge, turned with the box.
      const knobY =
        single.cy + Math.cos((single.rotation * Math.PI) / 180) * (single.h / 2 + KNOB_REACH);
      top = Math.max(top, knobY + KNOB_RADIUS + BADGE_GAP);
    }
    const text = `${slidePx(size.w / stage.scale)} × ${slidePx(size.h / stage.scale)}`;
    return { text, left: bounds.x + bounds.w / 2, top };
  })();
  /** Slide pixels → overlay pixels. */
  const toOverlay = (p: Point): Point => ({
    x: stage.x + p.x * stage.scale,
    y: stage.y + p.y * stage.scale,
  });
  const rectStyle = (r: Rect) => {
    const tl = toOverlay(r);
    return { left: tl.x, top: tl.y, width: r.w * stage.scale, height: r.h * stage.scale };
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the canvas is a pointer surface; every action here also has a keyboard path (arrow keys, layers panel, inspector)
    <div
      ref={wrapperRef}
      className={[
        "editor-canvas",
        active ? GESTURE_CLASS[active] : "",
        camera.panning ? "is-panning" : handUp ? "can-pan" : "",
        isDrawTool(tool) ? "is-tool-draw" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        if (inTextEditor(e.target)) return; // selects a word
        // Two quick Space + drags are a double-click too: the hand tool never edits.
        if (handUp || camera.panning || isDrawTool(tool)) return;
        if (cropId) return exitCrop(); // a double-click in crop mode is done (Figma's too)
        const ids = pick(index, hitAt(e.target), selection, { deep: true });
        onSelect(ids);
        // Reaching a text layer starts typing, caret under the pointer; a picture crops.
        const [only] = ids;
        if (ids.length === 1 && editableText(index, only)) {
          onEditText({ id: only as string, caret: { x: e.clientX, y: e.clientY } });
        } else if (only && ids.length === 1 && cropPicture(only)) {
          enterCrop(only);
        }
      }}
      onPointerMove={(e) =>
        onHoverHit(active || editing || camera.panning ? null : hitAt(e.target))
      }
      onPointerLeave={() => onHoverHit(null)}
      onContextMenu={(e) => {
        if (inTextEditor(e.target)) return; // the browser's own menu: spelling, copy
        // Right-click: the Add menu, adding where you clicked (D81).
        e.preventDefault();
        const at = { x: e.clientX, y: e.clientY };
        openAddMenu({ left: at.x, top: at.y, at });
      }}
      onDragStart={(e) => e.preventDefault()} // images: no native drag-and-drop
    >
      <div ref={viewportRef} className="canvas" />
      <div className="overlay" aria-hidden="true">
        {boxes.hover && !active && (
          <div className="outline outline-hover" style={boxStyle(boxes.hover)} />
        )}
        {feedback?.target && <div className="drop-target" style={rectStyle(feedback.target)} />}
        {boxes.selected
          .filter((box) => box.id !== cropView?.box.id)
          .map((box) => (
            <div key={box.id} className="outline outline-selected" style={boxStyle(box)}>
              {box === primary && editable && active !== "move" && box !== gradientBox && (
                <Handles box={box} onHandleDown={(e, handle) => onHandleDown(e, box.id, handle)} />
              )}
            </div>
          ))}
        {gradientSession && gradientBox && (
          <GradientHandles
            box={gradientBox}
            session={gradientSession}
            onPan={(e) => camera.startPan(e)}
          />
        )}
        {cropView && (
          <CropOverlay
            box={cropView.box}
            crop={cropView.crop}
            size={cropView.size}
            scale={stage.scale}
            src={cropView.src}
            onDown={onCropDown}
          />
        )}
        {primary && !active && !editing && !cropView && (
          <div className="outline-label" style={labelStyle(primary)}>
            {labelFor(primary.id)}
          </div>
        )}
        {feedback?.ghost && (
          <div
            className="outline outline-ghost"
            style={boxStyle({
              ...feedback.ghost,
              ...toCentre(toOverlay({ x: feedback.ghost.cx, y: feedback.ghost.cy })),
              w: feedback.ghost.w * stage.scale,
              h: feedback.ghost.h * stage.scale,
            })}
          />
        )}
        {feedback?.guides?.map((g) => {
          const a = toOverlay(g.axis === "x" ? { x: g.at, y: g.from } : { x: g.from, y: g.at });
          const b = toOverlay(g.axis === "x" ? { x: g.at, y: g.to } : { x: g.to, y: g.at });
          // A 1px line: vertical for an x guide, horizontal for a y guide.
          const style =
            g.axis === "x"
              ? { left: a.x, top: a.y, width: 1, height: b.y - a.y }
              : { left: a.x, top: a.y, width: b.x - a.x, height: 1 };
          return <div key={`${g.axis}${g.at}`} className="guide" style={style} />;
        })}
        {feedback?.line && (
          <InsertionLine
            a={toOverlay({ x: feedback.line.x1, y: feedback.line.y1 })}
            b={toOverlay({ x: feedback.line.x2, y: feedback.line.y2 })}
          />
        )}
        {feedback?.marquee && <div className="marquee" style={rectStyle(feedback.marquee)} />}
        {(feedback?.measures ?? altMeasures).map((m) => (
          <MeasureLine
            key={`${m.dir}${m.from}${m.to}`}
            measure={m}
            from={toOverlay(m.dir === "h" ? { x: m.from, y: m.at } : { x: m.at, y: m.from })}
            to={toOverlay(m.dir === "h" ? { x: m.to, y: m.at } : { x: m.at, y: m.to })}
          />
        ))}
        {sizeBadge && (
          <div
            className="size-badge"
            data-testid="size-badge"
            style={{ left: sizeBadge.left, top: sizeBadge.top }}
          >
            {sizeBadge.text}
          </div>
        )}
        {feedback?.badge && (
          <div
            className="drag-badge"
            style={{ left: toOverlay(feedback.badge.at).x, top: toOverlay(feedback.badge.at).y }}
          >
            {feedback.badge.text}
          </div>
        )}
      </div>
      {editing && view.current && (
        <TextEditSession
          key={editing.id}
          stage={view.current.stage}
          nodeId={editing.id}
          content={textContentOf(index, editing.id)}
          box={textBoxOf(propsOf(index, editing.id))}
          theme={deck.theme}
          fields={fieldValues(
            deck,
            deck.slides.findIndex((s) => s.id === slideId),
            new Date(),
          )}
          name={shownIndex?.nodes.get(editing.id)?.node.name}
          caret={editing.caret}
          // Above the layer, like its name tag (hidden while typing).
          anchor={primary?.id === editing.id ? labelAnchor(primary) : null}
          exists={() => editableText(indexRef.current, editing.id)}
          onExit={() => onEditText(null)}
        />
      )}
      {dropping && (
        <div className="drop-overlay" aria-hidden="true">
          <span>Drop images or fonts</span>
        </div>
      )}
    </div>
  );
}

/** A layer's stored props (none for frames). */
function propsOf(index: SlideIndex, id: string): Readonly<Record<string, unknown>> {
  const node = index.nodes.get(id)?.node;
  return node?.kind === "element" ? node.props : {};
}

/** A text layer's stored content ("" if it has none yet). */
function textContentOf(index: SlideIndex, id: string): TextContent {
  const node = index.nodes.get(id)?.node;
  const content = node?.kind === "element" ? node.props.content : undefined;
  return typeof content === "string" || Array.isArray(content) ? (content as TextContent) : "";
}

const CORNERS = ["nw", "ne", "se", "sw"] as const;

/** The size badge's distance from the selection, and the rotate knob's place (styles.css). */
const BADGE_GAP = 8;
const KNOB_REACH = 21;
const KNOB_RADIUS = 9;

/** A size in slide pixels: whole, or to one decimal when it isn't (Figma does the same). */
const slidePx = (v: number) => String(Math.round(v * 10) / 10);

function unionRects(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Crop mode's overlay (D84), in the layer's own (rotated) box: the whole picture, dimmed
 * outside the layer, which pans when dragged; round knobs on its corners that scale it; and
 * the layer itself, which moves over the picture when dragged, its edges trim handles.
 */
function CropOverlay({
  box,
  crop,
  size,
  scale,
  src,
  onDown,
}: {
  box: OverlayBox;
  crop: Crop;
  size: { w: number; h: number };
  scale: number;
  src: string;
  onDown(e: React.PointerEvent, part: CropPart): void;
}) {
  const p = pictureRect(crop, size);
  const px = (v: number) => v * scale;
  return (
    <div className="crop-frame" style={boxStyle(box)}>
      <div
        className="crop-picture"
        data-crop="pan"
        style={{ left: px(p.x), top: px(p.y), width: px(p.w), height: px(p.h) }}
        onPointerDown={(e) => onDown(e, { kind: "pan" })}
      >
        <img src={src} alt="" draggable={false} />
        <div
          className="crop-hole"
          style={{ left: px(-p.x), top: px(-p.y), width: box.w, height: box.h }}
        />
      </div>
      {CORNERS.map((c) => (
        <div
          key={c}
          className="crop-scale"
          data-crop={`scale-${c}`}
          style={{
            left: px(p.x + (c.includes("e") ? p.w : 0)),
            top: px(p.y + (c.startsWith("s") ? p.h : 0)),
            cursor: resizeCursor(c, box.rotation),
          }}
          onPointerDown={(e) => onDown(e, { kind: "scale", corner: c })}
        />
      ))}
      <div className="crop-window">
        <div
          className="crop-move"
          data-crop="move"
          onPointerDown={(e) => onDown(e, { kind: "move" })}
        />
        {HANDLES.map((h) => (
          <div
            key={h}
            className={`handle handle-${h}`}
            data-crop={`trim-${h}`}
            style={{ cursor: resizeCursor(h, box.rotation) }}
            onPointerDown={(e) => onDown(e, { kind: "trim", handle: h })}
          />
        ))}
      </div>
    </div>
  );
}

/** Resize handles (sides are edge strips, corners squares) and the rotate knob. */
function Handles({
  box,
  onHandleDown,
}: {
  box: OverlayBox;
  onHandleDown(e: React.PointerEvent, handle: Handle | "rotate"): void;
}) {
  // Tiny layers: side strips would cover the layer itself, so only corners remain.
  const small = box.w < 24 || box.h < 24;
  return (
    <>
      {HANDLES.filter((h) => !small || h.length === 2).map((h) => (
        <div
          key={h}
          className={`handle handle-${h}`}
          data-handle={h}
          style={{ cursor: resizeCursor(h, box.rotation) }}
          onPointerDown={(e) => onHandleDown(e, h)}
        />
      ))}
      <div
        className="rotate-knob"
        data-handle="rotate"
        onPointerDown={(e) => onHandleDown(e, "rotate")}
      />
    </>
  );
}

function InsertionLine({ a, b }: { a: Point; b: Point }) {
  const vertical = Math.abs(a.x - b.x) < 0.5;
  const style = vertical
    ? { left: a.x, top: a.y, width: 3, height: Math.max(0, b.y - a.y) }
    : { left: a.x, top: a.y, width: Math.max(0, b.x - a.x), height: 3 };
  return (
    <div className={`insertion-line ${vertical ? "is-vertical" : "is-horizontal"}`} style={style} />
  );
}

/** A spacing indicator: a 1px red line with the distance in a pill at its middle. */
function MeasureLine({ measure, from, to }: { measure: Measure; from: Point; to: Point }) {
  const line =
    measure.dir === "h"
      ? { left: from.x, top: from.y, width: to.x - from.x, height: 1 }
      : { left: from.x, top: from.y, width: 1, height: to.y - from.y };
  return (
    <>
      <div className="measure" style={line} />
      <div
        className="measure-label"
        style={{ left: (from.x + to.x) / 2, top: (from.y + to.y) / 2 }}
      >
        {measure.value}
      </div>
    </>
  );
}

const GESTURE_CLASS = {
  move: "is-moving",
  resize: "is-resizing",
  rotate: "is-rotating",
  marquee: "is-selecting",
  draw: "is-drawing",
  crop: "is-cropping",
} as const;

const toCentre = (p: Point) => ({ cx: p.x, cy: p.y });

const boxStyle = (b: Box): React.CSSProperties => ({
  left: b.cx - b.w / 2,
  top: b.cy - b.h / 2,
  width: b.w,
  height: b.h,
  transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
});

/** The name tag sits above the layer's on-screen bounds (it never rotates: it's text). */
const labelAnchor = (b: Box): Point => {
  const r = boundingRect(b);
  return { x: r.x, y: r.y };
};
const labelStyle = (b: Box): React.CSSProperties => {
  const at = labelAnchor(b);
  return { left: at.x, top: at.y };
};
