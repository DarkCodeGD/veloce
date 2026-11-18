import type { Slide } from "@veloce/core";
import { Layers, PanelsTopLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { redo, run, undo } from "./actions.js";
import { EditorCanvas, type TextEdit } from "./components/EditorCanvas.js";
import { EmptyState } from "./components/EmptyState.js";
import { Inspector } from "./components/Inspector.js";
import { LayersPanel } from "./components/LayersPanel.js";
import { SlideRail } from "./components/SlideRail.js";
import { Toasts } from "./components/Toasts.js";
import { Tooltips } from "./components/Tooltips.js";
import { TopBar } from "./components/TopBar.js";
import { useArrowNudge } from "./components/useArrowNudge.js";
import { useClipboard } from "./components/useClipboard.js";
import { client } from "./editor-context.js";
import { typing } from "./keyboard.js";
import {
  deleteNodes,
  deleteSlide,
  duplicateNodes,
  moveSlide,
  reorderNode,
} from "./model/commands.js";
import {
  editableText,
  pickTarget,
  pruneSelection,
  selectFirstChild,
  selectParents,
  selectSiblings,
} from "./model/selection.js";
import { indexSlide } from "./model/slide-index.js";
import { previewDeck, previewStore } from "./preview.js";

const ACTIVITY_MS = 6000;
type Panel = "slides" | "layers";

export function App() {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const { deck, deckId, lastChange } = state;
  // A scrub/nudge in progress, shown on the canvas only (the inspector reads the real deck).
  const previewOps = useSyncExternalStore(previewStore.subscribe, previewStore.get);
  const canvasDeck = useMemo(
    () => (deck ? previewDeck(deck, previewOps) : null),
    [deck, previewOps],
  );
  const slides = deck?.slides ?? [];
  const [slideId, setSlideId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [editing, setEditing] = useState<TextEdit | null>(null);
  const typingOnSlide = useRef(false);
  typingOnSlide.current = editing !== null;
  const [hoverHit, setHoverHit] = useState<string | null>(null);
  const [layerHover, setLayerHover] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("slides");
  const [follow, setFollow] = useState(true);
  const [activityVisible, setActivityVisible] = useState(false);

  const index = Math.max(
    0,
    slides.findIndex((s) => s.id === slideId),
  );
  const current: Slide | null = slides[index] ?? null;
  const slideIndex = current ? indexSlide(current) : null;
  useArrowNudge(slideIndex, selection);
  useClipboard(deck, slideIndex, selection, setSelection);

  // A different deck: start at its first slide. A different slide: nothing selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the deck changes
  useEffect(() => setSlideId(null), [deckId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the slide changes
  useEffect(() => setSelection([]), [current?.id]);
  // Layers can disappear under us (an agent, an undo): drop them from the selection.
  useEffect(() => {
    if (slideIndex) setSelection((s) => pruneSelection(slideIndex, s));
  }, [slideIndex]);

  // Typing on the slide ends when its layer stops being the one selected layer: a click
  // elsewhere, Esc up to the parent, the layer deleted (by anyone), another slide or deck.
  useEffect(() => {
    if (!editing) return;
    const still = selection.length === 1 && selection[0] === editing.id;
    if (!still || !slideIndex || !editableText(slideIndex, editing.id)) setEditing(null);
  }, [editing, selection, slideIndex]);

  // Follow the agent: jump to the slide it just added or changed (not while you're typing).
  useEffect(() => {
    if (!lastChange) return;
    setActivityVisible(true);
    const timer = setTimeout(() => setActivityVisible(false), ACTIVITY_MS);
    const target = lastChange.slideIds.at(-1);
    const jump = follow && !typingOnSlide.current && lastChange.origin.startsWith("agent:");
    if (jump && target) setSlideId(target);
    return () => clearTimeout(timer);
  }, [lastChange, follow]);

  const go = useCallback(
    (delta: number) => {
      const next = slides[Math.min(slides.length - 1, Math.max(0, index + delta))];
      if (next) setSlideId(next.id);
    },
    [slides, index],
  );

  // ── Keyboard ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const handled = () => e.preventDefault();
      /** Claim the key press for the editor and run `action`. */
      const act = (action: () => void) => {
        handled();
        action();
      };

      if (mod && key === "z") return act(e.shiftKey ? redo : undo);
      if (mod && key === "y") return act(redo);
      if (!current || !slideIndex) return;

      if (mod && key === "d" && selection.length > 0) {
        handled();
        const command = duplicateNodes(slideIndex, selection);
        void run(command).then((ok) => ok && setSelection(command?.select ?? []));
        return;
      }
      if (mod && key === "a") return act(() => setSelection(selectSiblings(slideIndex, selection)));
      if (e.key === "Escape") return setSelection(selectParents(slideIndex, selection));
      if (e.key === "Enter" && selection.length > 0) {
        // A text layer: start typing, all text selected (Figma). A frame: go inside.
        const only = selection.length === 1 ? selection[0] : undefined;
        if (only && editableText(slideIndex, only)) {
          return act(() => setEditing({ id: only, caret: "all" }));
        }
        return act(() => setSelection(selectFirstChild(slideIndex, selection)));
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        handled();
        if (selection.length > 0) {
          void run(deleteNodes(slideIndex, selection), { undoToast: true }).then(
            (ok) => ok && setSelection([]),
          );
        } else if (document.activeElement?.closest(".rail") && slides.length > 1) {
          const next = slides[index + 1] ?? slides[index - 1];
          void run(deleteSlide(current), { undoToast: true }).then(
            (ok) => ok && next && setSlideId(next.id),
          );
        }
        return;
      }
      // Reorder without dragging (WCAG 2.5.7): a layer among its siblings, else the slide.
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        handled();
        const delta = e.key === "ArrowUp" ? -1 : 1;
        const only = selection.length === 1 ? selection[0] : undefined;
        void run(
          only ? reorderNode(slideIndex, only, delta) : moveSlide(slides, current.id, delta),
        );
        return;
      }
      if (selection.length === 0) {
        const keys: Record<string, number> = {
          ArrowDown: 1,
          ArrowRight: 1,
          PageDown: 1,
          ArrowUp: -1,
          ArrowLeft: -1,
          PageUp: -1,
        };
        if (e.key in keys) return act(() => go(keys[e.key] ?? 0));
        if (e.key === "Home") return go(-Infinity);
        if (e.key === "End") return go(Infinity);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, slideIndex, selection, slides, index, go]);

  const recent = useMemo(
    () =>
      new Set(
        activityVisible && lastChange?.origin.startsWith("agent:") ? lastChange.slideIds : [],
      ),
    [activityVisible, lastChange],
  );

  const hover = layerHover ?? (slideIndex ? pickTarget(slideIndex, hoverHit, selection) : null);
  const select = (ids: string[], additive: boolean) =>
    setSelection((s) =>
      additive
        ? [
            ...new Set([
              ...s.filter((id) => !ids.includes(id)),
              ...ids.filter((id) => !s.includes(id)),
            ]),
          ]
        : ids,
    );

  return (
    <div className="app">
      <TopBar
        status={state.status}
        decks={state.decks}
        deckId={deckId}
        title={deck?.meta.title ?? null}
        activity={activityVisible ? lastChange : null}
        follow={follow}
        onFollowChange={setFollow}
        onOpenDeck={(id) => client.open(id)}
        position={current ? `${index + 1} / ${slides.length}` : null}
      />
      <div className="workspace">
        {deck && deckId && current && slideIndex ? (
          <>
            <div className="left-panel">
              <div className="tabs" role="tablist" aria-label="Left panel">
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === "slides"}
                  onClick={() => setPanel("slides")}
                >
                  <PanelsTopLeft size={14} /> Slides
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === "layers"}
                  onClick={() => setPanel("layers")}
                >
                  <Layers size={14} /> Layers
                </button>
              </div>
              <div className="tab-panel" role="tabpanel">
                {panel === "slides" ? (
                  <SlideRail
                    deck={deck}
                    deckId={deckId}
                    selectedId={current.id}
                    recent={recent}
                    onSelect={setSlideId}
                  />
                ) : (
                  <LayersPanel
                    slide={current}
                    selection={selection}
                    onSelect={select}
                    onHover={setLayerHover}
                  />
                )}
              </div>
            </div>
            <main className="stage-area">
              <EditorCanvas
                deck={canvasDeck ?? deck}
                deckId={deckId}
                slideId={current.id}
                index={slideIndex}
                selection={selection}
                hover={hover}
                onSelect={setSelection}
                onHoverHit={setHoverHit}
                editing={editing}
                onEditText={setEditing}
              />
              <NotesEditor slide={current} />
            </main>
            <Inspector deck={deck} slide={current} selection={selection} onSelect={setSelection} />
          </>
        ) : (
          <EmptyState hasDeck={deck !== null} online={state.status === "online"} />
        )}
      </div>
      <Toasts />
      <Tooltips />
    </div>
  );
}

/** Speaker notes, editable in place; saved when the field loses focus. */
function NotesEditor({ slide }: { slide: Slide }) {
  const [draft, setDraft] = useState(slide.notes ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(slide.notes ?? "");
  }, [slide.notes, editing]);
  return (
    <div className="notes">
      <label className="notes-label" htmlFor="notes">
        Speaker notes
      </label>
      <textarea
        id="notes"
        rows={2}
        value={draft}
        placeholder="Add notes for this slide…"
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft === (slide.notes ?? "")) return;
          void run({
            label: "Edit speaker notes",
            ops: [
              { op: "slide.update", id: slide.id, set: { notes: draft === "" ? null : draft } },
            ],
          });
        }}
      />
    </div>
  );
}
