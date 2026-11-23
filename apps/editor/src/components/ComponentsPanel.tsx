/**
 * The Components tab (D94): the deck's saved components, A to Z, each drawn on its own. A click
 * inserts a copy (where the Add menu would put a new layer); the bin forgets the component,
 * as one undoable step, and copies already on slides stay.
 */
import type { Component, Deck } from "@veloce/core";
import { Component as ComponentIcon, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { run } from "../actions.js";
import { insertComponent } from "../insert-actions.js";
import {
  componentPreviewDeck,
  PREVIEW_SLIDE_ID,
  removeComponentCommand,
} from "../model/components.js";
import { SlideCanvas } from "./SlideCanvas.js";

export function ComponentsPanel({ deck, deckId }: { deck: Deck; deckId: string }) {
  // By name, so the list keeps its order whatever happens to the deck's (an undone delete
  // adds the component back last).
  // Slide layouts (D95) live in Slide → New slide from layout, not here.
  const all = Object.entries(deck.components ?? {})
    .filter(([, c]) => !c.slide)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  if (all.length === 0) {
    return (
      <div className="panel-empty components-empty">
        <ComponentIcon size={24} aria-hidden="true" />
        <p>No components yet.</p>
        <p className="dialog-hint">
          Select a layer, then Arrange → Save as component, to insert copies of it anywhere. Agents
          can save and use them too.
        </p>
      </div>
    );
  }
  return (
    <ul className="components-list" aria-label="Components">
      {all.map(([name, component]) => (
        <ComponentItem key={name} name={name} component={component} deck={deck} deckId={deckId} />
      ))}
    </ul>
  );
}

function ComponentItem({
  name,
  component,
  deck,
  deckId,
}: {
  name: string;
  component: Component;
  deck: Deck;
  deckId: string;
}) {
  // Rebuilt when the component or what it's drawn with changes, not on every edit.
  const { theme, assets, stage } = deck;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deck's other fields don't show
  const preview = useMemo(
    () => componentPreviewDeck(deck, component),
    [component, theme, assets, stage],
  );
  const params = Object.keys(component.params ?? {});
  return (
    <li className="component-item">
      <button
        type="button"
        className="component-insert"
        data-tip="Insert a copy"
        onClick={() => void insertComponent(name)}
      >
        <SlideCanvas
          className="component-preview"
          deck={preview}
          deckId={deckId}
          slideId={PREVIEW_SLIDE_ID}
          padding={10}
          focus={component.node.id}
          lazy
          decorative
        />
        <span className="component-text">
          <span className="component-name">{name}</span>
          {(component.description || params.length > 0) && (
            <span className="component-meta">
              {component.description ?? `Params: ${params.join(", ")}`}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="icon-button component-delete"
        aria-label={`Delete component “${name}”`}
        data-tip="Delete component"
        onClick={() =>
          void run(removeComponentCommand(name), { undoToast: `Deleted component "${name}"` })
        }
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </li>
  );
}
