/**
 * Presenting (D116): the deck fullscreen, played by the clock (D115), one click at a time.
 * The first slice of presenter mode: speaker notes, the timer, a second window and the
 * laser pointer come with presenter mode itself.
 *
 * A native modal `<dialog>` taken fullscreen: the editor behind it is inert and its keys
 * don't reach the editor's shortcuts. Esc leaves (the browser's own Esc leaves fullscreen
 * first, and leaving fullscreen ends the presentation). If fullscreen is refused, the
 * dialog still fills the window.
 *
 * It presents the deck as it was when it started: an edit arriving meanwhile (an agent at
 * work) doesn't restart the slide on screen.
 */
import type { Deck } from "@veloce/core";
import { SlidePlayer, SlideView } from "@veloce/renderer";
import { useEffect, useRef, useState } from "react";
import { assetUrl, registry } from "../editor-context.js";
import { Presentation, type PresentationState, startIndex } from "../model/presentation.js";
import { stopPresenting } from "../present.js";

/** Keys that move on or back, as in PowerPoint, Keynote and Google Slides. */
const NEXT = new Set(["ArrowRight", "ArrowDown", " ", "PageDown", "Enter", "n", "N"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"]);
/** The pointer hides when it hasn't moved for this long. */
const CURSOR_IDLE_MS = 2000;

export function PresentView({
  deck,
  deckId,
  from,
}: {
  deck: Deck;
  deckId: string;
  from: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const presentation = useRef<Presentation | null>(null);
  const [state, setState] = useState<PresentationState>({ index: 0, ended: false });
  const [idle, setIdle] = useState(false);
  // The deck and slide it started with: later edits don't touch the show.
  const start = useRef({ deck, deckId, from });

  useEffect(() => {
    const el = dialog.current;
    const box = viewport.current;
    if (!el || !box) return;
    el.showModal();
    el.focus();
    const { deck, deckId, from } = start.current;
    const view = new SlideView(box, {
      registry,
      padding: 0,
      assetUrl: (id) => assetUrl(deckId, id),
    });
    const player = new SlidePlayer(view, { effects: registry.resolveEffect });
    const show = new Presentation(deck, player, {
      ready: () => view.ready(),
      onChange: setState,
    });
    presentation.current = show;
    void show.start(startIndex(deck, from));

    // Leaving fullscreen (Esc, F11, the OS) ends the show; never entering it doesn't.
    let wasFullscreen = false;
    const onFullscreen = () => {
      if (document.fullscreenElement === el) wasFullscreen = true;
      else if (wasFullscreen) stopPresenting();
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    el.requestFullscreen?.().catch(() => {}); // refused (no user gesture, a test): fill the window

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      presentation.current = null;
      player.dispose();
      view.dispose();
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
      el.close();
    };
  }, []);

  // The pointer hides while it rests, and comes back when it moves.
  useEffect(() => {
    if (idle) return;
    const timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS);
    return () => clearTimeout(timer);
  }, [idle]);

  const next = () => {
    void presentation.current?.next().then((more) => more || stopPresenting());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const show = presentation.current;
    if (!show || e.ctrlKey || e.metaKey || e.altKey) return;
    if (NEXT.has(e.key)) next();
    else if (PREVIOUS.has(e.key)) void show.previous();
    else if (e.key === "Home") void show.first();
    else if (e.key === "End") void show.last();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <dialog
      ref={dialog}
      className={`present${idle ? " present-idle" : ""}`}
      aria-label={`Presenting ${deck.meta.title}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClick={next}
      onPointerMove={() => setIdle(false)}
      onCancel={(e) => {
        e.preventDefault(); // Esc: unmounting closes the dialog
        stopPresenting();
      }}
    >
      <div ref={viewport} className="present-stage" hidden={state.ended} />
      {state.ended && <p className="present-end">End of presentation. Click to exit.</p>}
    </dialog>
  );
}
