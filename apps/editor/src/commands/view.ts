/**
 * The View menu (D89): canvas zoom (view state, never ops), the left panel's tabs, and
 * Follow AI.
 */
import { type CameraControls, cameraControls } from "../camera-controls.js";
import { zoomKeyDirection } from "../model/camera.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import type { EditorCommand, Panel } from "./context.js";

const zoom = (
  id: string,
  label: string,
  shortcut: string,
  action: keyof CameraControls,
  extra: Partial<EditorCommand> = {},
): EditorCommand => ({
  id,
  label,
  shortcut,
  keywords: "zoom",
  group: "view",
  menu: "view",
  section: "zoom",
  enabled: () => cameraControls() !== null,
  run: () => cameraControls()?.[action](),
  ...extra,
});

/**
 * Ctrl + "+"/"-" zoom the canvas even while typing (Figma does too): they type nothing, and
 * the browser's page zoom is blocked app-wide (page-zoom.ts). Matched by the character, so
 * "+" works wherever a layout puts it, and the numpad too.
 */
const zoomKeys = (dir: 1 | -1): Partial<EditorCommand> => ({
  matchKey: (press) => zoomKeyDirection(press) === dir,
  inFields: "always",
  repeat: true,
});

const PANELS: ReadonlyArray<{ panel: Panel; label: string; shortcut: string }> = [
  { panel: "slides", label: "Slides", shortcut: SHORTCUTS.panelSlides },
  { panel: "layers", label: "Layers", shortcut: SHORTCUTS.panelLayers },
  { panel: "history", label: "History", shortcut: SHORTCUTS.panelHistory },
  { panel: "issues", label: "Issues", shortcut: SHORTCUTS.panelIssues },
];

export function viewCommands(): EditorCommand[] {
  return [
    zoom("view.zoomIn", "Zoom in", SHORTCUTS.zoomIn, "zoomIn", zoomKeys(1)),
    zoom("view.zoomOut", "Zoom out", SHORTCUTS.zoomOut, "zoomOut", zoomKeys(-1)),
    zoom("view.zoomToFit", "Zoom to fit", SHORTCUTS.zoomToFit, "zoomToFit"),
    zoom("view.zoomTo100", "Zoom to 100%", SHORTCUTS.zoomTo100, "zoomTo100"),
    zoom("view.zoomToSelection", "Zoom to selection", SHORTCUTS.zoomToSelection, "zoomToSelection"),
    ...PANELS.map(
      ({ panel, label, shortcut }): EditorCommand => ({
        id: `view.panel.${panel}`,
        label,
        shortcut,
        keywords: "panel tab show",
        group: "view",
        menu: "view",
        section: "panels",
        enabled: (c) => c.slideIndex !== undefined,
        checked: (c) => c.panel === panel,
        run: (c) => c.showPanel(panel),
      }),
    ),
    {
      id: "view.followAI",
      label: "Follow AI",
      keywords: "agent jump live",
      group: "view",
      menu: "view",
      section: "ai",
      checked: (c) => c.follow,
      toggle: true,
      run: (c) => c.setFollow(!c.follow),
    },
  ];
}
