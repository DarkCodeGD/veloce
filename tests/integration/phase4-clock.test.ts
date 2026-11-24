/**
 * Phase 4 acceptance (the clock, D107 §3, D115): presenting plays motion on the compositor,
 * seeking and export draw it on the main thread, and both must draw the same frame, so
 * what you scrub is what plays. The animated reference deck (`tests/visual/decks/
 * motion.json`) is drawn at moments in the middle of its animations both ways, by the real
 * render page in real Chromium, and compared pixel by pixel with the visual tests' rule:
 * anti-aliasing aside, not one pixel may differ.
 *
 * Two checks per moment. Every layer's computed transform, opacity and filter must agree
 * within what the planner allows (D115 tolerances): that is the motion itself, exactly.
 * And the frames must look the same, compared in 4×4 blocks: Chrome stretches a layer it
 * animates from a bitmap rasterized earlier, softer at the edges than a fresh paint, and
 * when it re-rasterizes it depends on load, so edge sharpness can't count; position,
 * layering and color still do (measured: a whole frame shifted 1 px fails with 412 blocks
 * differing; the softness that broke the exact comparison under load passes).
 *
 * Needs the built editor and headless Chromium (skipped locally without them, required in CI).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuiltinRegistry } from "@veloce/builtins";
import { type Deck, validateDeck } from "@veloce/core";
import { Workspace } from "@veloce/doc-server";
import { migrateDocument, type RawDocument } from "@veloce/format";
import { startVeloceServer, type VeloceServer } from "@veloce/server";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareScreenshots } from "../visual/compare.js";
import { browserProblem } from "./editor-harness.js";

const problem = await browserProblem();
const EDITOR_DIST = fileURLToPath(new URL("../../apps/editor/dist", import.meta.url));
const DECK = fileURLToPath(new URL("../visual/decks/motion.json", import.meta.url));
const OUTPUT = fileURLToPath(new URL("../visual/.output", import.meta.url));

let dir: string;
let workspace: Workspace;
let app: VeloceServer;
let browser: Browser;
let page: Page;
let deck: Deck;

beforeAll(async () => {
  if (problem) return;
  const registry = createBuiltinRegistry();
  const raw = JSON.parse(await readFile(DECK, "utf8")) as RawDocument;
  const validation = validateDeck(
    migrateDocument(raw, Number(raw.formatVersion)),
    registry.applyContext(),
  );
  if (!validation.ok) throw new Error(validation.errors[0]?.message);
  deck = validation.deck;
  dir = await mkdtemp(join(tmpdir(), "veloce-clock-"));
  workspace = await Workspace.open({ dir, context: registry.applyContext() });
  app = await startVeloceServer({
    workspace,
    registry,
    editorDir: EDITOR_DIST,
    port: 0,
    log: () => {},
    render: null,
  });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${app.url}/render.html`);
  await page.waitForFunction(() => "veloceRender" in window);
}, 60_000);

afterAll(async () => {
  if (problem) return;
  await browser?.close();
  await app?.close();
  await workspace?.close();
  await rm(dir, { recursive: true, force: true });
});

/** The slide at a moment, drawn by the clock or by the compositor frozen there. */
async function shot(
  slideId: string,
  step: number,
  time: number,
  playback: "clock" | "compositor",
): Promise<Uint8Array> {
  const size = await page.evaluate(
    ([d, slide, at]) =>
      (
        window as unknown as {
          veloceRender: {
            show(...args: unknown[]): Promise<{ width: number; height: number }>;
          };
        }
      ).veloceRender.show(d, d.id, slide, d.stage.width, at),
    [deck, slideId, { step, time, playback }] as const,
  );
  return new Uint8Array(
    await page.screenshot({ clip: { x: 0, y: 0, width: size.width, height: size.height } }),
  );
}

/** Every layer's computed transform, opacity and filter, as numbers. */
function drawnValues(): Promise<
  Record<string, { transform: number[]; opacity: number; blur: number }>
> {
  return page.evaluate(() => {
    const numbers = (s: string) => (s.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    const out: Record<string, { transform: number[]; opacity: number; blur: number }> = {};
    for (const el of document.querySelectorAll<HTMLElement>("[data-node-id]")) {
      const style = getComputedStyle(el);
      out[el.dataset.nodeId ?? ""] = {
        transform:
          style.transform === "none" ? [] : numbers(style.transform.replace(/^matrix(3d)?/, "")),
        opacity: Number(style.opacity),
        blur: numbers(style.filter.match(/blur\(([^)]*)\)/)?.[1] ?? "0")[0] ?? 0,
      };
    }
    return out;
  });
}

/** Where two layers' drawn values differ by more than the planner allows, or null. */
function motionMismatch(
  a: Awaited<ReturnType<typeof drawnValues>>,
  b: Awaited<ReturnType<typeof drawnValues>>,
): string | null {
  for (const [id, x] of Object.entries(a)) {
    const y = b[id];
    if (!y) return `${id} is missing`;
    if (Math.abs(x.opacity - y.opacity) > 2 / 255)
      return `${id} opacity ${x.opacity} vs ${y.opacity}`;
    if (Math.abs(x.blur - y.blur) > 0.5) return `${id} blur ${x.blur} vs ${y.blur}`;
    const identity = (n: number) =>
      n === 6 ? [1, 0, 0, 1, 0, 0] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const length = Math.max(x.transform.length, y.transform.length);
    if (length === 0) continue;
    const [p, q] = [x, y].map((v) => (v.transform.length ? v.transform : identity(length)));
    if (p?.length !== q?.length) return `${id} transform ${x.transform} vs ${y.transform}`;
    // Translation entries are pixels; the rest are unitless (rotation, scale, perspective).
    const translation = length === 6 ? [4, 5] : [12, 13, 14];
    for (let i = 0; i < length; i++) {
      const tolerance = translation.includes(i) ? 0.5 : 0.004;
      if (Math.abs((p?.[i] ?? 0) - (q?.[i] ?? 0)) > tolerance) {
        return `${id} transform ${x.transform} vs ${y.transform}`;
      }
    }
  }
  return null;
}

/** Moments in the middle of things: springs, 3D turns, a loop, a color, a nested slide level. */
const MOMENTS: [slide: string, step: number, time: number, what: string][] = [
  ["steps", 0, 200, "the title fading in, a built-in effect preset"],
  ["steps", 0, 600, "the subtitle rising and fading in"],
  ["steps", 1, 150, "two cards on a spring, staggered"],
  ["steps", 1, 770, "a card swinging in from depth, turned in 3D"],
  ["steps", 2, 333, "a bar growing while its color blends (the color on the clock)"],
  ["steps", 2, 1777, "a pulse looping forever, blurred"],
  ["steps", 3, 200, "a bar shaking, in the second of its three plays"],
  ["finale", 0, 60, "the title flipping up on a bouncy spring at absurd"],
];

describe.skipIf(problem !== null)("Phase 4: the clock (D107, D115)", { timeout: 60_000 }, () => {
  for (const [slide, step, time, what] of MOMENTS) {
    it(`draws the same frame both ways: ${slide}, step ${step} at ${time} ms, ${what}`, async () => {
      const compositor = await shot(slide, step, time, "compositor");
      const compositorValues = await drawnValues();
      const animated = await page.evaluate(() => document.getAnimations().length);
      const clock = await shot(slide, step, time, "clock");
      expect(motionMismatch(await drawnValues(), compositorValues)).toBeNull();
      const result = compareScreenshots(clock, compositor, { pool: 4 });
      if (!result.match) {
        // Beside the visual tests' diffs, which CI uploads (the visual-diffs artifact).
        const key = `${OUTPUT}/clock--${slide}@${step}-${time}`;
        await mkdir(OUTPUT, { recursive: true });
        await writeFile(`${key}.clock.png`, clock);
        await writeFile(`${key}.compositor.png`, compositor);
        if (result.diff) await writeFile(`${key}.diff.png`, result.diff);
      }
      expect(result.match, result.reason).toBe(true);
      // Not a draw by default: without its Web Animations, the page shows another moment
      // (the step's start, where the main thread left the layers), so they drew this one.
      expect(animated).toBeGreaterThan(0);
      await shot(slide, step, time, "compositor");
      await page.evaluate(() => {
        for (const a of document.getAnimations()) a.cancel();
      });
      const withoutCompositor = new Uint8Array(
        await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } }),
      );
      expect(compareScreenshots(compositor, withoutCompositor, { pool: 4 }).match).toBe(false);
    });
  }

  it("really moves: the moment differs from the slide at rest and from its own end", async () => {
    const moving = await shot("steps", 1, 150, "clock");
    const settled = await shot("steps", 1, 10_000, "clock");
    expect(compareScreenshots(moving, settled).match).toBe(false);
  });
});
