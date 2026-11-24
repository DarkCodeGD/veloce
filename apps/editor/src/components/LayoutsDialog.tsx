/**
 * Slide → New slide from layout… (D95): every slide layout this deck can use, drawn in its
 * theme, the deck's own first. A click adds a slide from it after the one on screen and goes
 * there. The deck's own layouts can be deleted (one undo step; slides made from them stay);
 * built-in ones always exist.
 */
import { type Component, type Deck, slideLayouts } from "@veloce/core";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { run } from "../actions.js";
import { slidePosition } from "../commands/context.js";
import { openSectionDialog } from "../dialogs.js";
import { commandContext } from "../editor-commands.js";
import {
  LAYOUT_PREVIEW_ID,
  layoutPreviewDeck,
  newSlideFromLayoutCommand,
  removeComponentCommand,
} from "../model/components.js";
import { Dialog } from "./Dialog.js";
import { SlideCanvas } from "./SlideCanvas.js";

/**
 * Add a slide from layout `name` after the one on screen and go there (this dialog and the
 * command palette). A Section header's title is the section's name (D97), so the Add section
 * dialog opens next for it; Cancel leaves the slide in the section it landed in.
 */
export async function newSlideFromLayout(name: string): Promise<boolean> {
  const c = commandContext();
  if (!c.deck) return false;
  const at = slidePosition(c);
  const command = newSlideFromLayoutCommand(
    c.deck,
    name,
    at === -1 ? c.deck.slides.length - 1 : at,
  );
  if (!command || !(await run(command))) return false;
  const id = command.select?.[0] ?? "";
  c.goToSlide(id);
  if (command.nameSection) openSectionDialog({ slideId: id, rename: false });
  return true;
}

export function LayoutsDialog({
  deck,
  deckId,
  onClose,
}: {
  deck: Deck;
  deckId: string;
  onClose(): void;
}) {
  const layouts = slideLayouts(deck);

  // Close first: the section dialog may open next, and only one dialog shows at a time.
  const add = (name: string) => {
    onClose();
    void newSlideFromLayout(name);
  };

  return (
    <Dialog
      title="New slide from layout"
      className="layouts-dialog"
      onClose={onClose}
      onSubmit={onClose}
      actions={
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <p className="dialog-hint">
        Pick a layout for the new slide. Save one of your own with Slide → Save slide as layout.
      </p>
      <ul className="layouts-grid" aria-label="Slide layouts">
        {layouts.map(({ name, component, builtin }) => (
          <LayoutCard
            key={name}
            name={name}
            layout={component}
            builtin={builtin}
            deck={deck}
            deckId={deckId}
            onPick={() => add(name)}
          />
        ))}
      </ul>
    </Dialog>
  );
}

function LayoutCard({
  name,
  layout,
  builtin,
  deck,
  deckId,
  onPick,
}: {
  name: string;
  layout: Component;
  builtin: boolean;
  deck: Deck;
  deckId: string;
  onPick(): void;
}) {
  const { theme, assets, stage } = deck;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deck's other fields don't show
  const preview = useMemo(
    () => layoutPreviewDeck(deck, name, layout),
    [name, layout, theme, assets, stage],
  );
  return (
    <li className="layout-card">
      <button type="button" className="layout-pick" onClick={onPick}>
        <SlideCanvas
          className="thumb-view"
          deck={preview}
          deckId={deckId}
          slideId={LAYOUT_PREVIEW_ID}
          padding={0}
          lazy
          decorative
        />
        <span className="layout-name">{name}</span>
        <span className="layout-meta">{builtin ? "Built in" : "This deck"}</span>
      </button>
      {!builtin && (
        <button
          type="button"
          className="icon-button layout-delete"
          aria-label={`Delete layout “${name}”`}
          data-tip="Delete layout"
          onClick={() =>
            void run(removeComponentCommand(name, true), { undoToast: `Deleted layout "${name}"` })
          }
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
