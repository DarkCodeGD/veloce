/**
 * The canvas camera's zoom commands, for the registry (D89): the View menu and the zoom keys
 * run them without reaching into the canvas component. The canvas registers its controls
 * while it's mounted; with no canvas (no deck open) the zoom commands are disabled.
 */
export interface CameraControls {
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(): void;
  zoomTo100(): void;
  zoomToSelection(): void;
}

let controls: CameraControls | null = null;

/** Called by the canvas on mount; returns the remover for its unmount. */
export function setCameraControls(next: CameraControls): () => void {
  controls = next;
  return () => {
    if (controls === next) controls = null;
  };
}

export const cameraControls = (): CameraControls | null => controls;
