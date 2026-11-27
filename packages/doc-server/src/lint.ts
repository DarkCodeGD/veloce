/**
 * Lint with measurements, for agents (per tool call) and editor tabs (live) alike (D73).
 *
 * `lintWithRender` is the one way a deck gets linted on the server: structural rules always,
 * visual rules (overflow, contrast, overlaps…) when the render service can measure. Agents and
 * the editor therefore see the same issues, worded the same way by core. With the caching
 * render service, a slide is only measured once per version of it, whoever asks first.
 *
 * `DeckLinter` keeps open editor tabs current: it re-lints a deck shortly after each change
 * (debounced, so a burst of edits is one run), only while someone is watching it, and never
 * runs two lints of one deck at once.
 */
import {
  type Deck,
  type LintReport,
  lintDeck,
  type MotionLintHooks,
  type SlideMeasurement,
} from "@veloce/core";
import type { OpenDeck } from "./open-deck.js";
import type { RenderService } from "./render.js";

export type DeckLint = Omit<LintReport, "version">;

/**
 * Lint `deck` (or some of its slides), measuring with `render` when there is one. Never
 * fails: if measuring does, the visual rules are skipped and `visual` says why.
 */
export async function lintWithRender(
  deck: Deck,
  options: {
    deckId: string;
    render: RenderService | null;
    /** Why there's no renderer, when `render` is null. */
    unavailable?: string;
    slideIds?: readonly string[];
    /** The installed effects (`registry.motionLint`): motion rules run with them (D126). */
    motion?: MotionLintHooks;
  },
): Promise<DeckLint> {
  const { deckId, render, slideIds } = options;
  let measurements: Map<string, SlideMeasurement> | undefined;
  let visual: true | string = options.unavailable ?? "no renderer";
  if (render) {
    try {
      const measured = await render.measure(deck, { deckId, ...(slideIds && { slideIds }) });
      measurements = new Map(measured.map((m) => [m.slideId, m]));
      visual = true;
    } catch (error) {
      visual = `renderer failed (${error instanceof Error ? error.message : String(error)})`;
    }
  }
  const issues = lintDeck(deck, {
    ...(slideIds && { slideIds }),
    ...(measurements && { measurements }),
    ...(options.motion && { motion: options.motion }),
  });
  return { issues, visual };
}

export interface DeckLinterOptions {
  /** The render service (a getter: servers build it once they know their own URL). */
  render: () => RenderService | null;
  /** Why there's no renderer, when `render()` returns null. */
  unavailable?: () => string | undefined;
  /** The installed effects, for the motion rules (D126). */
  motion?: MotionLintHooks;
  /** How long after a change to re-lint, so a burst of changes is one run. Default 250 ms. */
  delayMs?: number;
}

export type LintListener = (report: LintReport) => void;

interface Watched {
  open: OpenDeck;
  listeners: Set<LintListener>;
  stop: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: boolean;
  /** A change arrived while running: run again when done. */
  again: boolean;
  last: LintReport | null;
}

export class DeckLinter {
  readonly #options: DeckLinterOptions;
  readonly #decks = new Map<string, Watched>();
  #closed = false;

  constructor(options: DeckLinterOptions) {
    this.#options = options;
  }

  /**
   * Get `open`'s lint now (if a current one is known) and after every change, until the
   * returned function is called. Reports for versions that are already outdated by the
   * time they finish are dropped: the next run reports instead.
   */
  watch(open: OpenDeck, listener: LintListener): () => void {
    let entry = this.#decks.get(open.id);
    if (!entry) {
      const created: Watched = {
        open,
        listeners: new Set(),
        stop: () => {},
        timer: undefined,
        running: false,
        again: false,
        last: null,
      };
      created.stop = open.subscribe(() => this.#schedule(created, this.#options.delayMs ?? 250));
      this.#decks.set(open.id, created);
      entry = created;
    }
    const watched = entry;
    watched.listeners.add(listener);
    if (watched.last && watched.last.version === open.version) listener(watched.last);
    else this.#schedule(watched, 0);
    return () => {
      watched.listeners.delete(listener);
      if (watched.listeners.size > 0) return;
      clearTimeout(watched.timer);
      watched.stop();
      if (this.#decks.get(open.id) === watched) this.#decks.delete(open.id);
    };
  }

  /** Stop all watching (pending runs finish without reporting). */
  close(): void {
    this.#closed = true;
    for (const entry of this.#decks.values()) {
      clearTimeout(entry.timer);
      entry.stop();
    }
    this.#decks.clear();
  }

  #schedule(entry: Watched, delay: number): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.#run(entry), delay);
  }

  async #run(entry: Watched): Promise<void> {
    if (entry.running) {
      entry.again = true;
      return;
    }
    entry.running = true;
    try {
      do {
        entry.again = false;
        const { open } = entry;
        const version = open.version;
        const render = this.#options.render();
        const unavailable = render ? undefined : this.#options.unavailable?.();
        const result = await lintWithRender(open.deck, {
          deckId: open.id,
          render,
          ...(unavailable && { unavailable }),
          ...(this.#options.motion && { motion: this.#options.motion }),
        });
        if (this.#closed || this.#decks.get(open.id) !== entry) return; // nobody's watching now
        if (version !== open.version) continue; // outdated: a change already queued a run
        entry.last = { version, ...result };
        for (const listener of entry.listeners) listener(entry.last);
      } while (entry.again);
    } finally {
      entry.running = false;
    }
  }
}
