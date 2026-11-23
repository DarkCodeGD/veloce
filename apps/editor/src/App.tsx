import type { Slide } from "@veloce/core";
import { History, Layers, ListChecks, PanelsTopLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { revertAgentChanges, run } from "./actions.js";
import type { Panel } from "./commands/context.js";
import { AddMenu } from "./components/AddMenu.js";
import { DeckInfoDialog } from "./components/DeckInfoDialog.js";
import { EditorCanvas, type TextEdit } from "./components/EditorCanvas.js";
import { EmptyState } from "./components/EmptyState.js";
import { HistoryPanel } from "./components/HistoryPanel.js";
import { Inspector } from "./components/Inspector.js";
import { IssuesPanel } from "./components/IssuesPanel.js";
import { LayersPanel } from "./components/LayersPanel.js";
import { NewDeckDialog } from "./components/NewDeckDialog.js";
import { ShortcutsDialog } from "./components/ShortcutsDialog.js";
import { SlideRail } from "./components/SlideRail.js";
import { ThemeStylesDialog } from "./components/ThemeStylesDialog.js";
import { Toasts } from "./components/Toasts.js";
import { Tooltips } from "./components/Tooltips.js";
import { TopBar } from "./components/TopBar.js";
import { useArrowNudge } from "./components/useArrowNudge.js";
import { useClipboard } from "./components/useClipboard.js";
import { syncDeckFonts } from "./deck-fonts.js";
import { closeDialog, openDialog, useOpenDialog } from "./dialogs.js";
import { setCommandContext } from "./editor-commands.js";
import { assetUrl, client } from "./editor-context.js";
import { layerSeverities, slideBadges } from "./model/lint-view.js";
import { editableText, pickTarget, pruneSelection } from "./model/selection.js";
import { indexSlide } from "./model/slide-index.js";
import { previewDeck, previewStore } from "./preview.js";

const ACTIVITY_MS = 6000;

/** The left panel's tabs. Inactive ones show just their icon (the name is a tooltip). */
const TABS: Array<{ id: Panel; label: string; icon: typeof History }> = [
  { id: "slides", label: "Slides", icon: PanelsTopLeft },
  { id: "layers", label: "Layers", icon: Layers },
  { id: "history", label: "History", icon: History },
  { id: "issues", label: "Issues", icon: ListChecks },
];

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
  /** The open app dialog, if any (D76–D78). */
  const dialog = useOpenDialog();
  const [follow, setFollow] = useState(true);
  const [activityVisible, setActivityVisible] = useState(false);

  const index = Math.max(
    0,
    slides.findIndex((s) => s.id === slideId),
  );
  const current: Slide | null = slides[index] ?? null;
  const slideIndex = current ? indexSlide(current) : null;
  // What registry commands act on (D81, D89). Set while rendering, so the menu bar and tool
  // bar rendered below already see this deck and selection.
  setCommandContext({
    ...(deck && { deck }),
    ...(deck && current && slideIndex && { slideIndex }),
    selection,
    select: setSelection,
    editText: (id) => {
      setSelection([id]);
      setEditing({ id, caret: "all" });
    },
    goToSlide: setSlideId,
    panel,
    showPanel: setPanel,
    follow,
    setFollow,
  });
  useArrowNudge(slideIndex, selection);
  useClipboard(deck, slideIndex, selection, setSelection);

  // A different deck: start at its first slide. A different slide: nothing selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the deck changes
  useEffect(() => setSlideId(null), [deckId]);

  // The deck's own fonts (dropped in, or added by an agent), for every view in this tab.
  const assets = deck?.assets;
  useEffect(() => {
    if (assets && deckId) void syncDeckFonts({ assets }, (id) => assetUrl(deckId, id));
  }, [assets, deckId]);
  /** Layers to select once the slide being opened shows (an issue clicked on another slide). */
  const pendingSelection = useRef<string[] | null>(null);
  // A different slide: nothing selected, unless we came here to select something.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the slide changes
  useEffect(() => {
    setSelection(pendingSelection.current ?? []);
    pendingSelection.current = null;
  }, [current?.id]);
  const reveal = useCallback(
    (target: string, ids: string[]) => {
      if (target === current?.id) setSelection(ids);
      else {
        pendingSelection.current = ids;
        setSlideId(target);
      }
    },
    [current?.id],
  );
  // Lint (D73): badges on thumbnails, layers and the Issues tab.
  const lintIssues = state.lint?.issues;
  const badges = useMemo(() => slideBadges(lintIssues ?? []), [lintIssues]);
  const layerIssues = useMemo(
    () => layerSeverities(lintIssues ?? [], current?.id ?? ""),
    [lintIssues, current?.id],
  );
  const problems = useMemo(() => {
    let count = 0;
    let worst: "error" | "warning" | null = null;
    for (const badge of badges.values()) {
      count += badge.count;
      if (badge.worst === "error") worst = "error";
      else if (!worst && badge.worst === "warning") worst = "warning";
    }
    return { count, worst };
  }, [badges]);
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
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={panel === id}
                    data-tip={panel === id ? undefined : label}
                    onClick={() => setPanel(id)}
                  >
                    <Icon size={14} aria-hidden />
                    <span className="tab-label">{label}</span>
                    {id === "issues" && problems.count > 0 && (
                      <span className={`tab-badge is-${problems.worst}`}>
                        {problems.count}
                        <span className="sr-only">
                          {" "}
                          {problems.count === 1 ? "problem" : "problems"}
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="tab-panel" role="tabpanel">
                {panel === "slides" ? (
                  <SlideRail
                    deck={deck}
                    deckId={deckId}
                    selectedId={current.id}
                    recent={recent}
                    issues={badges}
                    onSelect={setSlideId}
                  />
                ) : panel === "layers" ? (
                  <LayersPanel
                    slide={current}
                    selection={selection}
                    issues={layerIssues}
                    onSelect={select}
                    onHover={setLayerHover}
                  />
                ) : panel === "issues" ? (
                  <IssuesPanel
                    deck={deck}
                    version={state.version}
                    lint={state.lint}
                    currentSlideId={current.id}
                    onReveal={reveal}
                  />
                ) : (
                  <HistoryPanel
                    history={state.history}
                    slides={slides}
                    currentSlideId={current.id}
                    onGoToSlide={setSlideId}
                    onRevert={revertAgentChanges}
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
          <EmptyState
            hasDeck={deck !== null}
            online={state.status === "online"}
            onNewDeck={() => openDialog("new-deck")}
          />
        )}
      </div>
      {dialog === "new-deck" && <NewDeckDialog onClose={closeDialog} />}
      {dialog === "deck-info" && deck && <DeckInfoDialog deck={deck} onClose={closeDialog} />}
      {dialog === "theme-styles" && deck && <ThemeStylesDialog deck={deck} onClose={closeDialog} />}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={closeDialog} />}
      <AddMenu />
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
