import type { Deck } from "@veloce/core";
import { SlideView } from "@veloce/renderer";
import { useEffect, useRef } from "react";
import { assetUrl, registry } from "../editor-context.js";

interface Props {
  deck: Deck;
  deckId: string;
  slideId: string;
  /** Space around the slide, in screen pixels. */
  padding: number;
  className?: string;
  /** Only render while visible (thumbnails). */
  lazy?: boolean;
  /**
   * Frame this node instead of the whole slide (component previews, D94): once laid out,
   * the camera centres on its box, `padding` around it, never above `MAX_FOCUS_ZOOM`.
   */
  focus?: string;
}

/**
 * The most a framed node is enlarged: half size keeps a small badge from looking louder than
 * the cards next to it (slides themselves show at well under that in thumbnails).
 */
const MAX_FOCUS_ZOOM = 0.5;

/** The camera that shows node `id`'s box (stage pixels) centred in the viewport. */
function cameraOn(view: SlideView, el: HTMLElement, id: string, padding: number) {
  const box = view.measure()?.nodes[id]?.bounds;
  const vw = el.clientWidth - padding * 2;
  const vh = el.clientHeight - padding * 2;
  if (!box || box.width <= 0 || box.height <= 0 || vw <= 0 || vh <= 0) return null;
  const scale = Math.min(MAX_FOCUS_ZOOM, vw / box.width, vh / box.height);
  return {
    scale,
    x: (el.clientWidth - box.width * scale) / 2 - box.x * scale,
    y: (el.clientHeight - box.height * scale) / 2 - box.y * scale,
  };
}

/** A live, scaled render of one slide. Re-rendering is incremental and cheap. */
export function SlideCanvas({ deck, deckId, slideId, padding, className, lazy, focus }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<SlideView | null>(null);
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const latest = useRef({ deck, slideId, focus });
  latest.current = { deck, slideId, focus };

  /** Points the camera at `focus` once the slide is laid out (fonts and images in). */
  const frame = useRef(() => {});
  frame.current = () => {
    const v = view.current;
    const el = ref.current;
    const id = latest.current.focus;
    if (!v || !el || !id) return;
    void v.ready().then(() => {
      if (view.current !== v) return; // disposed meanwhile
      v.setCamera(cameraOn(v, el, id, padding));
    });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mount = () => {
      if (view.current) return;
      view.current = new SlideView(el, {
        registry,
        padding,
        assetUrl: (id) => assetUrl(deckIdRef.current, id),
      });
      view.current.stage.classList.add("slide-surface");
      view.current.render(latest.current.deck, latest.current.slideId);
      frame.current();
    };
    if (!lazy) {
      mount();
    } else {
      const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && mount(), {
        rootMargin: "200px",
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
        view.current?.dispose();
        view.current = null;
      };
    }
    return () => {
      view.current?.dispose();
      view.current = null;
    };
  }, [lazy, padding]);

  useEffect(() => {
    view.current?.render(deck, slideId);
    frame.current();
  }, [deck, slideId]);

  // A framed node stays framed when the panel is resized.
  useEffect(() => {
    const el = ref.current;
    if (!focus || !el) return;
    const observer = new ResizeObserver(() => frame.current());
    observer.observe(el);
    return () => observer.disconnect();
  }, [focus]);

  return <div ref={ref} className={className} />;
}
