/**
 * Phase 3 acceptance (editor controls): scrubbing, nudging and typing numbers, toggle
 * switches, tooltips and auto-growing text fields, driven in real Chromium against the real
 * server. The server's change feed is the source of truth: these tests count the
 * transactions it receives (a whole drag must be exactly one) and read the values it stores.
 *
 * Needs the built editor and headless Chromium; skipped locally without them (CI provides
 * both and sets VELOCE_REQUIRE_BROWSER=1).
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
import { startVeloceServer, type VeloceServer } from "@veloce/server";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const EDITOR_DIST = fileURLToPath(new URL("../../apps/editor/dist", import.meta.url));

async function browserProblem(): Promise<string | null> {
  if (!existsSync(join(EDITOR_DIST, "index.html"))) return "editor not built (pnpm build:editor)";
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
let browser: Browser;
let page: Page;
const changes: DeckChange[] = [];
const pageErrors: string[] = [];

/** Transactions the editor (origin `user`) has sent so far. */
const userTransactions = () => changes.filter((c) => c.origin === "user").length;
const latestDeck = (): Deck => {
  const deck = changes.at(-1)?.deck;
  if (!deck) throw new Error("no changes yet");
  return deck;
};
function findNode(node: Node, id: string): Node | undefined {
  if (node.id === id) return node;
  if (node.kind !== "frame") return undefined;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}
const stored = (id: string) => {
  const node = findNode(latestDeck().slides[0]?.root as Node, id);
  if (!node) throw new Error(`node ${id} not found`);
  return node as Node & Record<string, unknown> & { props?: Record<string, unknown> };
};

const canvasStyle = (id: string, property: string, child = false) =>
  page.evaluate(
    ([id, property, child]) => {
      const node = document.querySelector(`.editor-canvas [data-node-id="${id}"]`);
      const el = child ? node?.firstElementChild : node;
      return el ? getComputedStyle(el).getPropertyValue(property) : null;
    },
    [id, property, child] as const,
  );
const label = (name: string) =>
  page.locator(".inspector label.field-label", { hasText: new RegExp(`^${name}$`) });
const input = (name: string) => page.getByRole("spinbutton", { name, exact: true });

async function select(layer: string) {
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByRole("button", { name: layer, exact: true }).click();
  await expect.poll(() => page.locator(".inspector-head strong").textContent()).toBe(layer);
}

/** Press on a field's label and drag it `dx` pixels, leaving the button down. */
async function startScrub(name: string, dx: number) {
  const box = await label(name).boundingBox();
  if (!box) throw new Error(`no label ${name}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: Math.max(4, Math.ceil(Math.abs(dx) / 4)) });
  await page.waitForTimeout(80); // one animation frame for the preview
}

beforeAll(async () => {
  if (problem) return;
  dir = await mkdtemp(join(tmpdir(), "veloce-phase3-"));
  const registry = createBuiltinRegistry();
  workspace = await Workspace.open({ dir, context: registry.applyContext(), autosaveDelayMs: 10 });
  workspace.subscribe((event) => {
    if (event.type === "change") changes.push(event.change);
  });
  app = await startVeloceServer({
    workspace,
    registry,
    editorDir: EDITOR_DIST,
    port: 0,
    log: () => {},
    render: null,
  });

  // An agent builds the deck the "human" edits: a heading and a card holding body text.
  const agent = new Client({ name: "Claude Code", version: "test" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(app.mcpUrl)));
  const text = (id: string, name: string, content: string, style: string) => ({
    id,
    name,
    type: "text",
    props: { content, style },
  });
  await agent.callTool({
    name: "create_deck",
    arguments: { title: "Controls", theme: "midnight" },
  });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "stack", padding: "$space.xl", gap: "$space.md" },
        children: [
          text("headline", "Headline", "Scrub me", "$text.h1"),
          {
            id: "card",
            name: "Card",
            layout: { mode: "stack", padding: "$space.md" },
            style: { fill: "$color.surface", radius: "$radius.md" },
            children: [text("body", "Body", "Body copy", "$text.body")],
          },
        ],
      },
    },
  });
  await agent.close();

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  await page.goto(app.url);
  await page.locator(".editor-canvas [data-node-id='card']").waitFor();
}, 60_000);

afterAll(async () => {
  if (problem) return;
  await browser?.close();
  await app?.close();
  await workspace?.close();
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(problem !== null)("Phase 3: editor controls", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await page.mouse.up();
    for (const key of ["Shift", "Alt"]) await page.keyboard.up(key);
  });

  it("has no browser-default controls left", async () => {
    expect(await page.locator("select").count()).toBe(0);
    expect(await page.locator("input[type=number]").count()).toBe(0);
    expect(await page.locator("[title]").count()).toBe(0);
    await select("Card");
    expect(await page.locator("select, input[type=number], [title]").count()).toBe(0);
  });

  it("scrubbing previews live on the canvas and commits one transaction on release", async () => {
    await select("Card");
    const before = userTransactions();

    await startScrub("Opacity", -30); // unset = 100% → 70%
    expect(await input("Opacity").inputValue()).toBe("70");
    expect(await canvasStyle("card", "opacity")).toBe("0.7");
    expect(userTransactions()).toBe(before); // nothing sent mid-drag

    await page.mouse.up();
    await expect.poll(userTransactions).toBe(before + 1);
    expect(stored("card").opacity).toBe(0.7);
    expect(await canvasStyle("card", "opacity")).toBe("0.7"); // no flash back

    // The whole drag is one undo step.
    await page.keyboard.press("Control+z");
    await expect.poll(() => canvasStyle("card", "opacity")).toBe("1");
    expect(stored("card").opacity).toBeUndefined();
  });

  it("Esc cancels a scrub without sending anything or leaving the layer", async () => {
    await select("Card");
    const before = userTransactions();
    await startScrub("Opacity", -50);
    expect(await canvasStyle("card", "opacity")).toBe("0.5");

    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await canvasStyle("card", "opacity")).toBe("1");
    expect(await input("Opacity").inputValue()).toBe("");
    expect(userTransactions()).toBe(before);
    expect(await page.locator(".inspector-head strong").textContent()).toBe("Card");
  });

  it("Shift scrubs 10x faster and Alt 10x finer", async () => {
    await select("Card");
    await page.keyboard.down("Shift");
    await startScrub("Rotation", 6);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect.poll(() => stored("card").rotation).toBe(60);

    await page.keyboard.down("Alt");
    await startScrub("Rotation", 5);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => stored("card").rotation).toBe(60.5);
  });

  it("arrow keys nudge with a live preview and commit once when the key is released", async () => {
    await select("Card");
    await input("Rotation").click();
    const before = userTransactions();
    const start = stored("card").rotation as number;

    for (let i = 0; i < 5; i++) await page.keyboard.down("ArrowUp"); // held: auto-repeat
    expect(await input("Rotation").inputValue()).toBe(String(start + 5));
    expect(userTransactions()).toBe(before);
    await page.keyboard.up("ArrowUp");
    await expect.poll(userTransactions).toBe(before + 1);
    expect(stored("card").rotation).toBe(start + 5);

    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => stored("card").rotation).toBe(start - 5);
    expect(userTransactions()).toBe(before + 2);
  });

  it("typing accepts units, and rejects garbage without sending anything", async () => {
    await select("Card");
    await input("Opacity").fill("45%");
    await input("Opacity").press("Enter");
    await expect.poll(() => stored("card").opacity).toBe(0.45);

    const before = userTransactions();
    await input("Opacity").fill("abc");
    await input("Opacity").press("Enter");
    expect(await input("Opacity").inputValue()).toBe("45");
    await page.waitForTimeout(100);
    expect(userTransactions()).toBe(before);
  });

  it("a plain click on the label still focuses the field", async () => {
    await select("Card");
    const before = userTransactions();
    await label("Rotation").click();
    expect(await input("Rotation").evaluate((el) => el === document.activeElement)).toBe(true);
    expect(userTransactions()).toBe(before);
  });

  it("an unset plugin number scrubs from the value you see (the text style's size)", async () => {
    await select("Body");
    const rendered = Number.parseFloat((await canvasStyle("body", "font-size", true)) ?? "");
    expect(rendered).toBeGreaterThan(8);
    await startScrub("Font size", 10);
    await page.mouse.up();
    await expect.poll(() => stored("body").props?.fontSize).toBe(rendered + 10);
  });

  it("toggles are switches that work with the pointer and the keyboard", async () => {
    await select("Card");
    const locked = page.getByRole("switch", { name: "Locked" });
    await locked.click();
    await expect.poll(() => stored("card").locked).toBe(true);
    await locked.press("Space");
    await expect.poll(() => stored("card").locked).toBeUndefined();
  });

  it("tooltips show after a short delay on hover, at once on keyboard focus, with shortcuts", async () => {
    const undo = page.getByRole("button", { name: "Undo" });
    const tooltip = page.locator(".tooltip");
    await undo.hover();
    await page.waitForTimeout(150);
    expect(await tooltip.count()).toBe(0); // not instantly: no flicker while moving around
    await expect(tooltip).toBeVisibleSoon();
    expect(await tooltip.locator("span").first().textContent()).toBe("Undo");
    expect(await tooltip.locator("kbd").allTextContents()).toEqual(["Ctrl", "Z"]);
    expect(await undo.getAttribute("aria-keyshortcuts")).toBe("Control+Z");

    await page.mouse.move(700, 450);
    await expect.poll(() => tooltip.count()).toBe(0);

    await page.waitForTimeout(500); // let the "warm" window pass
    await page.getByRole("button", { name: "Redo" }).focus();
    await page.keyboard.press("Shift+Tab"); // keyboard focus → :focus-visible
    await expect.poll(() => tooltip.locator("span").first().textContent()).toBe("Undo");
    await page.keyboard.press("Escape");
    await expect.poll(() => tooltip.count()).toBe(0);
  });

  it("speaker notes grow with their text instead of showing a resize grip", async () => {
    const notes = page.getByLabel("Speaker notes");
    const height = async () => (await notes.boundingBox())?.height ?? 0;
    const empty = await height();
    await notes.fill("One\nTwo\nThree\nFour\nFive");
    await expect.poll(height).toBeGreaterThan(empty + 40);
    expect(await notes.evaluate((el) => getComputedStyle(el).resize)).toBe("none");
  });

  it("logged no errors in the page", () => {
    expect(pageErrors).toEqual([]);
  });
});

// A tiny matcher so visibility waits read naturally above.
expect.extend({
  async toBeVisibleSoon(locator: { isVisible(): Promise<boolean> }) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (await locator.isVisible()) return { pass: true, message: () => "visible" };
      await new Promise((r) => setTimeout(r, 50));
    }
    return { pass: false, message: () => "expected the element to become visible within 2s" };
  },
});
declare module "vitest" {
  interface Assertion {
    toBeVisibleSoon(): Promise<void>;
  }
}
