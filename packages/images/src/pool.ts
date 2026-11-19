/**
 * Optimizing off the main thread. Encoding a 4K photo is seconds of CPU; on the server's
 * thread that would freeze live sync and MCP for everyone meanwhile. So images go to one
 * worker thread, one at a time (a burst of drops queues up instead of competing for the
 * same cores and memory).
 *
 * The worker is started on the first image and stopped after 30 s idle: WebAssembly memory
 * only grows, and a 4K image needs a few hundred MB while it's worked on, so an idle server
 * gives it all back. A worker that crashes or takes over a minute is stopped, and that image
 * is kept as it was: optimizing never makes an import fail.
 */
import { Worker } from "node:worker_threads";
import type { OptimizeResult } from "./optimize.ts";

const IDLE_MS = 30_000;
const TIMEOUT_MS = 60_000;

/** The worker's own file: TypeScript in the source tree (tests), JavaScript once built. */
const WORKER_URL = new URL(
  import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
  import.meta.url,
);

let worker: Worker | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

function stop() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const w = worker;
  worker = null;
  void w?.terminate();
}

function ensureWorker(): Worker {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!worker) {
    worker = new Worker(WORKER_URL);
    worker.unref(); // never keeps the process alive on its own
  }
  return worker;
}

function runOne(bytes: Uint8Array, size?: { width?: number; height?: number }) {
  return new Promise<OptimizeResult>((resolve) => {
    let w: Worker;
    try {
      w = ensureWorker();
    } catch {
      return resolve({ kept: "the optimizer couldn't start" });
    }
    const finish = (result: OptimizeResult, healthy: boolean) => {
      clearTimeout(timeout);
      w.off("message", onMessage);
      w.off("error", onError);
      w.off("exit", onExit);
      if (!healthy) stop();
      else idleTimer = setTimeout(stop, IDLE_MS).unref();
      resolve(result);
    };
    const onMessage = (message: { result?: OptimizeResult; error?: string }) =>
      finish(message.result ?? { kept: `the optimizer failed (${message.error})` }, true);
    const onError = () => finish({ kept: "the optimizer crashed" }, false);
    const onExit = () => finish({ kept: "the optimizer stopped" }, false);
    const timeout = setTimeout(
      () => finish({ kept: "optimizing took too long" }, false),
      TIMEOUT_MS,
    );
    w.on("message", onMessage);
    w.on("error", onError);
    w.on("exit", onExit);
    // A copy goes over (transferred): the caller keeps its bytes, the original.
    const copy = bytes.slice();
    w.postMessage({ bytes: copy, size }, [copy.buffer]);
  });
}

/**
 * `optimizeImage` in the worker thread, queued behind earlier images. Always resolves:
 * anything that goes wrong keeps the image as it is.
 */
export function optimizeInWorker(
  bytes: Uint8Array,
  size?: { width?: number; height?: number },
): Promise<OptimizeResult> {
  const job = queue.then(() => runOne(bytes, size));
  queue = job.catch(() => undefined);
  return job;
}

/** Stop the worker now (tests, shutdown). The next image starts a new one. */
export function stopOptimizer(): void {
  stop();
}
