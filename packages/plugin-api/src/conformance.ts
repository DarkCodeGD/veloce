/**
 * Plugin conformance kit: checks that an element type honours the contract, including
 * leaving nothing behind after `dispose()` (listeners, timers, animation frames, DOM).
 *
 * Framework-agnostic: returns a report instead of using a test runner, so any test suite can do
 * `expect(report.failures).toEqual([])`. Needs a DOM (browser, happy-dom, jsdom).
 *
 * How leak tracking works: while the check runs, `EventTarget.prototype.addEventListener` and the
 * global timer functions are wrapped to record what the plugin creates and what it cleans up.
 * Everything is restored afterwards, even when a check throws.
 */
import { z } from "zod";
import type { ElementContext, ElementDefinition, ElementInstance, ElementProps } from "./types.js";

export interface ConformanceOptions<P extends ElementProps> {
  /** Props to mount with. Default: the definition's `defaultProps`. */
  props?: P;
  /** More valid props to `update()` with, to exercise re-rendering. */
  updates?: P[];
  context?: ElementContext;
}

export interface ConformanceReport {
  type: string;
  passed: boolean;
  failures: string[];
}

// A 1×1 transparent GIF, so image plugins have something real to load.
const BLANK_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const DEFAULT_CONTEXT: ElementContext = { assetUrl: () => BLANK_IMAGE };

export async function checkElementConformance<P extends ElementProps>(
  definition: ElementDefinition<P>,
  options: ConformanceOptions<P> = {},
): Promise<ConformanceReport> {
  const failures: string[] = [];
  const fail = (message: string) => failures.push(message);

  checkMetadata(definition, fail);

  const props = options.props ?? definition.defaultProps;
  const container = document.createElement("div");
  document.body.append(container);
  const containerBefore = snapshotContainer(container);
  const tracker = startTracking();
  let instance: ElementInstance<P> | undefined;

  try {
    instance = definition.mount(container, props, options.context ?? DEFAULT_CONTEXT);
    const missing = (["update", "seek", "dispose"] as const).filter(
      (m) => typeof instance?.[m] !== "function",
    );
    if (missing.length) {
      fail(`mount() must return an instance with ${missing.map((m) => `${m}()`).join(", ")}`);
      return report(definition, failures);
    }

    if (container.childNodes.length === 0) fail("mount() rendered nothing into the container");
    if (snapshotContainer(container) !== containerBefore) {
      fail(
        "mount() changed the container's own attributes/style (only add children; the renderer owns the container)",
      );
    }

    for (const next of options.updates ?? []) instance.update(next);
    instance.update(props);

    instance.seek(0);
    instance.seek(1.5);
    if (definition.deterministic) {
      instance.seek(0.5);
      const first = container.innerHTML;
      instance.seek(2);
      instance.seek(0.5);
      if (container.innerHTML !== first)
        fail("declared deterministic, but seek(0.5) rendered differently the second time");
    }

    instance.dispose();
    if (container.childNodes.length > 0) fail("dispose() left DOM nodes in the container");
    for (const leak of tracker.leaks()) fail(`dispose() leaked ${leak}`);
    try {
      instance.dispose();
    } catch (error) {
      fail(`dispose() must be safe to call twice, but threw: ${describe(error)}`);
    }
  } catch (error) {
    fail(`threw during the lifecycle: ${describe(error)}`);
  } finally {
    tracker.stop();
    container.remove();
  }
  return report(definition, failures);
}

function report(definition: ElementDefinition, failures: string[]): ConformanceReport {
  return { type: definition.type, passed: failures.length === 0, failures };
}

function checkMetadata(definition: ElementDefinition, fail: (m: string) => void): void {
  if (!definition.title.trim()) fail("title is empty");
  if (
    !definition.description.trim() ||
    definition.description.includes("\n") ||
    definition.description.length > 200
  ) {
    fail("description must be a single non-empty line of at most 200 characters");
  }
  if (definition.aiDocs.trim().length < 80)
    fail("aiDocs is too short to teach an AI agent anything (min 80 chars)");
  if (!definition.propsSchema.safeParse(definition.defaultProps).success)
    fail("defaultProps don't match propsSchema");
  try {
    z.toJSONSchema(definition.propsSchema);
  } catch (error) {
    fail(`propsSchema can't be converted to JSON Schema for AI tools: ${describe(error)}`);
  }
}

function snapshotContainer(el: HTMLElement): string {
  return JSON.stringify(el.getAttributeNames().map((name) => [name, el.getAttribute(name)]));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Leak tracking ────────────────────────────────────────────────────────────────────

interface Tracker {
  /** Human-readable descriptions of everything still alive. */
  leaks(): string[];
  /** Restore the original globals. */
  stop(): void;
}

interface Registration {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
  capture: boolean;
}

type TimerApi = "setTimeout" | "setInterval" | "requestAnimationFrame";
type ClearApi = "clearTimeout" | "clearInterval" | "cancelAnimationFrame";
type AnyFn = (...args: unknown[]) => unknown;

function startTracking(): Tracker {
  // ── Event listeners ──
  const live: Registration[] = [];
  const indexOf = (r: Registration) =>
    live.findIndex(
      (x) =>
        x.target === r.target &&
        x.type === r.type &&
        x.listener === r.listener &&
        x.capture === r.capture,
    );
  const forget = (r: Registration) => {
    const i = indexOf(r);
    if (i >= 0) live.splice(i, 1);
  };
  const isCapture = (options?: boolean | EventListenerOptions) =>
    typeof options === "boolean" ? options : Boolean(options?.capture);

  // Patch every prototype that defines its own addEventListener: window, document and elements
  // don't always share EventTarget.prototype's method (it varies across browsers and DOM shims).
  const restoreListeners: Array<() => void> = [];
  // Only the outermost call is the plugin's. Nested calls come from the DOM implementation itself
  // (e.g. registering an internal "abort" listener for `{ signal }`, or a subclass calling super)
  // or from the tracker's own bookkeeping, and must not be counted.
  let internal = false;
  for (const owner of listenerOwners()) {
    const originalAdd = owner.addEventListener;
    const originalRemove = owner.removeEventListener;
    owner.addEventListener = function (this: EventTarget, type, listener, options) {
      if (internal) {
        originalAdd.call(this, type, listener, options);
        return;
      }
      internal = true;
      try {
        originalAdd.call(this, type, listener, options);
      } finally {
        internal = false;
      }
      if (listener) {
        const reg: Registration = { target: this, type, listener, capture: isCapture(options) };
        if (indexOf(reg) < 0) {
          live.push(reg);
          if (typeof options === "object") {
            // Listeners also go away when their AbortSignal fires or after a `once` event.
            internal = true;
            try {
              options.signal?.addEventListener("abort", () => forget(reg), { once: true });
              if (options.once)
                this.addEventListener(type, () => forget(reg), {
                  once: true,
                  capture: reg.capture,
                });
            } finally {
              internal = false;
            }
          }
        }
      }
    };
    owner.removeEventListener = function (this: EventTarget, type, listener, options) {
      if (listener) forget({ target: this, type, listener, capture: isCapture(options) });
      return originalRemove.call(this, type, listener, options);
    };
    restoreListeners.push(() => {
      owner.addEventListener = originalAdd;
      owner.removeEventListener = originalRemove;
    });
  }

  // ── Timers & animation frames ──
  const g = globalThis as unknown as Record<TimerApi | ClearApi, AnyFn | undefined>;
  const originals = { ...pick(g) };
  const pending = new Map<unknown, string>(); // handle → description

  const track = (set: TimerApi, clear: ClearApi, description: string, oneShot: boolean) => {
    const originalSet = originals[set];
    const originalClear = originals[clear];
    if (!originalSet || !originalClear) return;
    g[set] = (callback: unknown, ...rest: unknown[]) => {
      let handle: unknown;
      const run =
        oneShot && typeof callback === "function"
          ? (...args: unknown[]) => {
              pending.delete(handle); // fired → no longer pending
              return (callback as AnyFn)(...args);
            }
          : callback;
      handle = originalSet.call(globalThis, run, ...rest);
      pending.set(handle, description);
      return handle;
    };
    g[clear] = (handle: unknown) => {
      pending.delete(handle);
      return originalClear.call(globalThis, handle);
    };
  };
  track("setTimeout", "clearTimeout", "a pending timeout", true);
  track("setInterval", "clearInterval", "a running interval", false);
  track("requestAnimationFrame", "cancelAnimationFrame", "a pending animation frame", true);

  return {
    leaks: () => [...live.map((r) => `an event listener ("${r.type}")`), ...pending.values()],
    stop() {
      for (const restore of restoreListeners) restore();
      Object.assign(g, originals);
    },
  };
}

/** Objects in the prototype chains of common event targets that own `addEventListener`. */
function listenerOwners(): EventTarget[] {
  const owners = new Set<EventTarget>();
  const samples: object[] = [
    EventTarget.prototype,
    window,
    document,
    document.createElement("div"),
  ];
  for (const sample of samples) {
    for (let p: object | null = sample; p; p = Object.getPrototypeOf(p)) {
      if (Object.hasOwn(p, "addEventListener")) owners.add(p as EventTarget);
    }
  }
  return [...owners];
}

function pick(g: Record<TimerApi | ClearApi, AnyFn | undefined>) {
  const {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame,
    cancelAnimationFrame,
  } = g;
  return {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame,
    cancelAnimationFrame,
  };
}
