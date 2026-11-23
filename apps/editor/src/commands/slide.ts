/**
 * The Slide menu (D89): new (blank or from a layout, D95), duplicate, delete and reorder
 * slides, save one as a layout, plus going between slides with the keys (not in a menu: the
 * slide list is right there).
 */
import { run } from "../actions.js";
import { openDialog } from "../dialogs.js";
import { addSlide, deleteSlide, duplicateSlide, moveSlide } from "../model/commands.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import { type CommandContext, type EditorCommand, onSlide, slidePosition } from "./context.js";

/** The slides' keys belong to a selection when there is one (they nudge or reorder it). */
const nothingSelected = (c: CommandContext) => c.selection.length === 0;

/** Focus is in the slide list: Delete means the slide there, not a layer. */
const inSlideList = () => document.activeElement?.closest(".rail") != null;

/** Go to the slide `to(position, count)` returns, clamped to the deck. */
const goTo =
  (to: (at: number, count: number) => number) =>
  (c: CommandContext): void => {
    const slides = c.deck?.slides ?? [];
    const at = slidePosition(c);
    const next = slides[Math.min(slides.length - 1, Math.max(0, to(at, slides.length)))];
    if (next) c.goToSlide(next.id);
  };

const navigate = (
  id: string,
  label: string,
  shortcut: string,
  moreKeys: readonly string[],
  to: (at: number, count: number) => number,
): EditorCommand => ({
  id,
  label,
  shortcut,
  moreKeys,
  group: "slide",
  repeat: true,
  keyWhen: nothingSelected,
  enabled: (c) => onSlide(c) && c.deck.slides.length > 1,
  run: goTo(to),
});

const moveSlideBy = (
  id: string,
  label: string,
  shortcut: string,
  delta: -1 | 1,
): EditorCommand => ({
  id,
  label,
  shortcut,
  keywords: "reorder",
  group: "slide",
  menu: "slide",
  section: "order",
  repeat: true,
  keyWhen: nothingSelected,
  enabled: (c) => {
    if (!onSlide(c)) return false;
    const to = slidePosition(c) + delta;
    return to >= 0 && to < c.deck.slides.length;
  },
  run: (c) => {
    if (onSlide(c)) void run(moveSlide(c.deck.slides, c.slideIndex.slide.id, delta));
  },
});

export function slideCommands(): EditorCommand[] {
  return [
    {
      id: "slide.new",
      label: "New slide",
      keywords: "add page",
      group: "slide",
      menu: "slide",
      section: "make",
      enabled: (c) => c.deck !== undefined,
      run: async (c) => {
        if (!c.deck) return;
        const at = slidePosition(c);
        const command = addSlide(at === -1 ? c.deck.slides.length - 1 : at);
        if (await run(command)) c.goToSlide(command.select?.[0] ?? "");
      },
    },
    {
      id: "slide.newFromLayout",
      label: "New slide from layout…",
      keywords: "add page template title section two columns quote",
      group: "slide",
      menu: "slide",
      section: "make",
      enabled: (c) => c.deck !== undefined,
      run: () => openDialog("layouts"),
    },
    {
      id: "slide.duplicate",
      label: "Duplicate slide",
      keywords: "copy",
      group: "slide",
      menu: "slide",
      section: "make",
      enabled: onSlide,
      run: async (c) => {
        if (!onSlide(c)) return;
        const command = duplicateSlide(c.slideIndex.slide, slidePosition(c));
        if (await run(command)) c.goToSlide(command.select?.[0] ?? c.slideIndex.slide.id);
      },
    },
    {
      id: "slide.delete",
      label: "Delete slide",
      shortcut: SHORTCUTS.delete,
      moreKeys: [SHORTCUTS.backspace],
      keywords: "remove",
      group: "slide",
      menu: "slide",
      section: "make",
      keyWhen: inSlideList,
      enabled: (c) => onSlide(c) && c.deck.slides.length > 1,
      run: async (c) => {
        if (!onSlide(c)) return;
        const at = slidePosition(c);
        const next = c.deck.slides[at + 1] ?? c.deck.slides[at - 1];
        if ((await run(deleteSlide(c.slideIndex.slide), { undoToast: true })) && next) {
          c.goToSlide(next.id);
        }
      },
    },
    moveSlideBy("slide.moveUp", "Move slide up", SHORTCUTS.moveUp, -1),
    moveSlideBy("slide.moveDown", "Move slide down", SHORTCUTS.moveDown, 1),
    navigate(
      "slide.previous",
      "Previous slide",
      SHORTCUTS.previousSlide,
      ["ArrowLeft", "PageUp"],
      (at) => at - 1,
    ),
    navigate(
      "slide.next",
      "Next slide",
      SHORTCUTS.nextSlide,
      ["ArrowRight", "PageDown"],
      (at) => at + 1,
    ),
    navigate("slide.first", "First slide", SHORTCUTS.firstSlide, [], () => 0),
    navigate("slide.last", "Last slide", SHORTCUTS.lastSlide, [], (_at, count) => count - 1),
    {
      id: "slide.saveLayout",
      label: "Save slide as layout…",
      keywords: "template layout master reuse",
      group: "slide",
      menu: "slide",
      section: "layout",
      enabled: onSlide,
      run: () => openDialog("save-layout"),
    },
  ];
}
