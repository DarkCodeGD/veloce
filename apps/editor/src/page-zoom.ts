/**
 * The browser's own page zoom is never what you want in the editor: Ctrl/⌘ + scroll (or a
 * trackpad pinch, which Chromium sends as Ctrl + wheel) over a panel, or Ctrl/⌘ + "+"/"-" in
 * a text field, would scale the whole UI instead of the slide. Like Figma, the app claims
 * those gestures everywhere: over the canvas they zoom the slide (useCanvasCamera), anywhere
 * else they do nothing.
 *
 * Only `preventDefault`, never `stopPropagation`: the canvas still gets its events. Installed
 * once for the app's lifetime (main.tsx); returns a remover for tests.
 *
 * Accessibility: people who need a larger UI still have the OS display scale, and the desktop
 * app will get a UI-scale preference (Preferences, D53) instead of the browser's zoom.
 */
import { zoomKeyDirection } from "./model/camera.js";

export function blockPageZoom(target: Window = window): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (zoomKeyDirection(e) !== 0) e.preventDefault();
  };
  // Capture phase: runs before any element's handler, so a field that stops its keys from
  // reaching editor shortcuts (the inspector's) can't let the page zoom through. Not passive:
  // Chromium treats window-level wheel listeners as passive by default, and a passive
  // listener can't cancel the zoom.
  const capture = { capture: true } as const;
  target.addEventListener("wheel", onWheel, { ...capture, passive: false });
  target.addEventListener("keydown", onKey, capture);
  return () => {
    target.removeEventListener("wheel", onWheel, capture);
    target.removeEventListener("keydown", onKey, capture);
  };
}
