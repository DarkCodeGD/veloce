/**
 * The layout size of an element's box, kept up to date. `line` and `vector` draw in pixels
 * (so heads and strokes never stretch), so they redraw when their box is resized. Zoom,
 * rotation and transforms don't change the layout size, so they never trigger a redraw.
 */
export interface BoxSize {
  width: number;
  height: number;
}

export function watchBoxSize(
  container: HTMLElement,
  onResize: (size: BoxSize) => void,
): { size: () => BoxSize; dispose: () => void } {
  let size: BoxSize = { width: container.clientWidth, height: container.clientHeight };
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const next = { width: container.clientWidth, height: container.clientHeight };
          if (next.width === size.width && next.height === size.height) return;
          size = next;
          onResize(size);
        });
  observer?.observe(container);
  return {
    size: () => size,
    dispose: () => observer?.disconnect(),
  };
}
