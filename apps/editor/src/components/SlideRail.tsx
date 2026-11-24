import { type Deck, deckSections, type LintSeverity, type Slide } from "@veloce/core";
import { ChevronDown, ChevronRight, Copy, Pencil, Plus, Trash, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { run } from "../actions.js";
import { openSectionDialog } from "../dialogs.js";
import { addSlide, duplicateSlide } from "../model/commands.js";
import { deleteSlideCommand, removeSectionCommand } from "../model/sections.js";
import { SlideCanvas } from "./SlideCanvas.js";
import { useSlideDrag } from "./useSlideDrag.js";

interface Props {
  deck: Deck;
  deckId: string;
  selectedId: string | null;
  /** Slides the agent just changed (briefly highlighted). */
  recent: ReadonlySet<string>;
  /** Lint problems per slide (D73): a badge on the thumbnail. */
  issues?: ReadonlyMap<string, { count: number; worst: LintSeverity }>;
  onSelect(slideId: string): void;
}

/**
 * Slide thumbnails with add / duplicate / delete. Reorder by dragging, or with Alt+↑/↓.
 * Sections (D97) show as headers that collapse their slides (per tab, not saved), rename on
 * double-click and can be removed (the slides stay).
 */
export const SlideRail = memo(function SlideRail({
  deck,
  deckId,
  selectedId,
  recent,
  issues,
  onSelect,
}: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const { drag, begin } = useSlideDrag(listRef, deck.slides, onSelect);
  const sections = useMemo(() => deckSections(deck), [deck]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setCollapsed((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Going to a slide in a collapsed section (keys, the palette, an agent) opens it. Only when
  // the selection moves: collapsing the section you're on keeps it collapsed.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  useEffect(() => {
    const holder = sectionsRef.current.find((s) => s.slideIds.includes(selectedId ?? ""));
    if (!holder) return;
    setCollapsed((was) => {
      if (!was.has(holder.key)) return was;
      const next = new Set(was);
      next.delete(holder.key);
      return next;
    });
  }, [selectedId]);

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

  const slideRow = (slide: Slide, i: number) => {
    const selected = slide.id === selectedId;
    const badge = issues?.get(slide.id);
    const problems = badge ? `, ${badge.count} ${badge.count === 1 ? "problem" : "problems"}` : "";
    const name = `Slide ${i + 1}${slide.name ? `: ${slide.name}` : ""}${problems}`;
    return (
      <li
        key={slide.id}
        data-slide-id={slide.id}
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
          {badge && (
            <span className={`thumb-issues is-${badge.worst}`} aria-hidden="true">
              {badge.count}
            </span>
          )}
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
              const command = deleteSlideCommand(deck.slides, slide);
              if ((await run(command, { undoToast: true })) && selected && next) onSelect(next.id);
            }}
          >
            <Trash size={13} />
          </button>
        </div>
      </li>
    );
  };

  return (
    <nav className="rail" aria-label="Slides">
      <ol ref={listRef} className={drag ? "is-dragging" : undefined}>
        {sections.flatMap((section) => {
          const rows = [];
          const closed = collapsed.has(section.key);
          if (section.name !== null) {
            const count = section.slideIds.length;
            const label = `Section ${section.name}, ${count} ${count === 1 ? "slide" : "slides"}`;
            rows.push(
              <li
                key={`section:${section.key}`}
                className="rail-section"
                data-section-key={section.key}
              >
                <button
                  type="button"
                  className="rail-section-toggle"
                  aria-expanded={!closed}
                  aria-label={label}
                  data-tip={closed ? "Show its slides" : "Hide its slides"}
                  onClick={() => toggle(section.key)}
                  onDoubleClick={() => openSectionDialog({ slideId: section.key, rename: true })}
                >
                  {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="rail-section-name">{section.name}</span>
                  <span className="rail-section-count">{count}</span>
                </button>
                <div className="rail-section-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Rename section ${section.name}`}
                    data-tip="Rename section"
                    onClick={() => openSectionDialog({ slideId: section.key, rename: true })}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove section ${section.name}`}
                    data-tip="Remove section (keeps its slides)"
                    onClick={() =>
                      void run(removeSectionCommand(deck.slides, section.key), { undoToast: true })
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              </li>,
            );
          }
          if (!closed) {
            for (const [k, id] of section.slideIds.entries()) {
              const slide = deck.slides[section.start + k];
              if (slide?.id === id) rows.push(slideRow(slide, section.start + k));
            }
          }
          return rows;
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
