/**
 * The alignment bar (Figma's): six align buttons and two distribute buttons for free layers.
 * Shown only when alignment applies (every selected layer is free, see `alignable`); a
 * single layer aligns within its frame, so distributing needs three or more.
 */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  type LucideIcon,
} from "lucide-react";
import { alignSelection, distributeSelection } from "../align-actions.js";
import { type AlignEdge, alignable } from "../model/align.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import type { SlideIndex } from "../model/slide-index.js";
import { shortcutAttrs } from "../platform.js";

const ALIGN: Array<{ edge: AlignEdge; tip: string; icon: LucideIcon; keys: string }> = [
  { edge: "left", tip: "Align left", icon: AlignStartVertical, keys: SHORTCUTS.alignLeft },
  {
    edge: "center",
    tip: "Align horizontal centers",
    icon: AlignCenterVertical,
    keys: SHORTCUTS.alignCenter,
  },
  { edge: "right", tip: "Align right", icon: AlignEndVertical, keys: SHORTCUTS.alignRight },
  { edge: "top", tip: "Align top", icon: AlignStartHorizontal, keys: SHORTCUTS.alignTop },
  {
    edge: "middle",
    tip: "Align vertical centers",
    icon: AlignCenterHorizontal,
    keys: SHORTCUTS.alignMiddle,
  },
  { edge: "bottom", tip: "Align bottom", icon: AlignEndHorizontal, keys: SHORTCUTS.alignBottom },
];

export function AlignBar({ index, ids }: { index: SlideIndex; ids: readonly string[] }) {
  const layers = alignable(index, ids);
  if (layers.length === 0) return null;
  const spread = layers.length >= 3;
  return (
    <div className="align-bar" role="toolbar" aria-label="Align">
      {ALIGN.map(({ edge, tip, icon: Icon, keys }) => (
        <button
          key={edge}
          type="button"
          className="icon-button"
          aria-label={tip}
          data-tip={layers.length === 1 ? `${tip} (in frame)` : tip}
          {...shortcutAttrs(keys)}
          onClick={() => void alignSelection(index, ids, edge)}
        >
          <Icon size={16} />
        </button>
      ))}
      <span className="align-bar-divider" aria-hidden="true" />
      <button
        type="button"
        className="icon-button"
        aria-label="Distribute horizontally"
        data-tip="Distribute horizontally (3 or more layers)"
        disabled={!spread}
        {...shortcutAttrs(SHORTCUTS.distributeHorizontal)}
        onClick={() => void distributeSelection(index, ids, "horizontal")}
      >
        <AlignHorizontalSpaceAround size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Distribute vertically"
        data-tip="Distribute vertically (3 or more layers)"
        disabled={!spread}
        {...shortcutAttrs(SHORTCUTS.distributeVertical)}
        onClick={() => void distributeSelection(index, ids, "vertical")}
      >
        <AlignVerticalSpaceAround size={16} />
      </button>
    </div>
  );
}
