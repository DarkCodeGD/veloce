/**
 * The Slide menu (D89): new (blank or from a layout, D95), duplicate, delete and reorder
 * slides, save one as a layout, sections (D97), plus going between slides with the keys (not
 * in a menu: the slide list is right there). Insert → Footer and slide numbers… lives here
 * too: it's about every slide.
 */
import { run } from "../actions.js";
import { openDialog, openSectionDialog } from "../dialogs.js";
import { addSlide, duplicateSlide } from "../model/commands.js";
import {
  deleteSlideCommand,
  moveSectionCommand,
  moveSlideBy as moveSlideCommand,
  removeSectionCommand,
  sectionOf,
} from "../model/sections.js";
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
  // Section-aware (D97): from a section's edge it moves into the next section first.
  enabled: (c) =>
    onSlide(c) && moveSlideCommand(c.deck.slides, c.slideIndex.slide.id, delta) !== null,
  run: (c) => {
    if (onSlide(c)) void run(moveSlideCommand(c.deck.slides, c.slideIndex.slide.id, delta));
  },
});

/** The named section the slide on screen is in (D97), or null. */
const currentSection = (c: CommandContext) => {
  if (!onSlide(c)) return null;
  const section = sectionOf(c.deck.slides, c.slideIndex.slide.id);
  return section?.name != null ? section : null;
};

const moveSectionBy = (id: string, label: string, delta: -1 | 1): EditorCommand => ({
  id,
  label,
  keywords: "reorder section",
  group: "slide",
  menu: "slide",
  section: "sections",
  enabled: (c) => {
    const section = currentSection(c);
    return !!section && !!c.deck && moveSectionCommand(c.deck.slides, section.key, delta) !== null;
  },
  run: (c) => {
    const section = currentSection(c);
    if (section && c.deck) void run(moveSectionCommand(c.deck.slides, section.key, delta));
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
        const command = deleteSlideCommand(c.deck.slides, c.slideIndex.slide);
        if ((await run(command, { undoToast: true })) && next) {
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
      id: "slide.addSection",
      label: "Add section…",
      keywords: "group chapter part",
      group: "slide",
      menu: "slide",
      section: "sections",
      enabled: onSlide,
      run: (c) => {
        if (onSlide(c)) openSectionDialog({ slideId: c.slideIndex.slide.id, rename: false });
      },
    },
    {
      id: "slide.renameSection",
      label: "Rename section…",
      keywords: "group chapter part",
      group: "slide",
      menu: "slide",
      section: "sections",
      enabled: (c) => currentSection(c) !== null,
      run: (c) => {
        const section = currentSection(c);
        if (section) openSectionDialog({ slideId: section.key, rename: true });
      },
    },
    {
      id: "slide.removeSection",
      label: "Remove section",
      keywords: "group chapter part ungroup",
      group: "slide",
      menu: "slide",
      section: "sections",
      enabled: (c) => currentSection(c) !== null,
      run: (c) => {
        const section = currentSection(c);
        if (section && c.deck) {
          void run(removeSectionCommand(c.deck.slides, section.key), { undoToast: true });
        }
      },
    },
    moveSectionBy("slide.moveSectionUp", "Move section up", -1),
    moveSectionBy("slide.moveSectionDown", "Move section down", 1),
    {
      id: "insert.footer",
      label: "Footer and slide numbers…",
      keywords: "header page number date footer",
      group: "slide",
      menu: "insert",
      section: "deck",
      enabled: (c) => c.deck !== undefined,
      run: () => openDialog("footer"),
    },
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
