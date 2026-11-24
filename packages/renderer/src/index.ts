/**
 * @veloce/renderer: draws decks as DOM.
 *
 * - `SlideRenderer` renders one slide into a stage element, incrementally.
 * - `StageView` scales a fixed-size stage to fit a viewport.
 * - `SlideView` combines both (editor canvas, thumbnails).
 * - `SlidePlayer` plays a slide's animations on the one clock (D115).
 * - `measureSlide` reports bounds/overflow/text colors for lint.
 */
export * from "./layout.js";
export * from "./measure.js";
export * from "./slide-player.js";
export * from "./slide-renderer.js";
export * from "./slide-view.js";
export * from "./stage.js";
export * from "./theme.js";
