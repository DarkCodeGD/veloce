/**
 * The editable slide: the live render plus an overlay that outlines the hovered and selected
 * layers. Outlines come from the rendered DOM (auto-layout computes the pixels), so they're
 * always exactly where the layer is. The overlay never takes pointer events: clicks go to the
 * slide, and the selection rules (model/selection.ts) decide what they select.
 */
import type { Deck } from "@veloce/core";
import { NODE_ID_ATTR, SlideView } from "@veloce/renderer";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { assetUrl, registry } from "../editor-context.js";
import type { PickOptions } from "../model/selection.js";
import { indexSlide, nodeLabel } from "../model/slide-index.js";

interface Props {
  deck: Deck;
  deckId: string;
  slideId: string;
  selection: readonly string[];
  hover: string | null;
  /** A click or double-click on the slide (`hitId` = innermost layer under the pointer). */
  onPick(hitId: string | null, options: PickOptions): void;
  /** The layer under the pointer, before the selection rules apply. */
  onHoverHit(hitId: string | null): void;
}

interface Box {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function EditorCanvas({
  deck,
  deckId,
  slideId,
  selection,
  hover,
  onPick,
  onHoverHit,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const view = useRef<SlideView | null>(null);
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const [boxes, setBoxes] = useState<{ hover: Box | null; selected: Box[] }>({
    hover: null,
    selected: [],
  });

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
  const measure = useCallback(() => {
    const stage = view.current?.stage;
    const wrapper = wrapperRef.current;
    if (!stage || !wrapper) return;
    const origin = wrapper.getBoundingClientRect();
    const boxOf = (id: string): Box | null => {
      const el = stage.querySelector(`[${NODE_ID_ATTR}="${CSS.escape(id)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        id,
        left: r.left - origin.left,
        top: r.top - origin.top,
        width: r.width,
        height: r.height,
      };
    };
    setBoxes({
      hover: hover && !selection.includes(hover) ? boxOf(hover) : null,
      selected: selection.flatMap((id) => boxOf(id) ?? []),
    });
  }, [hover, selection]);

  useLayoutEffect(() => {
    view.current?.render(deck, slideId);
    measure();
    // Plugins may finish laying out a frame later (images, fonts): measure again then.
    const frame = requestAnimationFrame(measure);
    void document.fonts.ready.then(measure);
    return () => cancelAnimationFrame(frame);
  }, [deck, slideId, measure]);

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

  // ── Pointer → layer ─────────────────────────────────────────────────────────────
  const hitAt = (target: EventTarget | null): string | null => {
    const stage = view.current?.stage;
    if (!(target instanceof Element) || !stage?.contains(target)) return null;
    return target.closest(`[${NODE_ID_ATTR}]`)?.getAttribute(NODE_ID_ATTR) ?? null;
  };

  const index = deck.slides.find((s) => s.id === slideId);
  const labelFor = (id: string) => {
    const node = index ? indexSlide(index).nodes.get(id)?.node : undefined;
    return node ? nodeLabel(node) : "";
  };
  const primary = boxes.selected.length === 1 ? boxes.selected[0] : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the canvas is a pointer surface; every action here also has a keyboard path (layers panel, shortcuts)
    <div
      ref={wrapperRef}
      className="editor-canvas"
      onPointerDown={(e) => {
        if (e.button !== 0 || e.detail > 1) return;
        onPick(hitAt(e.target), { additive: e.shiftKey });
      }}
      onDoubleClick={(e) => onPick(hitAt(e.target), { deep: true })}
      onPointerMove={(e) => onHoverHit(hitAt(e.target))}
      onPointerLeave={() => onHoverHit(null)}
    >
      <div ref={viewportRef} className="canvas" />
      <div className="overlay" aria-hidden="true">
        {boxes.hover && <div className="outline outline-hover" style={boxStyle(boxes.hover)} />}
        {boxes.selected.map((box) => (
          <div key={box.id} className="outline outline-selected" style={boxStyle(box)} />
        ))}
        {primary && (
          <div className="outline-label" style={{ left: primary.left, top: primary.top }}>
            {labelFor(primary.id)}
          </div>
        )}
      </div>
    </div>
  );
}

const boxStyle = (b: Box) => ({ left: b.left, top: b.top, width: b.width, height: b.height });
