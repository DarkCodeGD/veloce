import type { Deck } from "@veloce/core";
import { Copy, Plus, Trash } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { run } from "../actions.js";
import { addSlide, deleteSlide, duplicateSlide } from "../model/commands.js";
import { SlideCanvas } from "./SlideCanvas.js";
import { useSlideDrag } from "./useSlideDrag.js";

interface Props {
  deck: Deck;
  deckId: string;
  selectedId: string | null;
  /** Slides the agent just changed (briefly highlighted). */
  recent: ReadonlySet<string>;
  onSelect(slideId: string): void;
}

/** Slide thumbnails with add / duplicate / delete. Reorder by dragging, or with Alt+↑/↓. */
export const SlideRail = memo(function SlideRail({
  deck,
  deckId,
  selectedId,
  recent,
  onSelect,
}: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const { drag, begin } = useSlideDrag(listRef, deck.slides, onSelect);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the selection moves
  useEffect(() => {
    const button = selectedRef.current;
    if (!button) return;
    button.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // Keyboard users navigating the rail: keep focus on the selected slide, not the old one.
    if (button.closest(".rail")?.contains(document.activeElement))
      button.focus({ preventScroll: true });
  }, [selectedId]);

  const selectedIndex = deck.slides.findIndex((s) => s.id === selectedId);
  const create = async () => {
    const command = addSlide(selectedIndex === -1 ? deck.slides.length - 1 : selectedIndex);
    if (await run(command)) onSelect(command.select?.[0] ?? "");
  };

  return (
    <nav className="rail" aria-label="Slides">
      <ol ref={listRef} className={drag ? "is-dragging" : undefined}>
        {deck.slides.map((slide, i) => {
          const selected = slide.id === selectedId;
          const name = `Slide ${i + 1}${slide.name ? `: ${slide.name}` : ""}`;
          return (
            <li
              key={slide.id}
              className={`thumb-row${selected ? " is-selected" : ""}${recent.has(slide.id) ? " is-recent" : ""}${slide.hidden ? " is-hidden" : ""}${drag?.id === slide.id ? " is-dragged" : ""}`}
            >
              <button
                ref={selected ? selectedRef : undefined}
                type="button"
                className="thumb"
                aria-current={selected ? "true" : undefined}
                aria-label={name}
                onClick={() => onSelect(slide.id)}
                onPointerDown={(e) => begin(e, slide.id)}
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
              <div className="thumb-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Duplicate ${name}`}
                  data-tip="Duplicate slide"
                  onClick={async () => {
                    const command = duplicateSlide(slide, i);
                    if (await run(command)) onSelect(command.select?.[0] ?? slide.id);
                  }}
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete ${name}`}
                  data-tip="Delete slide"
                  disabled={deck.slides.length === 1}
                  onClick={async () => {
                    const next = deck.slides[i + 1] ?? deck.slides[i - 1];
                    if ((await run(deleteSlide(slide), { undoToast: true })) && selected && next)
                      onSelect(next.id);
                  }}
                >
                  <Trash size={13} />
                </button>
              </div>
            </li>
          );
        })}
        {drag && <li className="rail-insertion" aria-hidden="true" style={{ top: drag.lineY }} />}
      </ol>
      <div className="rail-footer">
        <button type="button" className="button button-ghost" onClick={create}>
          <Plus size={14} /> New slide
        </button>
      </div>
    </nav>
  );
});
