/**
 * The worker thread that runs `optimizeImage` (see `pool.ts`): one job at a time, the
 * result's bytes transferred back, never copied.
 */
import { parentPort } from "node:worker_threads";
import { optimizeImage } from "./optimize.ts";

interface Job {
  bytes: Uint8Array;
  size?: { width?: number; height?: number };
}

parentPort?.on("message", async ({ bytes, size }: Job) => {
  try {
    const result = await optimizeImage(bytes, size);
    const transfer = "optimized" in result ? [result.optimized.bytes.buffer as ArrayBuffer] : [];
    parentPort?.postMessage({ result }, transfer);
  } catch (error) {
    parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
