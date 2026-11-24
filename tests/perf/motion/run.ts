/**
 * The motion performance test (D104 §4): main-thread `setMotion` against compositor playback
 * (Web Animations API) on a busy slide, on the real GPU, at normal speed, with the CPU slowed
 * 4× (a modest laptop) and with long tasks on the main thread.
 *
 *   pnpm perf:motion              # the full sweep, a few minutes
 *   pnpm perf:motion --quick      # 300 layers only
 *   pnpm perf:motion --traces     # also keep each run's Chrome trace in .output/
 *
 * Smoothness comes from Chrome's own frame reports (the `PipelineReporter` trace events), not
 * from requestAnimationFrame: compositor animations keep playing while JavaScript is blocked,
 * and only the trace sees those frames. Chrome reports most frames twice under one
 * `frame_sequence` (a compositor-only "forked" report and the main one), so frames are counted
 * by sequence. A frame counts as smooth when it reached the screen with the animation's update
 * in it: for main-thread motion, the main report presented everything; for compositor motion,
 * any report presented it. Each scenario runs three times (`--repeat=N`) and the median by
 * smooth fps is kept. Writes `.output/report.md` and `.output/report.json`.
 *
 * Timings depend on the machine, so this isn't part of `pnpm check`; the numbers it produced
 * are recorded in DECISIONS.md.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { build } from "vite";
import type { Bench, PageStats, RunOptions, SetupOptions } from "./bench.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, ".output", "dist");
const WARMUP_MS = 600;
/** Tracing runs this long; only the last `WINDOW_MS` is analyzed, because Chrome doesn't
 * record the first frames after tracing starts (a gap in sequence numbers, not drops). */
const MEASURE_MS = 3500;
const WINDOW_MS = 2500;
const REFRESH_HZ = 60;

interface Scenario extends SetupOptions {
  condition: "normal" | "cpu 4×" | "long tasks";
  mode: RunOptions["mode"];
}

interface Result extends Scenario {
  smoothFps: number;
  /** Longest time between two smooth frames: what the eye sees as a stutter. */
  longestFreezeMs: number;
  /** Share of the display's frames that showed the animation's update. */
  smoothShare: number;
  /** Frames Chrome dropped outright. */
  droppedFrames: number;
  motionP50Ms: number | null;
  motionP95Ms: number | null;
  animations: number;
  states: Record<string, number>;
}

function scenarios(quick: boolean): Scenario[] {
  const out: Scenario[] = [];
  const only = process.argv.find((a) => a.startsWith("--layers="));
  const sizes = only
    ? only.slice("--layers=".length).split(",").map(Number)
    : quick
      ? [300]
      : [300, 600, 1000, 3000];
  for (const layers of sizes)
    for (const blurEvery of [0, 3])
      for (const condition of ["normal", "cpu 4×", "long tasks"] as const)
        for (const mode of ["main", "compositor"] as const)
          out.push({ layers, blurEvery, condition, mode });
  return out;
}

/** Serves the built page; module scripts don't load from file:// URLs. */
async function serve(): Promise<{ url: string; close: () => void }> {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
  };
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"));
    const file = join(dist, path === "/" ? "index.html" : path);
    if (!file.startsWith(dist)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  return { url: `http://127.0.0.1:${address.port}/`, close: () => server.close() };
}

interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  ts: number;
  args?: {
    name?: string;
    frame_reporter?: { state?: string; frame_sequence?: number; frame_type?: string };
  };
}

/** Smooth frames in the renderer's compositor, from Chrome's frame reports. */
function frameReport(trace: Buffer, mode: RunOptions["mode"]) {
  const events = (JSON.parse(trace.toString()) as { traceEvents: TraceEvent[] }).traceEvents;
  const renderers = new Set(
    events
      .filter((e) => e.ph === "M" && e.name === "process_name" && e.args?.name === "Renderer")
      .map((e) => e.pid),
  );
  const byPid = new Map<number, TraceEvent[]>();
  for (const e of events) {
    if (e.name !== "PipelineReporter" || e.ph !== "b" || !renderers.has(e.pid)) continue;
    byPid.set(e.pid, [...(byPid.get(e.pid) ?? []), e]);
  }
  const reports = [...byPid.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const states: Record<string, number> = {};
  const bySequence = new Map<number, { ts: number; smooth: boolean; presented: boolean }>();
  for (const r of reports) {
    const fr = r.args?.frame_reporter;
    const state = fr?.state ?? "?";
    states[state] = (states[state] ?? 0) + 1;
    const presented = state.startsWith("STATE_PRESENTED");
    // Main-thread motion is on screen only when the main report presented everything;
    // compositor animations tick in every presented frame, forked or not.
    const smooth =
      mode === "main" ? fr?.frame_type !== "FORKED" && state === "STATE_PRESENTED_ALL" : presented;
    const key = fr?.frame_sequence ?? r.ts;
    const seen = bySequence.get(key);
    bySequence.set(key, {
      ts: Math.min(seen?.ts ?? r.ts, r.ts),
      smooth: (seen?.smooth ?? false) || smooth,
      presented: (seen?.presented ?? false) || presented,
    });
  }
  const all = [...bySequence.values()];
  const end = Math.max(...all.map((f) => f.ts));
  const frames = all.filter((f) => f.ts >= end - WINDOW_MS * 1000);
  const smooth = frames
    .filter((f) => f.smooth)
    .map((f) => f.ts / 1000)
    .sort((a, b) => a - b);
  let longest = 0;
  for (let i = 1; i < smooth.length; i++)
    longest = Math.max(longest, (smooth[i] ?? 0) - (smooth[i - 1] ?? 0));
  const dropped = frames.filter((f) => !f.presented).length;
  return { smoothFrames: smooth.length, longestFreezeMs: longest, dropped, states };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? null;
}

async function runOne(browser: Browser, page: Page, base: string, s: Scenario): Promise<Result> {
  await page.goto(base);
  await page.waitForFunction(() => "bench" in window);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: s.condition === "cpu 4×" ? 4 : 1 });
  const setup: SetupOptions = { layers: s.layers, blurEvery: s.blurEvery };
  await page.evaluate((o) => (window as unknown as { bench: Bench }).bench.setup(o), setup);
  const run: RunOptions = { mode: s.mode, longTasks: s.condition === "long tasks" };
  await page.evaluate((o) => (window as unknown as { bench: Bench }).bench.start(o), run);
  await page.waitForTimeout(WARMUP_MS);
  await browser.startTracing(page, {
    categories: ["benchmark", "cc", "disabled-by-default-devtools.timeline.frame"],
  });
  await page.waitForTimeout(MEASURE_MS);
  const trace = await browser.stopTracing();
  if (process.argv.includes("--traces")) {
    const name = `${s.layers}-${s.blurEvery}-${s.condition}-${s.mode}`.replace(
      /[^a-z0-9-]+/gi,
      "_",
    );
    await writeFile(join(here, ".output", `trace-${name}.json`), trace);
  }
  const stats: PageStats = await page.evaluate(() =>
    (window as unknown as { bench: Bench }).bench.stop(),
  );
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await cdp.detach();
  const report = frameReport(trace, s.mode);
  const seconds = WINDOW_MS / 1000;
  return {
    ...s,
    smoothFps: report.smoothFrames / seconds,
    longestFreezeMs: report.longestFreezeMs,
    smoothShare: Math.min(1, report.smoothFrames / (seconds * REFRESH_HZ)),
    droppedFrames: report.dropped,
    motionP50Ms: percentile(stats.motionMs, 50),
    motionP95Ms: percentile(stats.motionMs, 95),
    animations: stats.animations,
    states: report.states,
  };
}

function table(results: Result[], gpu: string, repeat: number): string {
  const ms = (v: number | null) => (v === null ? "–" : v.toFixed(1));
  const rows = results.map(
    (r) =>
      `| ${r.layers} | ${r.blurEvery ? `1 in ${r.blurEvery}` : "none"} | ${r.condition} | ${r.mode} | ${r.smoothFps.toFixed(0)} | ${(r.smoothShare * 100).toFixed(0)}% | ${r.longestFreezeMs.toFixed(0)} | ${r.droppedFrames} | ${ms(r.motionP50Ms)} / ${ms(r.motionP95Ms)} |`,
  );
  return [
    "# Motion performance (D104 §4)",
    "",
    `GPU: ${gpu}. ${WINDOW_MS / 1000} s analyzed per run after ${WARMUP_MS} ms of warm-up, ${REFRESH_HZ} Hz display, median of ${repeat} runs. 1920×1080.`,
    "",
    "| Layers | Blur | Condition | Playback | Smooth fps | Smooth frames | Longest freeze (ms) | Dropped | Motion JS p50 / p95 (ms) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const quick = process.argv.includes("--quick");
  const repeatArg = process.argv.find((a) => a.startsWith("--repeat="));
  const repeat = repeatArg ? Number(repeatArg.slice("--repeat=".length)) : quick ? 1 : 3;
  await build({ configFile: join(here, "vite.config.ts") });
  const server = await serve();
  const browser = await chromium.launch({ args: ["--enable-gpu"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
    // A first run warms up the GPU (shader compiles, raster) and is thrown away.
    await runOne(browser, page, server.url, {
      layers: 300,
      blurEvery: 3,
      condition: "normal",
      mode: "compositor",
    });
    const results: Result[] = [];
    for (const s of scenarios(quick)) {
      const runs: Result[] = [];
      for (let i = 0; i < repeat; i++) runs.push(await runOne(browser, page, server.url, s));
      runs.sort((a, b) => a.smoothFps - b.smoothFps);
      const r = runs[Math.floor(runs.length / 2)] as Result;
      results.push(r);
      console.log(
        `${String(s.layers).padStart(4)} layers, blur ${s.blurEvery ? `1/${s.blurEvery}` : "none"}, ${s.condition.padEnd(16)} ${s.mode.padEnd(10)} → ${r.smoothFps.toFixed(0).padStart(3)} fps, freeze ${r.longestFreezeMs.toFixed(0).padStart(4)} ms, dropped ${r.droppedFrames}, JS p95 ${r.motionP95Ms?.toFixed(1) ?? "–"} ms`,
      );
    }
    await writeFile(join(here, ".output", "report.md"), table(results, gpu, repeat));
    await writeFile(
      join(here, ".output", "report.json"),
      `${JSON.stringify({ gpu, results }, null, 2)}\n`,
    );
    console.log(`\nReport: ${join(here, ".output", "report.md")}`);
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
