/**
 * Sections in the editor (D97). A section is stored as a marker on its first slide (core
 * `fields.ts`), so commands that move or delete slides must keep the markers on the right
 * slides: like PowerPoint, a section keeps its slides when its first slide moves away or is
 * deleted, and a slide moved into a section joins it.
 *
 * Every command here works on the groups (core `deckSections`): it changes them, then writes
 * the markers back so the first slide of each named group carries its name and no other slide
 * does. Pure: it returns the ops, one transaction, one undo step.
 */
import { deckSections, type Op, type Slide } from "@veloce/core";
import type { Command } from "./commands.js";

interface Group {
  /** The first slide's ID when the groups were read: names can repeat, keys can't. */
  key: string;
  name: string | null;
  ids: string[];
}

const groupsOf = (slides: readonly Slide[]): Group[] =>
  deckSections({ slides: slides as Slide[] }).map(({ key, name, slideIds }) => ({
    key,
    name,
    ids: [...slideIds],
  }));

/** Where a slide is: its group, the group's index, and its place in it. */
function locate(groups: readonly Group[], id: string) {
  const g = groups.findIndex((group) => group.ids.includes(id));
  const group = groups[g];
  return group ? { group, g, at: group.ids.indexOf(id) } : null;
}

/**
 * The marker changes that make `slides` match `groups` (empty groups are gone: a section
 * can't be empty). The slides may still be in their old order: ops address them by ID.
 */
function markerOps(slides: readonly Slide[], groups: readonly Group[]): Op[] {
  const marker = new Map(slides.map((s) => [s.id, s.section]));
  const ops: Op[] = [];
  for (const { name, ids } of groups) {
    ids.forEach((id, i) => {
      const want = i === 0 && name !== null ? name : undefined;
      if (marker.has(id) && marker.get(id) !== want) {
        ops.push({ op: "slide.update", id, set: { section: want ?? null } });
      }
    });
  }
  return ops;
}

const flat = (groups: readonly Group[]) => groups.flatMap((g) => g.ids);
const quoted = (name: string | null) => (name === null ? "no section" : `"${name}"`);

/** One slide moved to `target` (its new place among all slides), plus the markers. */
function moveCommand(
  slides: readonly Slide[],
  groups: readonly Group[],
  id: string,
  label: string,
): Command | null {
  const order = flat(groups);
  const from = slides.findIndex((s) => s.id === id);
  const to = order.indexOf(id);
  const ops: Op[] = from !== to ? [{ op: "slide.move", id, index: to }] : [];
  ops.push(...markerOps(slides, groups));
  return ops.length > 0 ? { label, ops, select: [id] } : null;
}

/**
 * Alt+↑/↓: one place up or down inside its section; from a section's first (or last) slide,
 * into the section above (or below) without changing places, as in PowerPoint. A section
 * left with no slides is gone.
 */
export function moveSlideBy(slides: readonly Slide[], id: string, delta: -1 | 1): Command | null {
  const groups = groupsOf(slides);
  const here = locate(groups, id);
  if (!here) return null;
  const { group, g, at } = here;
  const n = slides.findIndex((s) => s.id === id) + 1;
  const to = at + delta;
  if (to >= 0 && to < group.ids.length) {
    group.ids.splice(at, 1);
    group.ids.splice(to, 0, id);
    return moveCommand(slides, groups, id, `Move slide ${n} to position ${n + delta}`);
  }
  const next = groups[g + delta];
  if (!next) return null; // the deck's first or last slide
  group.ids.splice(at, 1);
  if (delta < 0) next.ids.push(id);
  else next.ids.unshift(id);
  return moveCommand(
    slides,
    groups.filter((x) => x.ids.length > 0),
    id,
    `Move slide ${n} to ${quoted(next.name)}`,
  );
}

/** Where a dragged slide is dropped: before `index` (0 = first) in the section with `key`. */
export interface SlideSlot {
  key: string;
  index: number;
}

/** A slide dropped in the rail (between slides, or just under a section's header). */
export function moveSlideToSlot(
  slides: readonly Slide[],
  id: string,
  slot: SlideSlot,
): Command | null {
  const groups = groupsOf(slides);
  const here = locate(groups, id);
  const target = groups.find((x) => x.key === slot.key);
  if (!here || !target) return null;
  // The index counts the target's slides as they are now, the dragged one included.
  const index = here.group === target && here.at < slot.index ? slot.index - 1 : slot.index;
  here.group.ids.splice(here.at, 1);
  target.ids.splice(Math.min(index, target.ids.length), 0, id);
  const n = slides.findIndex((s) => s.id === id) + 1;
  const to = flat(groups).indexOf(id) + 1;
  const label =
    here.group === target
      ? `Move slide ${n} to position ${to}`
      : `Move slide ${n} to ${quoted(target.name)}`;
  return moveCommand(
    slides,
    groups.filter((x) => x.ids.length > 0),
    id,
    label,
  );
}

/** Delete a slide; if it started a section, the next slide in it starts it now. */
export function deleteSlideCommand(slides: readonly Slide[], slide: Slide): Command {
  const groups = groupsOf(slides);
  const here = locate(groups, slide.id);
  here?.group.ids.splice(here.at, 1);
  return {
    label: `Delete slide${slide.name ? ` "${slide.name}"` : ""}`,
    ops: [
      ...markerOps(
        slides,
        groups.filter((x) => x.ids.length > 0),
      ),
      { op: "slide.remove", id: slide.id },
    ],
  };
}

/** The section a slide is in: its name and key (its first slide), or null before any. */
export function sectionOf(slides: readonly Slide[], id: string): Group | null {
  return locate(groupsOf(slides), id)?.group ?? null;
}

/**
 * Slide → Add section: a section starting at this slide (renames the one that already starts
 * there). The slides after it, up to the next section, go with it.
 */
export function addSectionCommand(slide: Slide, name: string): Command {
  return {
    label:
      slide.section !== undefined
        ? `Rename section "${slide.section}" to "${name}"`
        : `Add section "${name}"`,
    ops: [{ op: "slide.update", id: slide.id, set: { section: name } }],
  };
}

/** Rename the section whose first slide is `key`. */
export function renameSectionCommand(slides: readonly Slide[], key: string, name: string) {
  const first = slides.find((s) => s.id === key);
  if (!first || first.section === undefined || first.section === name) return null;
  return addSectionCommand(first, name);
}

/** Remove the section (not its slides): they join the section above. */
export function removeSectionCommand(slides: readonly Slide[], key: string): Command | null {
  const first = slides.find((s) => s.id === key);
  if (!first || first.section === undefined) return null;
  return {
    label: `Remove section "${first.section}"`,
    ops: [{ op: "slide.update", id: key, set: { section: null } }],
  };
}

/**
 * Move a whole section above the one before it (-1) or below the one after it (+1). Slides
 * before the first section stay first: a section can't move above them.
 */
export function moveSectionCommand(
  slides: readonly Slide[],
  key: string,
  delta: -1 | 1,
): Command | null {
  const groups = groupsOf(slides);
  const g = groups.findIndex((x) => x.key === key);
  const group = groups[g];
  // Swapping with the one below is the one below moving up.
  const [upper, lower] = delta < 0 ? [groups[g - 1], group] : [group, groups[g + 1]];
  if (!group || group.name === null || !upper || !lower || upper.name === null) return null;
  const start = flat(groups).indexOf(upper.ids[0] ?? "");
  const ops: Op[] = lower.ids.map((id, i) => ({ op: "slide.move", id, index: start + i }));
  return {
    label: `Move section "${group.name}" ${delta < 0 ? "up" : "down"}`,
    ops,
    select: [group.ids[0] ?? key],
  };
}
