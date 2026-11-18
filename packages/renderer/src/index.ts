/**
 * @veloce/renderer: draws decks as DOM.
 *
 * - `SlideRenderer` renders one slide into a stage element, incrementally.
 * - `StageView` scales a fixed-size stage to fit a viewport.
 * - `SlideView` combines both (editor canvas, thumbnails).
 * - `measureSlide` reports bounds/overflow/text colors for lint.
 */
export * from "./layout.js";
export * from "./measure.js";
export * from "./slide-renderer.js";
export * from "./slide-view.js";
export * from "./stage.js";
export * from "./theme.js";
