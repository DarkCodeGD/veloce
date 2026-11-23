/**
 * The command palette's list (D92), pure: what it can find (commands, settings, slides,
 * layers, components) as entries, and what a search shows of them, in sections.
 *
 * Every word typed must start a word of the name, its context or its keywords, as in the
 * Add menu ("al le" finds Align left, "3" finds slide 3), and the best matches lead
 * (`matchScore`). Each section keeps
 * only its best few, so a deck with thousands of layers still answers at once. Commands that
 * can't run right now stay listed (so they can be found) but come after those that can.
 */
import type { Deck, Node, Slide } from "@veloce/core";
import type { MenuSection } from "./insert.js";
import { nodeLabel } from "./slide-index.js";

export type PaletteKind = "command" | "setting" | "slide" | "layer" | "component";

export interface PaletteEntry {
  /** Unique across kinds: `command:edit.undo`, `slide:s1`, `layer:s1/title`. */
  id: string;
  kind: PaletteKind;
  label: string;
  /** Where it lives, shown muted and searched too: "Arrange", "Preferences", "Slide 2". */
  detail?: string;
  keywords?: string;
  /** Can't run right now (Align with nothing selected): listed, dimmed, after the rest. */
  disabled?: boolean;
}

/** Also the order of sections that match equally well: inserting a component before a layer. */
const TITLES: Record<PaletteKind, string> = {
  command: "Commands",
  setting: "Settings",
  slide: "Slides",
  component: "Components",
  layer: "Layers",
};

/** The most a search shows of each kind. */
const LIMITS: Record<PaletteKind, number> = {
  command: 30,
  setting: 8,
  slide: 8,
  layer: 12,
  component: 8,
};

/**
 * The palette's sections. With a search: the matches, by kind (commands first), each kind
 * capped. Without one: the recently run commands, then every command.
 */
export function paletteSections<T extends PaletteEntry>(
  entries: readonly T[],
  query: string,
  recent: readonly string[],
): MenuSection<T>[] {
  if (!query.trim()) {
    const commands = runnableFirst(entries.filter((e) => e.kind === "command"));
    const byId = new Map(commands.map((e) => [e.id, e]));
    const recentEntries = recent.flatMap((id) => byId.get(id) ?? []);
    return [
      ...(recentEntries.length > 0 ? [{ title: "Recent", items: recentEntries }] : []),
      ...(commands.length > 0 ? [{ title: TITLES.command, items: commands }] : []),
    ];
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const phrase = words.join(" ");
  const scored = entries.flatMap((entry) => {
    const score = matchScore(entry, words, phrase);
    return score === null ? [] : [{ entry, score }];
  });
  // Best match first; at equal scores, the ones that can run, then the list's own order.
  const rank = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    a.score - b.score || Number(a.entry.disabled ?? false) - Number(b.entry.disabled ?? false);
  scored.sort(rank);
  const sections = (Object.keys(TITLES) as PaletteKind[]).flatMap((kind) => {
    const hits = scored.filter((s) => s.entry.kind === kind).slice(0, LIMITS[kind]);
    return hits.length > 0
      ? [
          {
            best: hits[0]?.score ?? 0,
            section: { title: TITLES[kind], items: hits.map((h) => h.entry) },
          },
        ]
      : [];
  });
  // The kind with the best match leads ("1" → Slide 1 before Zoom to 100%); ties keep the
  // kinds' order (commands first).
  return sections.sort((a, b) => a.best - b.best).map((s) => s.section);
}

/** Words of a name, in any script ("Résumé", "日本"): letters and digits. */
const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * How well an entry matches the typed words, lower is better; null: it doesn't. Each word
 * must start a word of the label (a whole word scores 0, its start 1) or of the context and
 * keywords (3). A label that starts with the whole query gets a point off. So "snapping"
 * puts the Snapping setting (-1) before Preferences… (its keyword, 3), and "1" puts Slide 1
 * (a whole word, 0) before Zoom to 100% (the start of one, 1).
 */
export function matchScore(
  entry: PaletteEntry,
  words: readonly string[],
  phrase: string,
): number | null {
  const label = wordsOf(entry.label);
  const extra = wordsOf(`${entry.detail ?? ""} ${entry.keywords ?? ""}`);
  let score = 0;
  for (const word of words) {
    if (label.includes(word)) continue;
    if (label.some((l) => l.startsWith(word))) score += 1;
    else if (extra.some((e) => e.startsWith(word))) score += 3;
    else return null;
  }
  return entry.label.toLowerCase().startsWith(phrase) ? score - 1 : score;
}

/** The entries that can run first, each part in its order (a stable sort). */
const runnableFirst = <T extends PaletteEntry>(entries: T[]): T[] =>
  entries.sort((a, b) => Number(a.disabled ?? false) - Number(b.disabled ?? false));

/** "Slide 3", with its name or, failing that, its first text ("Slide 3: Our results"). */
export function slideLabel(slide: Slide, index: number): string {
  const title = slide.name ?? firstText(slide.root)?.trim();
  return `Slide ${index + 1}${title ? `: ${title}` : ""}`;
}

/** The first text layer's label, depth first (a slide's title, usually). */
function firstText(node: Node): string | undefined {
  if (node.kind === "element" && node.type === "text") return nodeLabel(node);
  if (node.kind !== "frame") return undefined;
  for (const child of node.children) {
    const found = firstText(child);
    if (found) return found;
  }
  return undefined;
}

/** Every layer of every slide (not the slides' own root frames), in layer order. */
export function deckLayers(deck: Deck): Array<{ slideId: string; slideIndex: number; node: Node }> {
  const out: Array<{ slideId: string; slideIndex: number; node: Node }> = [];
  deck.slides.forEach((slide, slideIndex) => {
    const visit = (node: Node) => {
      out.push({ slideId: slide.id, slideIndex, node });
      if (node.kind === "frame") for (const child of node.children) visit(child);
    };
    if (slide.root.kind === "frame") for (const child of slide.root.children) visit(child);
  });
  return out;
}
