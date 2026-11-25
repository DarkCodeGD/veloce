/**
 * Phase 4 acceptance (layout animations, D120), in real Chromium through the real render
 * page: a layer that leaves its stack lets the layers below glide up into its place; one
 * that makes room starts out of the stack, the others closed up, and they glide aside as it
 * comes in; a frame's children play one by one. The glide is motion on top of the rest
 * layout, so the compositor (presenting) and the clock (seeking, export) draw the same
 * thing, and a glide ends exactly where the smaller layout puts each layer.
 *
 * Needs the built editor and headless Chromium (skipped locally without them, required in CI).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuiltinRegistry } from "@veloce/builtins";
import {
  type Animation,
  createDeck,
  createSlide,
  type Deck,
  element,
  frame,
  motionTokens,
  resolveTime,
  validateDeck,
} from "@veloce/core";
import { Workspace } from "@veloce/doc-server";
import { startVeloceServer, type VeloceServer } from "@veloce/server";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem } from "./editor-harness.js";

const problem = await browserProblem();
const EDITOR_DIST = fileURLToPath(new URL("../../apps/editor/dist", import.meta.url));

let dir: string;
let workspace: Workspace;
let app: VeloceServer;
let browser: Browser;
let page: Page;
let deck: Deck;
let glide: number;

const box = (id: string) =>
  element("shape", { shape: "rect", fill: "#e5484d" }, { id, width: 300, height: 100 });
const stack = (id: string, children: string[]) =>
  frame({
    id,
    layout: { mode: "stack", direction: "column", gap: 20 },
    children: children.map(box),
  });
const fade = (
  id: string,
  target: string,
  out: boolean,
  extra: Partial<Animation> = {},
): Animation => ({
  id,
  target,
  duration: 200,
  easing: "linear",
  tracks: { opacity: [{ at: out ? 1 : 0, value: 0 }] },
  ...extra,
});

function build(): Deck {
  const built = createDeck({
    title: "Layout motion",
    slides: [
      createSlide({
        id: "collapse",
        children: [stack("list1", ["a1", "b1", "c1"])],
        animations: [fade("out", "b1", true, { space: "collapse" })],
      }),
      createSlide({
        id: "room",
        children: [stack("list2", ["a2", "b2", "c2"])],
        animations: [fade("in", "b2", false, { space: "makeRoom" })],
      }),
      createSlide({
        id: "cascade",
        children: [stack("list3", ["x", "y", "z"])],
        animations: [
          fade("each", "list3", false, {
            trigger: "withPrevious",
            duration: 300,
            stagger: { each: 300 },
          }),
        ],
      }),
    ],
  });
  const valid = validateDeck(built, createBuiltinRegistry().applyContext());
  if (!valid.ok) throw new Error(valid.errors[0]?.message);
  return valid.deck;
}

beforeAll(async () => {
  if (problem) return;
  const registry = createBuiltinRegistry();
  deck = build();
  glide = resolveTime("$motion.normal", motionTokens(deck.theme));
  dir = await mkdtemp(join(tmpdir(), "veloce-layout-"));
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

interface Drawn {
  top: number;
  opacity: number;
}

/** Each layer's drawn top edge and opacity, at rest or at a moment, either way. */
async function drawn(
  slideId: string,
  at?: { step: number; time: number; playback: "clock" | "compositor" },
): Promise<Record<string, Drawn>> {
  return page.evaluate(
    async ([d, slide, moment]) => {
      const render = (
        window as unknown as {
          veloceRender: { show(...args: unknown[]): Promise<unknown> };
        }
      ).veloceRender;
      await render.show(d, d.id, slide, d.stage.width, moment ?? undefined);
      const out: Record<string, { top: number; opacity: number }> = {};
      for (const el of document.querySelectorAll<HTMLElement>("[data-node-id]")) {
        out[el.dataset.nodeId ?? ""] = {
          top: el.getBoundingClientRect().top,
          opacity: Number(getComputedStyle(el).opacity),
        };
      }
      return out;
    },
    [deck, slideId, at ?? null] as const,
  );
}

describe.skipIf(problem !== null)("Phase 4: layout animations (D120)", { timeout: 60_000 }, () => {
  it("closes the gap: the layers below glide up into a layer's place once it's gone", async () => {
    const rest = await drawn("collapse");
    const before = await drawn("collapse", { step: 1, time: 100, playback: "clock" });
    expect(before.c1?.top).toBeCloseTo(rest.c1?.top ?? 0, 1); // still fading: nothing moved
    const mid = 200 + glide / 2;
    const clock = await drawn("collapse", { step: 1, time: mid, playback: "clock" });
    const compositor = await drawn("collapse", { step: 1, time: mid, playback: "compositor" });
    const after = await drawn("collapse", { step: 1, time: 200 + glide + 50, playback: "clock" });
    // Where the smaller layout puts it: right under a (100 px + the 20 px gap), the shorter
    // list re-centred on the slide as the real layout would, so a moves down half the gap.
    expect((after.c1?.top ?? 0) - (after.a1?.top ?? 0)).toBeCloseTo(120, 0);
    expect(after.a1?.top).toBeCloseTo((rest.a1?.top ?? 0) + 60, 0);
    expect(after.b1?.opacity).toBe(0);
    const [from, to] = [rest.c1?.top ?? 0, after.c1?.top ?? 0];
    expect(clock.c1?.top).toBeLessThan(from - 1);
    expect(clock.c1?.top).toBeGreaterThan(to + 1);
    expect(Math.abs((compositor.c1?.top ?? 0) - (clock.c1?.top ?? 0))).toBeLessThan(0.5);
  });

  it("makes room: the stack starts closed up, and opens as the layer comes in", async () => {
    const rest = await drawn("room");
    const start = await drawn("room", { step: 0, time: 0, playback: "clock" });
    expect(start.b2?.opacity).toBe(0);
    expect((start.c2?.top ?? 0) - (start.a2?.top ?? 0)).toBeCloseTo(120, 0); // closed up
    const mid = await drawn("room", { step: 1, time: glide / 2, playback: "compositor" });
    const gap = (mid.c2?.top ?? 0) - (mid.a2?.top ?? 0);
    expect(gap).toBeGreaterThan(121);
    expect(gap).toBeLessThan(239);
    const end = await drawn("room", { step: 1, time: glide + 50, playback: "clock" });
    expect(end.c2?.top).toBeCloseTo(rest.c2?.top ?? 0, 1);
    expect(end.b2?.opacity).toBe(1);
  });

  it("plays a frame's children one by one, in reading order", async () => {
    const at = await drawn("cascade", { step: 0, time: 450, playback: "clock" });
    expect([at.x?.opacity, at.y?.opacity, at.z?.opacity]).toEqual([1, 0.5, 0]);
    expect(at.list3?.opacity).toBe(1); // the frame itself doesn't fade
    const compositor = await drawn("cascade", { step: 0, time: 450, playback: "compositor" });
    expect(compositor.y?.opacity).toBeCloseTo(0.5, 1);
  });
});
