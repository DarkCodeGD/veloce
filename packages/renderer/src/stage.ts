/**
 * StageView: a fixed-size stage (e.g. 1920×1080 logical pixels) shown in a viewport. By
 * default it's scaled to fit, centered, keeping its aspect ratio; a camera (the editor's zoom
 * and pan) can place it anywhere instead. Layout always happens at stage size; only the final
 * picture is scaled (CSS transform), so text wraps identically at every zoom level.
 */
export interface StageViewOptions {
  /** Space between the stage and the viewport edges when fitted, in screen pixels. Default 0. */
  padding?: number;
}

/** Where the stage is drawn: its top-left corner in viewport pixels, and its scale. */
export interface Camera {
  /** Screen pixels per stage pixel (1 = 100%). */
  scale: number;
  x: number;
  y: number;
}

export class StageView {
  readonly viewport: HTMLElement;
  readonly stage: HTMLElement;
  readonly #padding: number;
  #width = 1920;
  #height = 1080;
  #camera: Camera = { scale: 1, x: 0, y: 0 };
  /** The camera set by `setCamera`, or null while fitting the viewport. */
  #fixed: Camera | null = null;
  readonly #observer: ResizeObserver | null;

  constructor(viewport: HTMLElement, options: StageViewOptions = {}) {
    this.viewport = viewport;
    this.#padding = options.padding ?? 0;
    if (!viewport.style.position) viewport.style.position = "relative";
    viewport.style.overflow = "hidden";
    const stage = viewport.ownerDocument.createElement("div");
    Object.assign(stage.style, {
      position: "absolute",
      left: "0",
      top: "0",
      transformOrigin: "0 0",
    });
    viewport.append(stage);
    this.stage = stage;
    const Observer = viewport.ownerDocument.defaultView?.ResizeObserver;
    this.#observer = Observer ? new Observer(() => this.fit()) : null;
    this.#observer?.observe(viewport);
    this.fit();
  }

  /** Current screen pixels per stage pixel. */
  get scale(): number {
    return this.#camera.scale;
  }

  /** Where the stage is drawn right now (fitted or not). */
  get camera(): Camera {
    return { ...this.#camera };
  }

  /** True while the stage fits the viewport (no camera set). */
  get fitted(): boolean {
    return this.#fixed === null;
  }

  /** The camera that fits the stage in the viewport, centered, keeping `padding` around it. */
  get fitCamera(): Camera {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const pad = this.#padding * 2;
    const scale = Math.max(0, Math.min((vw - pad) / this.#width, (vh - pad) / this.#height)) || 0;
    return { scale, x: (vw - this.#width * scale) / 2, y: (vh - this.#height * scale) / 2 };
  }

  /**
   * Draw the stage with this camera, or fit the viewport again with `null`. A set camera
   * stays put when the viewport resizes (like a design tool's canvas); a fitted one refits.
   */
  setCamera(camera: Camera | null): void {
    this.#fixed = camera && camera.scale > 0 ? { ...camera } : null;
    this.fit();
  }

  setStageSize(width: number, height: number): void {
    if (width === this.#width && height === this.#height) return;
    this.#width = width;
    this.#height = height;
    this.fit();
  }

  /** Recompute where the stage is drawn (called automatically when the viewport resizes). */
  fit(): void {
    const { scale, x, y } = this.#fixed ?? this.fitCamera;
    this.#camera = { scale, x, y };
    this.stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  dispose(): void {
    this.#observer?.disconnect();
    this.stage.remove();
  }
}
