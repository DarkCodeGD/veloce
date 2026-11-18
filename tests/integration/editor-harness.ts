/**
 * Shared harness for the editor's browser acceptance tests: a real server on a temporary
 * workspace, an MCP agent that builds the deck under test, and headless Chromium on the
 * built editor. The server's change feed is the source of truth: tests count the
 * transactions it receives and read the values it stores.
 *
 * Needs the built editor (`pnpm build:editor`) and headless Chromium; suites skip without
 * them locally (`browserProblem`), CI requires both (VELOCE_REQUIRE_BROWSER=1).
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBuiltinRegistry } from "@veloce/builtins";
import type { Deck, Node } from "@veloce/core";
import { type DeckChange, Workspace } from "@veloce/doc-server";
import { startVeloceServer } from "@veloce/server";
import { type Browser, chromium, type Page } from "playwright-core";
import { expect } from "vitest";

const EDITOR_DIST = fileURLToPath(new URL("../../apps/editor/dist", import.meta.url));

/** Why browser tests can't run here, or null. Throws if CI requires them. */
export async function browserProblem(): Promise<string | null> {
  let problem: string | null = null;
  if (!existsSync(join(EDITOR_DIST, "index.html")))
    problem = "editor not built (pnpm build:editor)";
  else {
    try {
      await (await chromium.launch()).close();
    } catch {
      problem = "headless Chromium not installed";
    }
  }
  if (problem && process.env.VELOCE_REQUIRE_BROWSER) {
    throw new Error(`Browser tests required but ${problem}`);
  }
  return problem;
}

export type StoredNode = Node & Record<string, unknown> & { props?: Record<string, unknown> };

export interface EditorHarness {
  page: Page;
  /** Every change the server applied, in order (agent and editor). */
  changes: DeckChange[];
  /** Console errors and uncaught exceptions in the page. */
  pageErrors: string[];
  /** Transactions the editor (origin `user`) has sent so far. */
  userTransactions(): number;
  latestDeck(): Deck;
  /** A node as the server stores it now (first slide unless `slide` is given). */
  stored(id: string, slide?: number): StoredNode;
  /** Children IDs of a stored frame. */
  childIds(id: string, slide?: number): string[];
  /**
   * Wait until the editor has received everything the server stored, and painted it.
   * Waiting on the server alone isn't enough: on a slow machine the editor can still show
   * the old state, and an interaction then acts on it (seen in CI).
   */
  synced(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Builds the deck under test, as an agent would. */
  build(agent: Client): Promise<void>;
  /** A selector that exists once the editor shows the deck. */
  ready: string;
  /** Runs in the page before the editor loads (e.g. to stub browser APIs). */
  initScript?: () => void;
}

function findNode(node: Node, id: string): Node | undefined {
  if (node.id === id) return node;
  if (node.kind !== "frame") return undefined;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

export async function startEditor(options: HarnessOptions): Promise<EditorHarness> {
  const dir = await mkdtemp(join(tmpdir(), "veloce-editor-"));
  const changes: DeckChange[] = [];
  const pageErrors: string[] = [];
  let editorVersion = 0;

  const registry = createBuiltinRegistry();
  const workspace = await Workspace.open({
    dir,
    context: registry.applyContext(),
    autosaveDelayMs: 10,
  });
  workspace.subscribe((event) => {
    if (event.type === "change") changes.push(event.change);
  });
  const app = await startVeloceServer({
    workspace,
    registry,
    editorDir: EDITOR_DIST,
    port: 0,
    log: () => {},
    render: null,
  });

  const agent = new Client({ name: "Claude Code", version: "test" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(app.mcpUrl)));
  await options.build(agent);
  await agent.close();

  const browser: Browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (options.initScript) await page.addInitScript(options.initScript);
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload)) as { type?: string; version?: number };
        if (message.type === "change" || message.type === "snapshot") {
          editorVersion = Math.max(editorVersion, message.version ?? 0);
        }
      } catch {
        // not JSON: ignore
      }
    }),
  );
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  // Stress knob: VELOCE_TEST_CPU_THROTTLE=4 runs the page on a 4x slower CPU, roughly a slow
  // CI runner, to flush out timing assumptions. (Past ~4x, headless Chromium's own pointer
  // lock emulation stalls, even on a blank page.)
  if (process.env.VELOCE_TEST_CPU_THROTTLE) {
    const cdp = await page.context().newCDPSession(page);
    const rate = Number(process.env.VELOCE_TEST_CPU_THROTTLE);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  await page.goto(app.url);
  await page.locator(options.ready).waitFor();

  const latestDeck = (): Deck => {
    const deck = changes.at(-1)?.deck;
    if (!deck) throw new Error("no changes yet");
    return deck;
  };
  const stored = (id: string, slide = 0) => {
    const node = findNode(latestDeck().slides[slide]?.root as Node, id);
    if (!node) throw new Error(`node ${id} not found`);
    return node as StoredNode;
  };

  return {
    page,
    changes,
    pageErrors,
    userTransactions: () => changes.filter((c) => c.origin === "user").length,
    latestDeck,
    stored,
    childIds: (id, slide) => {
      const node = stored(id, slide);
      return node.kind === "frame" ? node.children.map((c) => c.id) : [];
    },
    async synced() {
      const latest = changes.at(-1)?.version ?? 0;
      await expect.poll(() => editorVersion).toBeGreaterThanOrEqual(latest);
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
    },
    async close() {
      await browser.close();
      await app.close();
      await workspace.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
