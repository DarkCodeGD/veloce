/**
 * The zoom pill in the canvas corner: zoom out, the current zoom (click: 100%), zoom in, and
 * zoom to fit. Every button has its keyboard shortcut in its tooltip (useCanvasCamera).
 */
import { Maximize, Minus, Plus } from "lucide-react";
import { zoomLabel } from "../model/camera.js";
import { SHORTCUTS } from "../model/shortcuts.js";
import { shortcutAttrs } from "../platform.js";

interface Props {
  scale: number;
  fitted: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomTo100(): void;
  onZoomToFit(): void;
}

export function ZoomControl({
  scale,
  fitted,
  onZoomIn,
  onZoomOut,
  onZoomTo100,
  onZoomToFit,
}: Props) {
  return (
    // Presses here are for these buttons, never a click on the canvas (which deselects).
    <div
      className="zoom-control"
      role="toolbar"
      aria-label="Zoom"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="icon-button"
        aria-label="Zoom out"
        data-tip="Zoom out"
        {...shortcutAttrs(SHORTCUTS.zoomOut)}
        onClick={onZoomOut}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="zoom-value"
        aria-label={`Zoom ${zoomLabel(scale)}, zoom to 100%`}
        data-tip="Zoom to 100%"
        {...shortcutAttrs(SHORTCUTS.zoomTo100)}
        onClick={onZoomTo100}
      >
        {zoomLabel(scale)}
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Zoom in"
        data-tip="Zoom in"
        {...shortcutAttrs(SHORTCUTS.zoomIn)}
        onClick={onZoomIn}
      >
        <Plus size={14} />
      </button>
      <span className="toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="icon-button"
        aria-label="Zoom to fit"
        aria-pressed={fitted}
        data-tip="Zoom to fit"
        {...shortcutAttrs(SHORTCUTS.zoomToFit)}
        onClick={onZoomToFit}
      >
        <Maximize size={14} />
      </button>
    </div>
  );
}
