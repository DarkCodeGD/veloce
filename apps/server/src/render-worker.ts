/**
 * Headless rendering with Chromium (via playwright-core): measurements for lint and slide
 * screenshots for agents, with no user window open (D1).
 *
 * The worker loads the editor's `render.html` page (same renderer and plugins as the editor,
 * so what agents see is what users see) and drives it with `page.evaluate`.
 *
 * - Lazy: Chromium starts on first use, and restarts by itself if it crashes.
 * - Serialized: one page, one request at a time (rendering is fast; ordering stays simple).
 * - Locked down: the page may only load from this server (no third-party requests).
 */
import type { Deck, SlideMeasurement } from "@veloce/core";
import type { RenderService, Screenshot, ScreenshotOptions } from "@veloce/doc-server";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";

export interface PlaywrightRenderOptions {
  /** Origin of this server, e.g. `http://127.0.0.1:4321`. */
  baseUrl: string;
  /** Use a specific Chrome/Chromium binary instead of Playwright's managed one. */
  executablePath?: string;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
}

/** What render.html exposes on `window`. */
interface RenderPageApi {
  measure(
    deck: Deck,
    deckId: string,
    slideIds: readonly string[] | null,
  ): Promise<SlideMeasurement[]>;
  show(
    deck: Deck,
    deckId: string,
    slideId: string,
    width: number,
    at?: { step: number; time: number },
  ): Promise<{ width: number; height: number }>;
}

export const INSTALL_HINT =
  "Install the headless browser once with: pnpm --filter @veloce/server exec playwright-core install chromium-headless-shell";

export class PlaywrightRenderService implements RenderService {
  readonly #options: PlaywrightRenderOptions;
  #browser: Promise<Browser> | null = null;
  #context: BrowserContext | null = null;
  #page: Promise<Page> | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(options: PlaywrightRenderOptions) {
    this.#options = options;
  }

  measure(
    deck: Deck,
    options: { deckId: string; slideIds?: readonly string[] },
  ): Promise<SlideMeasurement[]> {
    return this.#run((page) =>
      page.evaluate(
        ([d, id, slides]) =>
          (globalThis as unknown as { veloceRender: RenderPageApi }).veloceRender.measure(
            d,
            id,
            slides,
          ),
        [deck, options.deckId, options.slideIds ?? null] as const,
      ),
    );
  }

  screenshot(deck: Deck, options: ScreenshotOptions): Promise<Screenshot> {
    const width = options.width ?? 960;
    const format = options.format ?? "jpeg";
    return this.#run(async (page) => {
      const size = await page.evaluate(
        ([d, id, slide, w, at]) =>
          (globalThis as unknown as { veloceRender: RenderPageApi }).veloceRender.show(
            d,
            id,
            slide,
            w,
            at ?? undefined,
          ),
        [deck, options.deckId, options.slideId, width, options.at ?? null] as const,
      );
      const data = await page.screenshot({
        clip: { x: 0, y: 0, width: size.width, height: size.height },
        type: format,
        ...(format === "jpeg" && { quality: 85 }),
      });
      return {
        data: new Uint8Array(data),
        mimeType: format === "png" ? "image/png" : "image/jpeg",
      };
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    const browser = this.#browser;
    this.#browser = null;
    this.#page = null;
    await (await browser?.catch(() => null))?.close().catch(() => {});
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────

  /** Run `task` on the render page, one task at a time, with a timeout and crash recovery. */
  #run<T>(task: (page: Page) => Promise<T>): Promise<T> {
    const run = async () => {
      if (this.#closed) throw new Error("The renderer is shut down");
      const page = await this.#getPage();
      const timeout = this.#options.timeoutMs ?? 30_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          task(page),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Rendering timed out after ${timeout} ms`)),
              timeout,
            );
          }),
        ]);
      } catch (error) {
        this.#page = null; // start from a fresh page next time
        await page.close().catch(() => {});
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => {});
    return result;
  }

  #getPage(): Promise<Page> {
    this.#page ??= this.#openPage().catch((error: unknown) => {
      this.#page = null;
      throw error;
    });
    return this.#page;
  }

  async #openPage(): Promise<Page> {
    const browser = await this.#getBrowser();
    const base = new URL(this.#options.baseUrl);
    this.#context ??= await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const context = this.#context;
    // Deck content must never reach out to the internet from the render worker.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin || url.protocol === "data:" || url.protocol === "blob:")
        return route.continue();
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.goto(new URL("/render.html", base).href, { waitUntil: "load" });
    await page
      .waitForFunction(() => "veloceRender" in globalThis, undefined, { timeout: 10_000 })
      .catch(() => {
        throw new Error("The render page didn't load. Build the editor first: pnpm build:editor");
      });
    return page;
  }

  #getBrowser(): Promise<Browser> {
    this.#browser ??= chromium
      .launch({
        headless: true,
        ...(this.#options.executablePath && { executablePath: this.#options.executablePath }),
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          // Crashed or killed: relaunch on the next request.
          this.#browser = null;
          this.#context = null;
          this.#page = null;
        });
        return browser;
      })
      .catch((error: unknown) => {
        this.#browser = null;
        const message = error instanceof Error ? error.message : String(error);
        if (/Executable doesn't exist/i.test(message)) {
          throw new Error(`Chromium isn't installed. ${INSTALL_HINT}`);
        }
        throw error;
      });
    return this.#browser;
  }
}
