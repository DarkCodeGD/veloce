/**
 * Phase 4: agents animate (D126). An agent over real MCP (HTTP) builds a 2.5D slide,
 * animates it as steps, the whole deck from an intent, and looks at moments of the motion
 * through render_preview, drawn by the real render page in headless Chromium.
 *
 * Also the retest's lint finding: layers with `depth` are drawn bigger than the space they
 * take, and their frame must not read as overflowing (D126).
 *
 * Needs headless Chromium and the built editor (skipped locally without them, required in CI).
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBuiltinRegistry } from "@veloce/builtins";
import { CachedRenderService, Workspace } from "@veloce/doc-server";
import { PlaywrightRenderService, startVeloceServer, type VeloceServer } from "@veloce/server";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const EDITOR_DIST = fileURLToPath(new URL("../../apps/editor/dist", import.meta.url));

async function browserProblem(): Promise<string | null> {
  if (!existsSync(join(EDITOR_DIST, "render.html"))) return "editor not built (pnpm build:editor)";
  try {
    await (await chromium.launch()).close();
    return null;
  } catch {
    return "headless Chromium not installed";
  }
}
const problem = await browserProblem();
if (problem && process.env.VELOCE_REQUIRE_BROWSER)
  throw new Error(`Browser tests required but ${problem}`);

let dir: string;
let app: VeloceServer;
let workspace: Workspace;
let agent: Client;

beforeAll(async () => {
  if (problem) return;
  dir = await mkdtemp(join(tmpdir(), "veloce-motion-"));
  const registry = createBuiltinRegistry();
  workspace = await Workspace.open({ dir, context: registry.applyContext(), autosaveDelayMs: 10 });
  app = await startVeloceServer({
    workspace,
    registry,
    editorDir: EDITOR_DIST,
    port: 0,
    log: () => {},
    render: (baseUrl) => new CachedRenderService(new PlaywrightRenderService({ baseUrl })),
  });
  agent = new Client({ name: "Claude Code", version: "test" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(app.mcpUrl)));
}, 60_000);

afterAll(async () => {
  if (problem) return;
  await agent.close().catch(() => {});
  await app.close().catch(() => {});
  await workspace.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}, 60_000);

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await agent.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string; data?: string }>;
  return {
    isError: result.isError === true,
    text: content.flatMap((c) => (c.type === "text" ? [c.text ?? ""] : [])).join("\n"),
    image: content.find((c) => c.type === "image")?.data,
  };
}

const card = (id: string, depth: number) => ({
  id,
  width: 360,
  height: 360,
  depth,
  layout: { mode: "stack", padding: "$space.md" },
  style: { fill: "$color.surface", radius: "$radius.md" },
  children: [{ type: "text", props: { content: id.toUpperCase(), style: "$text.h2" } }],
});

describe.skipIf(problem !== null)(
  "Phase 4: agents animate over MCP (D126)",
  { timeout: 60_000 },
  () => {
    it("builds a 2.5D slide whose deep cards don't read as overflowing their row", async () => {
      await call("create_deck", { title: "Motion", theme: "midnight" });
      const built = await call("upsert_slide", {
        slide: {
          id: "s1",
          children: [
            { id: "title", type: "text", props: { content: "Three bets", style: "$text.h1" } },
            {
              id: "row",
              perspective: 1000,
              layout: { mode: "stack", direction: "row", gap: "$space.lg", justify: "center" },
              children: [card("a", 80), card("b", -80), card("c", 80)],
            },
          ],
        },
      });
      expect(built.isError).toBe(false);
      expect(built.text).toMatch(/- row: frame \(stack row\) \[perspective 1000\]/);
      expect(built.text).toMatch(/- a: frame \(stack column\) \[depth 80\]/);
      expect(built.text).not.toMatch(/overflow · slide s1 · row/);
    });

    it("animates it as steps and shows a real moment of the motion", async () => {
      const set = await call("set_animations", {
        slideId: "s1",
        steps: [
          [{ target: "title", effect: "fade-in" }],
          [{ target: "row", effect: "flip-in", stagger: { each: 200 }, duration: 800 }],
        ],
      });
      expect(set.isError).toBe(false);
      expect(set.text).toMatch(/Click 1 \(1\.2s\): s1-a2 row flip-in \[for 800ms, one by one\]/);

      const before = await call("render_preview", { slideId: "s1", step: 1, time: 0 });
      const mid = await call("render_preview", { slideId: "s1", step: 1, time: 500 });
      const end = await call("render_preview", { slideId: "s1", step: 1 });
      expect(mid.text).toMatch(/step 1 \(click 1\) at 500ms of 1200ms/);
      expect(end.text).toMatch(/at 1200ms of 1200ms/);
      // Three different moments draw three different frames: nothing, cards turning, all in.
      expect(new Set([before.image, mid.image, end.image]).size).toBe(3);
      // The end of the last step is the slide at rest.
      expect(end.image).toBe((await call("render_preview", { slideId: "s1" })).image);
    });

    it("animates the whole deck from an intent, flipping only where there's perspective", async () => {
      await call("upsert_slide", {
        slide: {
          id: "s2",
          children: [
            { id: "kpi", type: "text", props: { content: "70 cherries", style: "$text.display" } },
            { id: "cap", type: "text", props: { content: "per cup of coffee" } },
          ],
        },
      });
      const result = await call("animate_deck", { level: "absurd", keepAnimated: false });
      expect(result.isError).toBe(false);
      expect(result.text).toMatch(/2 slides animated/);
      expect(result.text).toMatch(/s2-a\d+ kpi count-up/);
      // s2 has no perspective: its layers zoom where absurd would flip, and the note says why.
      expect(result.text).toMatch(/zoom in instead of flipping/);
      const mid = await call("render_preview", { slideId: "s2", step: 0, time: 300 });
      expect(mid.isError).toBe(false);
      expect(mid.image).toBeTruthy();
    });
  },
);
