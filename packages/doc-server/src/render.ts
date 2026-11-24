/**
 * Rendering without a user's window (D1): measuring slides for lint and taking screenshots
 * for agents. The doc-server only defines the contract; implementations live in the apps
 * (headless Chromium via Playwright in `apps/server`, a hidden BrowserWindow in Electron).
 */
import type { Deck, SlideMeasurement } from "@veloce/core";

export interface ScreenshotOptions {
  deckId: string;
  slideId: string;
  /** Output width in pixels (height follows the stage's aspect ratio). Default 960. */
  width?: number;
  /** Default `"jpeg"` (smaller for agents); `"png"` for lossless. */
  format?: "png" | "jpeg";
  /**
   * A moment of the slide's animations: `time` ms into `step`, every step before it played
   * out (D115). Without it, the slide at rest: every layer where the layout puts it.
   */
  at?: { step: number; time: number };
}

export interface Screenshot {
  data: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
}

export interface RenderService {
  /** Lay slides out in a real browser and measure them. Default: every slide. */
  measure(
    deck: Deck,
    options: { deckId: string; slideIds?: readonly string[] },
  ): Promise<SlideMeasurement[]>;
  screenshot(deck: Deck, options: ScreenshotOptions): Promise<Screenshot>;
  close(): Promise<void>;
}

/**
 * Caches measurements by object identity: a slide's measurement only depends on the slide,
 * the theme and the stage, and core never mutates those (an edit makes new objects). So an
 * unchanged slide is never measured twice, and nothing stale is ever returned.
 */
export class CachedRenderService implements RenderService {
  readonly #inner: RenderService;
  readonly #cache = new WeakMap<object, WeakMap<object, WeakMap<object, SlideMeasurement>>>();

  constructor(inner: RenderService) {
    this.#inner = inner;
  }

  async measure(
    deck: Deck,
    options: { deckId: string; slideIds?: readonly string[] },
  ): Promise<SlideMeasurement[]> {
    const wanted = options.slideIds ? new Set(options.slideIds) : null;
    const slides = deck.slides.filter((s) => !wanted || wanted.has(s.id));
    const cached = new Map<string, SlideMeasurement>();
    const missing: string[] = [];
    for (const slide of slides) {
      const hit = this.#cache.get(slide)?.get(deck.theme)?.get(deck.stage);
      if (hit) cached.set(slide.id, hit);
      else missing.push(slide.id);
    }
    if (missing.length) {
      const fresh = await this.#inner.measure(deck, { deckId: options.deckId, slideIds: missing });
      for (const m of fresh) {
        const slide = slides.find((s) => s.id === m.slideId);
        if (!slide) continue;
        const byTheme = this.#cache.get(slide) ?? new WeakMap();
        this.#cache.set(slide, byTheme);
        const byStage = byTheme.get(deck.theme) ?? new WeakMap();
        byTheme.set(deck.theme, byStage);
        byStage.set(deck.stage, m);
        cached.set(m.slideId, m);
      }
    }
    return slides.flatMap((s) => cached.get(s.id) ?? []);
  }

  screenshot(deck: Deck, options: ScreenshotOptions): Promise<Screenshot> {
    return this.#inner.screenshot(deck, options);
  }

  close(): Promise<void> {
    return this.#inner.close();
  }
}
