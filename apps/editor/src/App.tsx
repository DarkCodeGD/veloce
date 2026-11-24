import type { Slide } from "@veloce/core";
import {
  ChevronRight,
  Component as ComponentIcon,
  History,
  Layers,
  ListChecks,
  PanelLeftOpen,
  PanelRightOpen,
  PanelsTopLeft,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { revertAgentChanges, run } from "./actions.js";
import type { Panel } from "./commands/context.js";
import { AddMenu } from "./components/AddMenu.js";
import { AnimatePanel } from "./components/AnimatePanel.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { ComponentsPanel } from "./components/ComponentsPanel.js";
import { DeckInfoDialog } from "./components/DeckInfoDialog.js";
import { EditorCanvas, type TextEdit } from "./components/EditorCanvas.js";
import { EmptyState } from "./components/EmptyState.js";
import { FooterDialog } from "./components/FooterDialog.js";
import { HistoryPanel } from "./components/HistoryPanel.js";
import { Inspector } from "./components/Inspector.js";
import { IssuesPanel } from "./components/IssuesPanel.js";
import { LayersPanel } from "./components/LayersPanel.js";
import { LayoutsDialog } from "./components/LayoutsDialog.js";
import { ManageDecksDialog } from "./components/ManageDecksDialog.js";
import { NewDeckDialog } from "./components/NewDeckDialog.js";
import { PreferencesDialog } from "./components/PreferencesDialog.js";
import { PresentView } from "./components/PresentView.js";
import { SaveComponentDialog } from "./components/SaveComponentDialog.js";
import { SectionDialog } from "./components/SectionDialog.js";
import { ShortcutsDialog } from "./components/ShortcutsDialog.js";
import { SlideRail } from "./components/SlideRail.js";
import { Splitter } from "./components/Splitter.js";
import { ThemeStylesDialog } from "./components/ThemeStylesDialog.js";
import { Toasts } from "./components/Toasts.js";
import { Tooltips } from "./components/Tooltips.js";
import { TopBar } from "./components/TopBar.js";
import { useArrowNudge } from "./components/useArrowNudge.js";
import { useClipboard } from "./components/useClipboard.js";
import { SaveVersionDialog, VersionsDialog } from "./components/VersionsDialog.js";
import { syncDeckFonts } from "./deck-fonts.js";
import { closeDialog, openDialog, useOpenDialog } from "./dialogs.js";
import { setCommandContext } from "./editor-commands.js";
import { assetUrl, client } from "./editor-context.js";
import { setPanelCollapsed, togglePanel, updatePanel, useLayout } from "./layout.js";
import { layerSeverities, slideBadges, withoutMuted } from "./model/lint-view.js";
import { editableText, pickTarget, pruneSelection } from "./model/selection.js";
import { indexSlide } from "./model/slide-index.js";
import { type PanelId, type PanelLayout, panelLayout, panelSpec } from "./model/workspace.js";
import { usePresenting } from "./present.js";
import { previewDeck, previewStore } from "./preview.js";
import { useSettings } from "./settings.js";

const ACTIVITY_MS = 6000;

/** The left panel's tabs. Inactive ones show just their icon (the name is a tooltip). */
const TABS: Array<{ id: Panel; label: string; icon: typeof History }> = [
  { id: "slides", label: "Slides", icon: PanelsTopLeft },
  { id: "layers", label: "Layers", icon: Layers },
  { id: "history", label: "History", icon: History },
  { id: "issues", label: "Issues", icon: ListChecks },
  { id: "components", label: "Components", icon: ComponentIcon },
];

/** A resizable panel's size and window cap, as the CSS reads them (`--panel-size`). */
function panelStyle(workspace: string, id: PanelId, layout: PanelLayout): CSSProperties {
  const size = panelSpec(workspace, id)?.size;
  if (!size) return {};
  return {
    "--panel-size": `${layout.size}px`,
    "--panel-cap": `${size.maxShare * 100}${size.axis === "x" ? "vw" : "vh"}`,
  } as CSSProperties;
}

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
  const presenting = usePresenting();
  const prefs = useSettings();
  const [follow, setFollow] = useState(prefs.ai.followAI);
  // Follow AI starts as Preferences say (D91), once they arrive and whenever they change.
  useEffect(() => setFollow(prefs.ai.followAI), [prefs.ai.followAI]);
  const [activityVisible, setActivityVisible] = useState(false);
  // The workspace's panels (D90): sizes and collapsed states, remembered across launches.
  const layout = useLayout();
  const left = panelLayout(layout, "left");
  const inspector = panelLayout(layout, "inspector");
  const notes = panelLayout(layout, "notes");
  const leftRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);

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
    // Declared below; it's only called later, once it exists.
    reveal: (slideId, ids) => reveal(slideId, ids),
    panel,
    // A tab asked for (View, Alt+digit) opens the left panel if it's collapsed.
    showPanel: (next) => {
      setPanel(next);
      setPanelCollapsed("left", false);
    },
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
  // What the editor shows of it: nothing when it's off in Preferences, never muted rules (D91).
  const lintOn = prefs.editing.lint;
  const mutedRules = prefs.editing.mutedRules;
  const lint = useMemo(
    () => (lintOn ? withoutMuted(state.lint, mutedRules) : null),
    [lintOn, mutedRules, state.lint],
  );
  const lintIssues = lint?.issues;
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
      <div className="workspace" data-workspace={layout.workspace}>
        {deck && deckId && current && slideIndex ? (
          <>
            <div
              ref={leftRef}
              id="left-panel"
              className="left-panel"
              style={panelStyle(layout.workspace, "left", left)}
              data-collapsed={left.collapsed || undefined}
            >
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
                ) : panel === "components" ? (
                  <ComponentsPanel deck={deck} deckId={deckId} />
                ) : panel === "issues" ? (
                  <IssuesPanel
                    deck={deck}
                    version={state.version}
                    lint={lint}
                    off={!lintOn}
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
            <PanelSplitter
              workspace={layout.workspace}
              id="left"
              layout={left}
              grow={1}
              panel={leftRef}
            />
            <main className="stage-area">
              {left.collapsed && (
                <button
                  type="button"
                  className="icon-button panel-reveal is-left"
                  aria-label="Show left panel"
                  data-tip="Show left panel"
                  aria-controls="left-panel"
                  onClick={() => setPanelCollapsed("left", false)}
                >
                  <PanelLeftOpen size={16} aria-hidden />
                </button>
              )}
              {inspector.collapsed && (
                <button
                  type="button"
                  className="icon-button panel-reveal is-right"
                  aria-label="Show inspector"
                  data-tip="Show inspector"
                  aria-controls="inspector-panel"
                  onClick={() => setPanelCollapsed("inspector", false)}
                >
                  <PanelRightOpen size={16} aria-hidden />
                </button>
              )}
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
              <NotesEditor
                slide={current}
                collapsed={notes.collapsed}
                onToggle={() => togglePanel("notes")}
              />
            </main>
            <PanelSplitter
              workspace={layout.workspace}
              id="inspector"
              layout={inspector}
              grow={-1}
              panel={inspectorRef}
            />
            <div
              ref={inspectorRef}
              id="inspector-panel"
              className="inspector-panel"
              style={panelStyle(layout.workspace, "inspector", inspector)}
              data-collapsed={inspector.collapsed || undefined}
            >
              {layout.workspace === "animate" ? (
                <AnimatePanel
                  deck={deck}
                  slide={current}
                  index={slideIndex}
                  selection={selection}
                  onSelect={setSelection}
                />
              ) : (
                <Inspector
                  deck={deck}
                  slide={current}
                  selection={selection}
                  onSelect={setSelection}
                />
              )}
            </div>
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
      {dialog === "decks" && <ManageDecksDialog onClose={closeDialog} />}
      {dialog === "deck-info" && deck && <DeckInfoDialog deck={deck} onClose={closeDialog} />}
      {dialog === "theme-styles" && deck && <ThemeStylesDialog deck={deck} onClose={closeDialog} />}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={closeDialog} />}
      {dialog === "preferences" && <PreferencesDialog onClose={closeDialog} />}
      {dialog === "save-version" && deck && <SaveVersionDialog onClose={closeDialog} />}
      {dialog === "versions" && deck && <VersionsDialog deckId={deck.id} onClose={closeDialog} />}
      {dialog === "save-component" && deck && <SaveComponentDialog onClose={closeDialog} />}
      {dialog === "save-layout" && deck && <SaveComponentDialog layout onClose={closeDialog} />}
      {dialog === "footer" && deck && <FooterDialog deck={deck} onClose={closeDialog} />}
      {dialog === "section" && deck && <SectionDialog deck={deck} onClose={closeDialog} />}
      {dialog === "layouts" && deck && deckId && (
        <LayoutsDialog deck={deck} deckId={deckId} onClose={closeDialog} />
      )}
      {presenting && deck && deckId && (
        <PresentView deck={deck} deckId={deckId} from={presenting.from} />
      )}
      <CommandPalette deck={deck ?? undefined} />
      <AddMenu />
      <Toasts />
      <Tooltips />
    </div>
  );
}

/** The splitter on a resizable panel's edge, if the workspace's panel resizes. */
function PanelSplitter({
  workspace,
  id,
  ...rest
}: {
  workspace: string;
  id: PanelId;
  layout: PanelLayout;
  grow: 1 | -1;
  panel: React.RefObject<HTMLElement | null>;
}) {
  const spec = panelSpec(workspace, id);
  if (!spec?.size) return null;
  return (
    <Splitter
      label={spec.label}
      spec={spec.size}
      panelId={`${id}-panel`}
      onChange={(patch) => updatePanel(id, patch)}
      {...rest}
    />
  );
}

/**
 * Speaker notes, editable in place; saved when the field loses focus. Its header collapses
 * it to give the canvas the room (D90), like PowerPoint's Notes button.
 */
function NotesEditor({
  slide,
  collapsed,
  onToggle,
}: {
  slide: Slide;
  collapsed: boolean;
  onToggle(): void;
}) {
  const [draft, setDraft] = useState(slide.notes ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(slide.notes ?? "");
  }, [slide.notes, editing]);
  return (
    <div className="notes" data-collapsed={collapsed || undefined}>
      <button
        type="button"
        className="notes-label"
        aria-expanded={!collapsed}
        aria-controls="notes"
        data-tip={collapsed ? "Show speaker notes" : "Hide speaker notes"}
        onClick={onToggle}
      >
        <ChevronRight size={12} className="notes-chevron" aria-hidden />
        Speaker notes
      </button>
      <textarea
        id="notes"
        aria-label="Speaker notes"
        hidden={collapsed}
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
