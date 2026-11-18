import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EmptyState } from "./components/EmptyState.js";
import { SlideCanvas } from "./components/SlideCanvas.js";
import { SlideRail } from "./components/SlideRail.js";
import { TopBar } from "./components/TopBar.js";
import { client } from "./editor-context.js";

const ACTIVITY_MS = 6000;

export function App() {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const { deck, deckId, lastChange } = state;
  const slides = deck?.slides ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [activityVisible, setActivityVisible] = useState(false);

  const index = Math.max(
    0,
    slides.findIndex((s) => s.id === selected),
  );
  const current = slides[index] ?? null;

  // A different deck: start at its first slide.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the deck changes
  useEffect(() => setSelected(null), [deckId]);

  // Follow the agent: jump to the slide it just added or changed.
  useEffect(() => {
    if (!lastChange) return;
    setActivityVisible(true);
    const timer = setTimeout(() => setActivityVisible(false), ACTIVITY_MS);
    const target = lastChange.slideIds.at(-1);
    if (follow && lastChange.origin.startsWith("agent:") && target) setSelected(target);
    return () => clearTimeout(timer);
  }, [lastChange, follow]);

  const go = useCallback(
    (delta: number) => {
      const next = slides[Math.min(slides.length - 1, Math.max(0, index + delta))];
      if (next) setSelected(next.id);
    },
    [slides, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const keys: Record<string, number> = {
        ArrowDown: 1,
        ArrowRight: 1,
        PageDown: 1,
        ArrowUp: -1,
        ArrowLeft: -1,
        PageUp: -1,
      };
      if (e.key in keys) {
        e.preventDefault();
        go(keys[e.key] ?? 0);
      } else if (e.key === "Home") go(-Infinity);
      else if (e.key === "End") go(Infinity);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const recent = useMemo(
    () =>
      new Set(
        activityVisible && lastChange?.origin.startsWith("agent:") ? lastChange.slideIds : [],
      ),
    [activityVisible, lastChange],
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
        {deck && deckId && slides.length > 0 && current ? (
          <>
            <SlideRail
              deck={deck}
              deckId={deckId}
              selectedId={current.id}
              recent={recent}
              onSelect={setSelected}
            />
            <main className="stage-area">
              <SlideCanvas
                className="canvas"
                deck={deck}
                deckId={deckId}
                slideId={current.id}
                padding={40}
              />
              {current.notes && (
                <aside className="notes" aria-label="Speaker notes">
                  <span className="notes-label">Notes</span>
                  <p>{current.notes}</p>
                </aside>
              )}
            </main>
          </>
        ) : (
          <EmptyState hasDeck={deck !== null} online={state.status === "online"} />
        )}
      </div>
    </div>
  );
}
