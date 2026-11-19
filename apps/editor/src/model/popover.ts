/**
 * Where a popover goes (the color picker): beside the panel it was opened from, like Figma's
 * pickers left of the properties panel, so it covers the canvas and not the fields you're
 * reading. With no room there, below (or above) the trigger. Always inside the window: the
 * browser's own color popup couldn't promise that (it overflowed the screen on Wayland, D64).
 * Pure, unit-tested.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Gap to the window's edges, and between the popover and what it's next to. */
export const POPOVER_MARGIN = 8;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/** The popover's top-left corner, in window pixels. */
export function placePopover(
  trigger: Box,
  panel: Box | null,
  size: Size,
  viewport: Size,
  margin = POPOVER_MARGIN,
): { x: number; y: number } {
  const fitY = (y: number) => clamp(y, margin, viewport.height - margin - size.height);
  const fitX = (x: number) => clamp(x, margin, viewport.width - margin - size.width);
  // Beside the panel, level with the trigger.
  if (panel) {
    const left = panel.left - margin - size.width;
    if (left >= margin) return { x: left, y: fitY(trigger.top) };
    const right = panel.right + margin;
    if (right + size.width <= viewport.width - margin) return { x: right, y: fitY(trigger.top) };
  }
  // Below the trigger, else above it, else wherever it fits.
  const below = trigger.bottom + margin;
  const above = trigger.top - margin - size.height;
  const y =
    below + size.height <= viewport.height - margin ? below : above >= margin ? above : fitY(below);
  return { x: fitX(trigger.left), y };
}
