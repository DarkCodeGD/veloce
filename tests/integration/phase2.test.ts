/**
 * Phase 2 acceptance: "an agent builds a deck over MCP, watches lint and previews, fixes its
 * own issues, and the user sees it live in the editor."
 *
 * Runs the real server (HTTP + WebSocket + MCP) on a random port with a temp workspace.
 * Visual checks use real headless Chromium and the built editor's render page; without them
 * those tests are skipped locally (CI provides both and sets VELOCE_REQUIRE_BROWSER=1).
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBuiltinRegistry } from "@veloce/builtins";
import { applyChange, type Deck, type LocalReplica, type ServerMessage } from "@veloce/core";
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
const visual = problem === null;

let dir: string;
let app: VeloceServer;
let workspace: Workspace;
let agent: Client;

async function start() {
  const registry = createBuiltinRegistry();
  workspace = await Workspace.open({ dir, context: registry.applyContext(), autosaveDelayMs: 10 });
  app = await startVeloceServer({
    workspace,
    registry,
    editorDir: EDITOR_DIST,
    port: 0,
    log: () => {},
    render: visual
      ? (baseUrl) => new CachedRenderService(new PlaywrightRenderService({ baseUrl }))
      : null,
  });
  agent = new Client({ name: "Claude Code", version: "test" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(app.mcpUrl)));
}

async function stop() {
  await agent.close();
  await app.close();
  await workspace.close();
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await agent.callTool({ name, arguments: args });
  const content = result.content as Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  return {
    isError: result.isError === true,
    text: content.flatMap((c) => (c.type === "text" ? [c.text ?? ""] : [])).join("\n"),
    image: content.find((c) => c.type === "image"),
  };
}

/** An editor-like client: keeps a replica of the open deck from the sync protocol. */
function editorClient(url: string) {
  const ws = new WebSocket(`${url.replace("http", "ws")}/ws`);
  const state: { replica: LocalReplica | null; deckId: string | null; messages: ServerMessage[] } =
    {
      replica: null,
      deckId: null,
      messages: [],
    };
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    state.messages.push(message);
    if (message.type === "welcome" && message.activeDeckId)
      ws.send(JSON.stringify({ type: "open", deckId: message.activeDeckId }));
    if (message.type === "decks" && message.activeDeckId && message.activeDeckId !== state.deckId) {
      ws.send(JSON.stringify({ type: "open", deckId: message.activeDeckId }));
    }
    if (message.type === "snapshot") {
      state.deckId = message.deckId;
      state.replica = { deck: message.deck, version: message.version };
    }
    if (message.type === "change" && state.replica && message.deckId === state.deckId) {
      state.replica = applyChange(state.replica, message);
    }
  });
  return { ws, state, opened: new Promise((resolve) => ws.addEventListener("open", resolve)) };
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Raw HTTP request with chosen Host/Origin headers (fetch won't let us forge Host). */
function rawStatus(url: string, headers: Record<string, string>, upgrade = false): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        headers: upgrade
          ? {
              ...headers,
              connection: "Upgrade",
              upgrade: "websocket",
              "sec-websocket-version": "13",
              "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
            }
          : headers,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 101);
    });
    req.on("error", (error) => {
      // The server answers refused upgrades with a raw status line, then closes.
      if (/socket hang up|ECONNRESET/.test(error.message)) resolve(-1);
      else reject(error);
    });
    req.end();
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "veloce-phase2-"));
  await start();
}, 60_000);

afterAll(async () => {
  await stop().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}, 60_000);

describe("Phase 2: an agent builds a deck the user watches live", { timeout: 60_000 }, () => {
  it("agent creates and builds a deck; the editor replica follows every change", async () => {
    const editor = editorClient(app.url);
    await editor.opened;

    const created = await call("create_deck", { title: "Solar Coffee Cart", theme: "midnight" });
    expect(created.isError).toBe(false);
    await until(() => editor.state.replica?.deck.meta.title === "Solar Coffee Cart");

    const slide = await call("upsert_slide", {
      slide: {
        id: "title",
        name: "Title",
        children: [
          {
            id: "headline",
            type: "text",
            props: { content: "Sunbrew", style: "$text.display", align: "center" },
          },
          {
            id: "tagline",
            type: "text",
            props: {
              content: "Coffee that runs on sunshine",
              style: "$text.h3",
              color: "$color.muted",
              align: "center",
            },
          },
        ],
      },
    });
    expect(slide.isError).toBe(false);
    expect(slide.text).toMatch(/- headline: text "Sunbrew" \$text\.display/);
    await until(() => editor.state.replica?.deck.slides.length === 1);

    const server = (await workspace.get(workspace.activeDeckId ?? "")).deck;
    expect(editor.state.replica?.deck).toEqual(server);
    expect(
      editor.state.messages.some((m) => m.type === "change" && m.origin === "agent:claude-code"),
    ).toBe(true);
  });

  it.skipIf(!visual)(
    "lint measures in a real browser: the agent sees overflow and fixes it",
    async () => {
      const long =
        "We roast, brew and serve specialty coffee from a cart powered entirely by rooftop solar panels, with batteries for cloudy days and evening events. ".repeat(
          3,
        );
      const bad = await call("upsert_slide", {
        slide: {
          id: "problem",
          layout: { mode: "stack", gap: "$space.md", padding: "$space.xl", justify: "start" },
          children: [
            { id: "p-title", type: "text", props: { content: "The problem", style: "$text.h1" } },
            {
              id: "p-body",
              type: "text",
              height: 120,
              props: { content: long, style: "$text.body" },
            },
            {
              id: "p-faint",
              type: "text",
              props: { content: "Barely visible", color: "$color.surface" },
            },
          ],
        },
      });
      expect(bad.text).toMatch(
        /\[error\] overflow · slide problem · p-body: text "p-body" content is \d+px too tall/,
      );
      expect(bad.text).toMatch(/low-contrast · slide problem · p-faint/);

      const fixed = await call("apply_ops", {
        label: "Fix problem slide",
        ops: [
          {
            op: "node.update",
            id: "p-body",
            set: {
              height: null,
              props: { content: "Coffee carts burn diesel and can't park where people are." },
            },
          },
          { op: "node.update", id: "p-faint", set: { props: { color: "$color.muted" } } },
        ],
      });
      expect(fixed.text).toMatch(/Lint: 0 errors, 0 warnings, 1 info\./);
      // Three short lines pinned to the top: worth a nudge, not an error.
      expect(fixed.text).toMatch(/\[info\] empty-space · slide problem · .*The bottom \d+%/);

      // The measured layout is real: the title sits inside the slide padding (96px).
      const detail = await call("get_slide", { slideId: "problem" });
      expect(detail.text).toMatch(/p-title: 96,96 1728×\d+/);
    },
  );

  it.skipIf(!visual)("render_preview returns a real screenshot of the slide", async () => {
    const preview = await call("render_preview", { slideId: "title" });
    expect(preview.isError).toBe(false);
    expect(preview.image?.mimeType).toBe("image/jpeg");
    const bytes = Buffer.from(preview.image?.data ?? "", "base64");
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]); // JPEG
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  // Regressions from the first real Claude Code transcript.
  it.skipIf(!visual)(
    "centers hug-sized frames and checks text contrast over gradients",
    async () => {
      const result = await call("upsert_slide", {
        slide: {
          id: "cta",
          layout: { mode: "stack", align: "center", justify: "center", gap: "$space.lg" },
          children: [
            {
              id: "fade",
              width: 800,
              height: 200,
              layout: { mode: "stack", padding: "$space.md" },
              style: {
                fill: {
                  type: "linear-gradient",
                  angle: 90,
                  stops: [
                    { offset: 0, color: "$color.primary" },
                    { offset: 1, color: "#1a1040" },
                  ],
                },
              },
              children: [
                {
                  id: "fade-text",
                  type: "text",
                  props: { content: "Dark text, darkening fill", color: "$color.on-primary" },
                },
              ],
            },
            {
              id: "button",
              width: "hug",
              height: "hug",
              layout: { mode: "stack", padding: "$space.sm" },
              style: { fill: "$color.primary", radius: "$radius.full" },
              children: [
                {
                  id: "button-label",
                  type: "text",
                  props: { content: "Get in touch", color: "$color.on-primary" },
                },
              ],
            },
          ],
        },
      });
      expect(result.text).toMatch(/low-contrast · slide cta · fade-text/);
      expect(result.text).not.toMatch(/low-contrast · slide cta · button-label/);

      const detail = await call("get_slide", { slideId: "cta" });
      const match = /^button: (\d+),\d+ (\d+)×/m.exec(detail.text);
      const [x, width] = [Number(match?.[1]), Number(match?.[2])];
      expect(width).toBeLessThan(600); // hugs its label
      expect(Math.abs(x + width / 2 - 960)).toBeLessThanOrEqual(1); // centered on the stage
    },
  );

  it.skipIf(!visual)("checks contrast for theme colors at an opacity", async () => {
    // "$color.x/NN" renders as color-mix(), which Chromium reports as color(srgb …): text,
    // fills and gradient stops must all still be measured.
    const veil = {
      type: "linear-gradient",
      stops: [0, 1].map((offset) => ({ offset, color: "$color.text/90" })),
    };
    const result = await call("upsert_slide", {
      slide: {
        id: "glass",
        layout: { mode: "stack", gap: "$space.md" },
        children: [
          { id: "whisper", type: "text", props: { content: "Whisper", color: "$color.text/15" } },
          { id: "speak", type: "text", props: { content: "Speak", color: "$color.text/90" } },
          {
            id: "tint",
            layout: { mode: "stack", padding: "$space.sm" },
            style: { fill: "$color.primary/15" },
            children: [{ id: "tint-label", type: "text", props: { content: "On a tint" } }],
          },
          {
            id: "veil",
            layout: { mode: "stack", padding: "$space.sm" },
            style: { fill: veil },
            children: [{ id: "veil-label", type: "text", props: { content: "Lost in the veil" } }],
          },
          {
            // Angular (conic) gradients are measured like the others (D66).
            id: "wheel",
            layout: { mode: "stack", padding: "$space.sm" },
            style: { fill: { ...veil, type: "conic-gradient", angle: 30 } },
            children: [
              { id: "wheel-label", type: "text", props: { content: "Lost in the wheel" } },
            ],
          },
        ],
      },
    });
    expect(result.text).toMatch(/low-contrast · slide glass · whisper/);
    expect(result.text).toMatch(/low-contrast · slide glass · veil-label/);
    expect(result.text).toMatch(/low-contrast · slide glass · wheel-label/);
    expect(result.text).not.toMatch(/low-contrast · slide glass · (speak|tint-label)/);
    expect(result.text).not.toMatch(/unknown-token/);
  });

  it.skipIf(!visual)("wrapped text in any alignment never reads as overflowing", async () => {
    // Regression: the space at each soft wrap hangs past the line end; it isn't content.
    const lines = [
      "Coffee carts burn diesel, make noise and can't park where the customers actually are.",
      "Silent, zero-emission and allowed in parks, campuses and indoor events across the city.",
      "We roast, brew and serve specialty coffee from a cart powered entirely by rooftop solar.",
    ];
    const children = (["left", "center", "right"] as const).flatMap((align, i) =>
      [380, 460, 540].map((width, j) => ({
        id: `wrap-${align}-${width}`,
        type: "text",
        width,
        props: { content: lines[(i + j) % 3], align, style: "$text.body" },
      })),
    );
    const result = await call("upsert_slide", {
      slide: {
        id: "wrapping",
        layout: { mode: "grid", columns: 3, gap: "$space.sm", padding: "$space.md" },
        children,
      },
    });
    expect(result.text).not.toMatch(/overflow ·/);
    // Real overflow is still caught: wrapped lines in a box too short for them.
    // (Long words never spill sideways: text uses overflow-wrap: break-word.)
    const tight = await call("apply_ops", {
      label: "Squeeze",
      ops: [{ op: "node.update", id: "wrap-left-380", set: { height: 40 } }],
    });
    expect(tight.text).toMatch(/overflow · slide wrapping · wrap-left-380: .*too tall/);
  });

  it.skipIf(!visual)("free layers hanging past their frame aren't overflow", async () => {
    // From an agent run: a rotated sticker 12px past a CTA's corner read as "children are
    // 23px too tall", with no way to say it was intended.
    const result = await call("upsert_slide", {
      slide: {
        id: "hanging",
        layout: { mode: "stack", align: "center", justify: "center" },
        children: [
          {
            id: "h-cta",
            width: 600,
            layout: { mode: "stack", padding: 16 },
            style: { fill: "$color.surface" },
            children: [
              { id: "h-cta-text", type: "text", props: { content: "Start free today" } },
              {
                id: "h-sticker",
                type: "text",
                width: "hug",
                rotation: -8,
                positioning: "free",
                position: { x: -12, y: -12 },
                props: { content: "Save 20%" },
              },
            ],
          },
        ],
      },
    });
    expect(result.text).not.toMatch(/overflow ·/);
    // The frame's own flow content is still checked: text starting 16px down sticks out of
    // a 40px box.
    const tight = await call("apply_ops", {
      label: "Squeeze",
      ops: [{ op: "node.update", id: "h-cta", set: { height: 40 } }],
    });
    // (Reported on the innermost box that spills: the squeezed text.)
    expect(tight.text).toMatch(/overflow · slide hanging · h-cta(-text)?: /);
    // And a free layer that leaves the slide is still flagged.
    const off = await call("apply_ops", {
      label: "Off",
      ops: [{ op: "node.update", id: "h-sticker", set: { position: { x: -800, y: -12 } } }],
    });
    expect(off.text).toMatch(/off-canvas · slide hanging · h-sticker/);
  });

  it("refuses requests from other sites (DNS rebinding, cross-site requests, WebSocket hijacking)", async () => {
    const host = new URL(app.url).host;
    expect(await rawStatus(`${app.url}/api/health`, { host })).toBe(200);
    expect(await rawStatus(`${app.url}/api/health`, { host: "evil.example:80" })).toBe(403);
    expect(await rawStatus(`${app.url}/mcp`, { host, origin: "https://evil.example" })).toBe(403);
    expect(
      await rawStatus(`${app.url}/ws`, { host, origin: "https://evil.example" }, true),
    ).not.toBe(101);
    expect(await rawStatus(`${app.url}/ws`, { host, origin: app.url }, true)).toBe(101);
    const traversal = await fetch(`${app.url}/..%2f..%2fpackage.json`);
    expect(traversal.status).toBe(400);
  });

  it("imports uploaded files over HTTP, refusing cross-site, junk and oversized uploads", async () => {
    const deckId = workspace.activeDeckId ?? "";
    const url = `${app.url}/api/decks/${deckId}/assets`;
    const gif = Uint8Array.from([...new TextEncoder().encode("GIF89a"), 4, 0, 2, 0, 0, 0]);
    const upload = (body: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
      fetch(url, {
        method: "POST",
        body,
        headers: { "x-veloce-upload": "1", "x-veloce-filename": "dot%20%E2%9C%93.gif", ...headers },
      });

    const ok = await upload(gif);
    expect(ok.status).toBe(201);
    const { id, info } = (await ok.json()) as { id: string; info: Record<string, unknown> };
    expect(info).toEqual({ mime: "image/gif", bytes: 12, name: "dot ✓.gif", width: 4, height: 2 });
    expect(id).toMatch(/^[0-9a-f]{64}$/);

    // Cross-site pages are refused twice over: by Origin, and by the custom header they can't send.
    expect((await upload(gif, { origin: "https://evil.example" })).status).toBe(403);
    const noHeader = await fetch(url, { method: "POST", body: gif });
    expect(noHeader.status).toBe(403);
    expect(((await noHeader.json()) as { error: string }).error).toMatch(/x-veloce-upload/);
    // Junk is refused with what's accepted; nothing is stored.
    const junk = await upload(new TextEncoder().encode("<html>hi</html>"));
    expect(junk.status).toBe(415);
    expect(((await junk.json()) as { error: string }).error).toMatch(/PNG, JPEG/);
    expect(
      (
        await fetch(`${app.url}/api/decks/nope/assets`, {
          method: "POST",
          headers: { "x-veloce-upload": "1" },
          body: gif,
        })
      ).status,
    ).toBe(404);
    // Oversized: refused from the declared length, before reading the body.
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(url);
      const req = request(
        {
          method: "POST",
          host: u.hostname,
          port: u.port,
          path: u.pathname,
          headers: { "x-veloce-upload": "1", "content-length": String(60 * 1024 ** 2) },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.flushHeaders();
    });
    expect(status).toBe(413);
  });

  it("undo only reverts the agent's own work, and everything survives a restart", async () => {
    const before = (await workspace.get(workspace.activeDeckId ?? "")).deck;
    await call("upsert_slide", {
      slide: { id: "oops", children: [{ type: "text", props: { content: "Mistake" } }] },
    });
    expect((await call("undo_agent_changes")).text).toMatch(/Undid 1 step/);
    const after = (await workspace.get(workspace.activeDeckId ?? "")).deck;
    expect(after.slides.map((s) => s.id)).toEqual(before.slides.map((s) => s.id));

    await stop();
    await start();
    const summary = await call("get_deck_summary");
    expect(summary.text).toMatch(/^Deck "Solar Coffee Cart" .* theme Midnight/);
    const reloaded: Deck = (await workspace.get(workspace.activeDeckId ?? "")).deck;
    expect(reloaded).toEqual(after);
  });
});
