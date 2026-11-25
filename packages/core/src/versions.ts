/**
 * Versions (D93): named copies of a deck, saved inside its `.veloce` file, to look back at
 * and restore. A safety net before an agent rewrites a deck.
 *
 * Saving or deleting a version isn't an op (it changes no slide, so there's nothing to
 * undo). Restoring one is: `restoreOps` turns the deck into the version as one ordinary,
 * invertible transaction, so Ctrl+Z brings back what was there (golden rules 1 and 7).
 *
 * (The sync protocol's `snapshot` message is something else: a deck sent to a tab.)
 */
import { z } from "zod";
import { randomId } from "./ids.js";
import type { Op } from "./ops/schema.js";
import type { Deck, DeckMeta } from "./schema/deck.js";

/** The most versions one deck keeps. Each costs its JSON only (assets are shared). */
export const MAX_VERSIONS = 100;

export const VERSION_ID_PATTERN = /^vr_[a-z0-9]{10}$/;

export const VersionNameSchema = z.string().trim().min(1).max(100);

/** A version as lists show it: no deck. */
export interface VersionInfo {
  id: string;
  name: string;
  /** ISO timestamp. */
  savedAt: string;
  slideCount: number;
}

/** A saved version: the deck exactly as it was. */
export interface DeckVersion {
  id: string;
  name: string;
  savedAt: string;
  deck: Deck;
}

export const newVersionId = (): string => `vr_${randomId(10)}`;

export const versionInfo = ({ id, name, savedAt, deck }: DeckVersion): VersionInfo => ({
  id,
  name,
  savedAt,
  slideCount: deck.slides.length,
});

/**
 * The ops that turn `current` into `target` (an older copy of the same deck): its slides,
 * theme, footer, title and other meta, components, presets, and the assets it registered. One transaction, so undo puts
 * everything back. The stage (slide size) isn't changed: no op can, and a deck keeps its own.
 *
 * Every current slide is removed and every saved one inserted, even an unchanged one: plain
 * and always correct, and the history keeps a big step only for as long as it keeps any.
 */
export function restoreOps(current: Deck, target: Deck): Op[] {
  const ops: Op[] = [];
  for (const slide of current.slides) ops.push({ op: "slide.remove", id: slide.id });
  // Components that differ go before the assets (they may hold the last use of one), and
  // the version's come back after them (they may need one it adds).
  const before = current.components ?? {};
  const after = target.components ?? {};
  const changed = (name: string) =>
    !Object.hasOwn(after, name) || JSON.stringify(before[name]) !== JSON.stringify(after[name]);
  for (const name of Object.keys(before)) {
    if (changed(name)) ops.push({ op: "component.remove", name });
  }
  // Assets: drop what the version didn't have (nothing uses them once the slides are gone),
  // add what it had (bytes the server kept for it).
  for (const id of Object.keys(current.assets)) {
    if (!Object.hasOwn(target.assets, id)) ops.push({ op: "asset.remove", id });
  }
  for (const [id, asset] of Object.entries(target.assets)) {
    if (!Object.hasOwn(current.assets, id)) ops.push({ op: "asset.add", id, asset });
  }
  for (const [name, component] of Object.entries(after)) {
    if (!Object.hasOwn(before, name) || changed(name)) {
      ops.push({ op: "component.save", name, component });
    }
  }
  // Presets (D119): the slides that play them are gone by now, so any can go; the version's
  // come back before its slides, which may play them.
  const presetsBefore = current.presets ?? {};
  const presetsAfter = target.presets ?? {};
  for (const name of Object.keys(presetsBefore)) {
    if (!Object.hasOwn(presetsAfter, name)) ops.push({ op: "preset.remove", name });
  }
  for (const [name, preset] of Object.entries(presetsAfter)) {
    if (JSON.stringify(presetsBefore[name]) !== JSON.stringify(preset)) {
      ops.push({ op: "preset.save", name, preset });
    }
  }
  target.slides.forEach((slide, index) => {
    ops.push({ op: "slide.insert", slide, index });
  });
  if (JSON.stringify(current.theme) !== JSON.stringify(target.theme)) {
    ops.push({ op: "deck.setTheme", theme: target.theme });
  }
  if (JSON.stringify(current.footer) !== JSON.stringify(target.footer)) {
    ops.push({ op: "deck.setFooter", footer: target.footer ?? null });
  }
  const meta = metaPatch(current.meta, target.meta);
  if (meta) ops.push({ op: "deck.updateMeta", set: meta });
  return ops;
}

/** A merge patch from one meta to another (null removes a field), or null if they match. */
function metaPatch(from: DeckMeta, to: DeckMeta): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]) as Set<keyof DeckMeta>;
  for (const key of keys) {
    const before = from[key];
    const after = to[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    patch[key] = after === undefined ? null : after;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
