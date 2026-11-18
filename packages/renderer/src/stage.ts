/**
 * StageView: a fixed-size stage (e.g. 1920×1080 logical pixels) scaled to fit any viewport,
 * centered, keeping its aspect ratio. Layout always happens at stage size; only the final
 * picture is scaled (CSS transform), so text wraps identically at every zoom level.
 */
export interface StageViewOptions {
  /** Space between the stage and the viewport edges, in screen pixels. Default 0. */
  padding?: number;
}

export class StageView {
  readonly viewport: HTMLElement;
  readonly stage: HTMLElement;
  readonly #padding: number;
  #width = 1920;
  #height = 1080;
  #scale = 1;
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
    return this.#scale;
  }

  setStageSize(width: number, height: number): void {
    if (width === this.#width && height === this.#height) return;
    this.#width = width;
    this.#height = height;
    this.fit();
  }

  /** Recompute the scale (called automatically when the viewport resizes). */
  fit(): void {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const pad = this.#padding * 2;
    const scale = Math.max(0, Math.min((vw - pad) / this.#width, (vh - pad) / this.#height)) || 0;
    const x = (vw - this.#width * scale) / 2;
    const y = (vh - this.#height * scale) / 2;
    this.#scale = scale;
    this.stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  dispose(): void {
    this.#observer?.disconnect();
    this.stage.remove();
  }
}
