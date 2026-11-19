/**
 * Clicking rows in the Layers panel, the way Figma and file managers do it:
 * - a plain click selects that layer only,
 * - Ctrl/Cmd + click toggles one layer in or out of the selection,
 * - Shift + click selects every visible row from the anchor (the last row clicked without
 *   Shift) to this one, on top of what was selected when the anchor was set. Shift-clicking
 *   again from the same anchor replaces that range, so it can grow and shrink.
 *
 * Pure: (visible rows, selection, the remembered anchor, the click) → the new selection and
 * anchor. Rows are the panel's visible rows in order (collapsed frames hide their children).
 */

export interface LayerAnchor {
  /** The row ranges start from. */
  id: string;
  /** The selection the range is added to (what was selected when the anchor was set). */
  base: readonly string[];
}

export interface LayerClick {
  id: string;
  /** Shift: select a range. */
  range: boolean;
  /** Ctrl (Windows/Linux) or Cmd (macOS): toggle one layer. */
  toggle: boolean;
}

export function clickLayer(
  rows: readonly string[],
  selection: readonly string[],
  anchor: LayerAnchor | null,
  click: LayerClick,
): { selection: string[]; anchor: LayerAnchor } {
  const { id } = click;
  if (click.range) {
    // The anchor only counts while it's still selected and visible: after a click on the
    // canvas (or a collapse), ranges start from the last selected visible row instead.
    const valid = anchor && selection.includes(anchor.id) && rows.includes(anchor.id);
    const from = valid
      ? anchor
      : { id: [...selection].reverse().find((s) => rows.includes(s)) ?? id, base: selection };
    const a = rows.indexOf(from.id);
    const b = rows.indexOf(id);
    if (a === -1 || b === -1) return { selection: [id], anchor: { id, base: [] } };
    const span = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { selection: [...new Set([...from.base, ...span])], anchor: from };
  }
  if (click.toggle) {
    const next = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
    return { selection: next, anchor: { id, base: next.filter((s) => s !== id) } };
  }
  return { selection: [id], anchor: { id, base: [] } };
}
