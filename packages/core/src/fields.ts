/**
 * Slide numbers, footers and sections (D97).
 *
 * - **Sections** aren't stored as a list: a slide with `section` starts one, and it runs to
 *   the next slide that starts one. Reordering slides can never leave a list out of step.
 * - **Fields** are text runs with `field`: the renderer draws their current value (the
 *   slide's number, the deck's title…), computed here, so they're right wherever the slide
 *   moves. The run's own `text` is what it showed when written (search, copy, fallback).
 * - **The footer** is deck settings, drawn by the renderer over every slide that doesn't
 *   hide it, as a small node tree built here from the same text element and field runs.
 */
import { element, frame } from "./builders.js";
import type { Deck, Slide } from "./schema/deck.js";
import type { FrameNode } from "./schema/node.js";
import type { FieldName, TextRun } from "./schema/rich-text.js";

// ── Sections ─────────────────────────────────────────────────────────────────────────

/** A run of slides: from a slide that starts a section to the next one. */
export interface SlideSection {
  /** `null` for slides before the first section (decks without sections are all that). */
  name: string | null;
  /** The ID of its first slide: names can repeat, this can't. */
  key: string;
  /** Index of its first slide in the deck. */
  start: number;
  slideIds: string[];
}

/** The deck's slides grouped into sections, in order. Empty for a deck with no slides. */
export function deckSections(deck: Pick<Deck, "slides">): SlideSection[] {
  const sections: SlideSection[] = [];
  deck.slides.forEach((slide, index) => {
    const current = sections.at(-1);
    if (current && slide.section === undefined) current.slideIds.push(slide.id);
    else {
      sections.push({
        name: slide.section ?? null,
        key: slide.id,
        start: index,
        slideIds: [slide.id],
      });
    }
  });
  return sections;
}

/** The name of the section slide `index` is in, or null (before the first one). */
export function sectionAt(deck: Pick<Deck, "slides">, index: number): string | null {
  for (let i = Math.min(index, deck.slides.length - 1); i >= 0; i--) {
    const name = deck.slides[i]?.section;
    if (name !== undefined) return name;
  }
  return null;
}

// ── Fields ───────────────────────────────────────────────────────────────────────────

export type FieldValues = Readonly<Record<FieldName, string>>;

/** What each field shows on slide `index` of `deck`, on the day `now`. */
export function fieldValues(
  deck: Pick<Deck, "slides" | "meta">,
  index: number,
  now: Date,
): FieldValues {
  return {
    slideNumber: String(index + 1),
    slideCount: String(deck.slides.length),
    date: formatDate(now, deck.meta.language),
    deckTitle: deck.meta.title,
    section: sectionAt(deck, index) ?? "",
  };
}

export const sameFieldValues = (a: FieldValues | null, b: FieldValues | null): boolean =>
  a === b ||
  (a !== null && b !== null && (Object.keys(a) as FieldName[]).every((k) => a[k] === b[k]));

/** What a run shows: its field's value when it has one (and values are known), else its text. */
export const runText = (run: TextRun, values: FieldValues | null | undefined): string =>
  run.field && values ? values[run.field] : run.text;

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** "November 24, 2026" in the deck's language (the system's when it has none). */
export function formatDate(now: Date, language?: string): string {
  const key = language ?? "";
  let format = dateFormats.get(key);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(language || undefined, { dateStyle: "long" });
    } catch {
      format = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }); // not a real language tag
    }
    dateFormats.set(key, format);
  }
  return format.format(now);
}

const usesFields = new WeakMap<object, boolean>();

/**
 * True if `value` (an element's props) holds a field run anywhere: the renderer re-draws such
 * elements when the values change. Cached per object (props are immutable).
 */
export function hasFieldRuns(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const cached = usesFields.get(value);
  if (cached !== undefined) return cached;
  const found = Array.isArray(value)
    ? value.some(hasFieldRuns)
    : (typeof (value as { field?: unknown }).field === "string" &&
        typeof (value as { text?: unknown }).text === "string") ||
      Object.values(value).some(hasFieldRuns);
  usesFields.set(value, found);
  return found;
}

// ── Footer ───────────────────────────────────────────────────────────────────────────

/**
 * IDs of the footer's nodes. Deck IDs start with a letter or digit, so these can never
 * clash with one, and nothing that looks nodes up by ID (selection, lint, ops) finds them.
 */
export const FOOTER_ID = "_footer";
export const isFooterId = (id: string): boolean => id.startsWith(FOOTER_ID);

/** True if `slide` shows the deck's footer. */
export function showsFooter(deck: Pick<Deck, "footer">, slide: Slide): boolean {
  const f = deck.footer;
  return !!f && !slide.hideFooter && (!!f.text || !!f.slideNumber || !!f.date);
}

/**
 * The footer as nodes the renderer draws over the slide (it fills the stage, like a slide's
 * root): date left, text centered, slide number right, small and muted, inside the slide's
 * margin. Null when this slide shows no footer.
 */
export function footerNode(deck: Pick<Deck, "footer">, slide: Slide): FrameNode | null {
  if (!showsFooter(deck, slide) || !deck.footer) return null;
  const { text, slideNumber, date } = deck.footer;
  const part = (id: string, align: string, runs: TextRun[]) =>
    element(
      "text",
      { content: [{ runs }], style: "$text.small", color: "$color.muted", align },
      { id: `${FOOTER_ID}-${id}`, width: "fill" },
    );
  return frame({
    id: FOOTER_ID,
    layout: {
      mode: "stack",
      direction: "column",
      justify: "end",
      padding: { right: "$space.xl", bottom: "$space.md", left: "$space.xl" },
    },
    children: [
      frame({
        id: `${FOOTER_ID}-row`,
        width: "fill",
        layout: { mode: "stack", direction: "row", gap: "$space.md", align: "end" },
        children: [
          part("date", "left", date ? [{ text: "", field: "date" }] : []),
          part("text", "center", text ? [{ text }] : []),
          part("number", "right", slideNumber ? [{ text: "", field: "slideNumber" }] : []),
        ],
      }),
    ],
  });
}
