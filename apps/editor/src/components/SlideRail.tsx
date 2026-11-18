import type { Deck } from "@veloce/core";
import { memo, useEffect, useRef } from "react";
import { SlideCanvas } from "./SlideCanvas.js";

interface Props {
  deck: Deck;
  deckId: string;
  selectedId: string | null;
  /** Slides the agent just changed (briefly highlighted). */
  recent: ReadonlySet<string>;
  onSelect(slideId: string): void;
}

export const SlideRail = memo(function SlideRail({
  deck,
  deckId,
  selectedId,
  recent,
  onSelect,
}: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the selection moves
  useEffect(() => {
    const button = selectedRef.current;
    if (!button) return;
    button.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // Keyboard users navigating the rail: keep focus on the selected slide, not the old one.
    if (button.closest(".rail")?.contains(document.activeElement))
      button.focus({ preventScroll: true });
  }, [selectedId]);

  return (
    <nav className="rail" aria-label="Slides">
      <ol>
        {deck.slides.map((slide, i) => (
          <li key={slide.id}>
            <button
              ref={slide.id === selectedId ? selectedRef : undefined}
              type="button"
              className={`thumb${slide.id === selectedId ? " is-selected" : ""}${recent.has(slide.id) ? " is-recent" : ""}${slide.hidden ? " is-hidden" : ""}`}
              aria-current={slide.id === selectedId ? "true" : undefined}
              aria-label={`Slide ${i + 1}${slide.name ? `: ${slide.name}` : ""}`}
              onClick={() => onSelect(slide.id)}
            >
              <span className="thumb-number">{i + 1}</span>
              <SlideCanvas
                className="thumb-view"
                deck={deck}
                deckId={deckId}
                slideId={slide.id}
                padding={0}
                lazy
              />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
});
