/**
 * The Arrange menu (D89): align and distribute (Figma's Alt keys, by physical key), group,
 * auto layout, and moving a layer among its siblings without dragging (WCAG 2.5.7).
 */
import { GalleryVerticalEnd } from "lucide-react";
import { run } from "../actions.js";
import { alignSelection, distributeSelection } from "../align-actions.js";
import { autoLayoutSelection, groupSelection, ungroupSelection } from "../group-actions.js";
import type { AlignEdge, DistributeAxis } from "../model/align.js";
import { reorderNode } from "../model/commands.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import type { SlideIndex } from "../model/slide-index.js";
import { type EditorCommand, hasSelection, onlySelected, onSlide } from "./context.js";

const ALIGN: ReadonlyArray<{ edge: AlignEdge; label: string; shortcut: string }> = [
  { edge: "left", label: "Align left", shortcut: SHORTCUTS.alignLeft },
  { edge: "center", label: "Align horizontal centers", shortcut: SHORTCUTS.alignCenter },
  { edge: "right", label: "Align right", shortcut: SHORTCUTS.alignRight },
  { edge: "top", label: "Align top", shortcut: SHORTCUTS.alignTop },
  { edge: "middle", label: "Align vertical centers", shortcut: SHORTCUTS.alignMiddle },
  { edge: "bottom", label: "Align bottom", shortcut: SHORTCUTS.alignBottom },
];

const DISTRIBUTE: ReadonlyArray<{ axis: DistributeAxis; label: string; shortcut: string }> = [
  {
    axis: "horizontal",
    label: "Distribute horizontally",
    shortcut: SHORTCUTS.distributeHorizontal,
  },
  { axis: "vertical", label: "Distribute vertically", shortcut: SHORTCUTS.distributeVertical },
];

/** A grouping action that resolves to what to select afterwards. */
type Grouping = (index: SlideIndex, ids: readonly string[]) => Promise<string[] | null>;
const grouping =
  (action: Grouping): EditorCommand["run"] =>
  (c) => {
    if (hasSelection(c)) void action(c.slideIndex, c.selection).then((ids) => ids && c.select(ids));
  };

/** Move the one selected layer up (-1) or down (+1) in the Layers panel. */
const moveLayer = (id: string, label: string, shortcut: string, delta: -1 | 1): EditorCommand => ({
  id,
  label,
  shortcut,
  keywords: "reorder order forward backward",
  group: "arrange",
  menu: "arrange",
  section: "order",
  repeat: true,
  enabled: (c) => {
    const only = onlySelected(c);
    return onSlide(c) && only !== undefined && reorderNode(c.slideIndex, only, delta) !== null;
  },
  run: (c) => {
    const only = onlySelected(c);
    if (onSlide(c) && only) void run(reorderNode(c.slideIndex, only, delta));
  },
});

export function arrangeCommands(): EditorCommand[] {
  return [
    ...ALIGN.map(
      ({ edge, label, shortcut }): EditorCommand => ({
        id: `arrange.align.${edge}`,
        label,
        shortcut,
        group: "arrange",
        menu: "arrange",
        section: "align",
        enabled: hasSelection,
        run: (c) => {
          if (hasSelection(c)) void alignSelection(c.slideIndex, c.selection, edge);
        },
      }),
    ),
    ...DISTRIBUTE.map(
      ({ axis, label, shortcut }): EditorCommand => ({
        id: `arrange.distribute.${axis}`,
        label,
        shortcut,
        keywords: "space evenly",
        group: "arrange",
        menu: "arrange",
        section: "distribute",
        enabled: (c) => hasSelection(c) && c.selection.length >= 3,
        run: (c) => {
          if (hasSelection(c)) void distributeSelection(c.slideIndex, c.selection, axis);
        },
      }),
    ),
    {
      id: "arrange.group",
      label: "Group",
      shortcut: SHORTCUTS.group,
      group: "arrange",
      menu: "arrange",
      section: "group",
      enabled: hasSelection,
      run: grouping(groupSelection),
    },
    {
      id: "arrange.ungroup",
      label: "Ungroup",
      shortcut: SHORTCUTS.ungroup,
      group: "arrange",
      menu: "arrange",
      section: "group",
      enabled: hasSelection,
      run: grouping(ungroupSelection),
    },
    {
      // The id predates the menu bar (D83); it stays stable for plugins and keymaps.
      id: "layer.autoLayout",
      label: "Add auto layout",
      icon: GalleryVerticalEnd,
      shortcut: SHORTCUTS.autoLayout,
      group: "layer",
      menu: "arrange",
      section: "group",
      keywords: "stack flow arrange",
      enabled: hasSelection,
      run: grouping(autoLayoutSelection),
    },
    moveLayer("arrange.moveUp", "Move layer up", SHORTCUTS.moveUp, -1),
    moveLayer("arrange.moveDown", "Move layer down", SHORTCUTS.moveDown, 1),
  ];
}
