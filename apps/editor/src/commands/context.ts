/**
 * What a registry command sees of the editor (D81, D89): the open deck and slide, the
 * selection, and the few UI switches commands flip. App keeps it current
 * (`setCommandContext`), so a command never reaches into a component.
 */
import type { Deck } from "@veloce/core";
import type { LucideIcon } from "lucide-react";
import type { InsertContext } from "../insert-actions.js";
import type { CommandSpec } from "../model/command-registry.js";
import type { SlideIndex } from "../model/slide-index.js";

/** The left panel's tabs. */
export type Panel = "slides" | "layers" | "history" | "issues";

export interface CommandContext {
  /** The open deck, if any (it may have no slides yet). */
  deck?: Deck;
  /** The slide on screen, if any. */
  slideIndex?: SlideIndex;
  selection: readonly string[];
  select(ids: string[]): void;
  /** Start typing into a text layer, all of its text selected. */
  editText(id: string): void;
  goToSlide(id: string): void;
  /** Go to a slide and select layers on it (a slide change alone clears the selection). */
  reveal(slideId: string, ids: string[]): void;
  panel: Panel;
  showPanel(panel: Panel): void;
  /** Follow AI: jump to the slide an agent is working on. */
  follow: boolean;
  setFollow(follow: boolean): void;
}

/** The context with a slide on screen. */
export type SlideContext = CommandContext & InsertContext;

/** A slide is open: there's somewhere to add to and something to act on. */
export const onSlide = (c: CommandContext): c is SlideContext =>
  c.deck !== undefined && c.slideIndex !== undefined;

/** A slide is open and something on it is selected. */
export const hasSelection = (c: CommandContext): c is SlideContext =>
  onSlide(c) && c.selection.length > 0;

/** The one selected layer, if exactly one is. */
export const onlySelected = (c: CommandContext): string | undefined =>
  c.selection.length === 1 ? c.selection[0] : undefined;

/** Where the slide on screen sits in the deck (-1 with none). */
export const slidePosition = (c: CommandContext): number =>
  c.deck && c.slideIndex ? c.deck.slides.findIndex((s) => s.id === c.slideIndex?.slide.id) : -1;

/** A built-in command as the app registers it (icons are lucide components). */
export type EditorCommand = CommandSpec<CommandContext, LucideIcon>;
