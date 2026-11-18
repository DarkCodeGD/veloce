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
}

/** A live, scaled render of one slide. Re-rendering is incremental and cheap. */
export function SlideCanvas({ deck, deckId, slideId, padding, className, lazy }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<SlideView | null>(null);
  const deckIdRef = useRef(deckId);
  deckIdRef.current = deckId;
  const latest = useRef({ deck, slideId });
  latest.current = { deck, slideId };

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
  }, [deck, slideId]);

  return <div ref={ref} className={className} />;
}
