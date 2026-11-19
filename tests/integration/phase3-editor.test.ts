/**
 * Phase 3 acceptance (editor controls): scrubbing (including infinite, pointer-locked
 * scrubbing), nudging and typing numbers, toggle
 * switches, tooltips and auto-growing text fields, driven in real Chromium against the real
 * server. The server's change feed is the source of truth: these tests count the
 * transactions it receives (a whole drag must be exactly one) and read the values it stores.
 *
 * Needs the built editor and headless Chromium; skipped locally without them (CI provides
 * both and sets VELOCE_REQUIRE_BROWSER=1).
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

const userTransactions = () => h.userTransactions();
const stored = (id: string) => h.stored(id);
const synced = () => h.synced();

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

/** A field's label, scrolled into view (the inspector scrolls; the mouse needs it on screen). */
async function labelBox(name: string) {
  await label(name).scrollIntoViewIfNeeded();
  return label(name).boundingBox();
}

/** Press on a field's label and drag it `dx` pixels, leaving the button down. */
async function startScrub(name: string, dx: number) {
  const box = await labelBox(name);
  if (!box) throw new Error(`no label ${name}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: Math.max(4, Math.ceil(Math.abs(dx) / 4)) });
  await page.waitForTimeout(80); // one animation frame for the preview
}

/** Let the next scrubs lock the pointer (refused by default; see the init script). */
const allowPointerLock = (allow: boolean) =>
  page.evaluate((allow) => {
    (window as unknown as { __allowPointerLock: boolean }).__allowPointerLock = allow;
  }, allow);

/** Movement while the pointer is locked, delivered the way the browser reports it. */
const lockedMove = (dx: number, dy = 0) =>
  page.evaluate(
    ([dx, dy]) => {
      const el = document.pointerLockElement;
      if (!el) throw new Error("the pointer is not locked");
      const { __pointerId: pointerId } = window as unknown as { __pointerId: number };
      el.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          movementX: dx,
          movementY: dy,
        }),
      );
    },
    [dx, dy] as const,
  );

const virtualCursorX = () =>
  page.locator(".virtual-cursor").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  });

/** An agent builds the deck the "human" edits: a heading and a card holding body text. */
async function build(agent: Client) {
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
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({
    build,
    ready: ".editor-canvas [data-node-id='card']",
    initScript: () => {
      // Headless Chromium emulates pointer lock by snapping its synthetic cursor back after
      // every move (+N, then -N), so real mouse moves can't drive a locked scrub. The lock is
      // refused unless a test allows it, which exercises the fallback path everywhere else;
      // the locked tests feed movement events directly.
      const w = window as unknown as { __allowPointerLock?: boolean; __pointerId?: number };
      const request = Element.prototype.requestPointerLock;
      Element.prototype.requestPointerLock = function (this: Element, options) {
        if (!w.__allowPointerLock) {
          return Promise.reject(new DOMException("disabled in this test", "NotSupportedError"));
        }
        return request.call(this, options);
      };
      addEventListener("pointerdown", (e) => (w.__pointerId = e.pointerId), true);
    },
  });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: editor controls", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await page.mouse.up();
    for (const key of ["Shift", "Alt"]) await page.keyboard.up(key);
    await allowPointerLock(false);
    await synced();
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
    // Lock refused (see the init script): a plain scrub, no virtual cursor.
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    expect(await page.locator(".virtual-cursor").count()).toBe(0);
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
    await synced(); // the next scrub starts from the value the editor shows

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
    await synced();

    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => stored("card").rotation).toBe(start - 5);
    expect(userTransactions()).toBe(before + 2);
  });

  it("typing accepts units, and rejects garbage without sending anything", async () => {
    await select("Card");
    await input("Opacity").fill("45%");
    await input("Opacity").press("Enter");
    await expect.poll(() => stored("card").opacity).toBe(0.45);
    await synced(); // garbage must revert to the value the editor shows

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

  it("locks only at the window edge, then scrubs on with a cursor that wraps around", async () => {
    await allowPointerLock(true);
    await select("Body");
    const before = userTransactions();
    const rendered = Number.parseFloat((await canvasStyle("body", "font-size", true)) ?? "");
    const original = stored("body").props?.fontSize as number | undefined;
    const start = original ?? rendered; // unset: scrubbing starts from the rendered size
    const box = await labelBox("Font size");
    if (!box) throw new Error("no label");
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const edge = 1440 - 8; // inside the right edge zone

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 8, y); // a short scrub…
    await page.waitForTimeout(80);
    expect(await input("Font size").inputValue()).toBe(String(start + 8));
    // …never locks the pointer, so the browser shows no "Press Esc" notice.
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();

    await page.mouse.move(edge, y); // one jump to the edge: now it locks
    await expect
      .poll(() => page.evaluate(() => document.pointerLockElement?.textContent ?? null))
      .toBe("Font size");
    expect(await virtualCursorX()).toBeCloseTo(edge, 0);
    const atEdge = start + (edge - x);
    // Chromium sends a bogus jump as the first event after locking (headless does too): it
    // must not move the value. A zero-movement primer keeps this test independent of
    // whether a given build sends it.
    await lockedMove(0);
    await page.waitForTimeout(40);
    expect(await input("Font size").inputValue()).toBe(String(atEdge));

    for (let i = 0; i < 8; i++) await lockedMove(150, 2); // 1200 px past the right edge
    await lockedMove(5000); // glitch-sized jumps: ignored
    await lockedMove(-301);
    await page.waitForTimeout(80);

    expect(await input("Font size").inputValue()).toBe(String(atEdge + 1200));
    expect(await canvasStyle("body", "font-size", true)).toBe(`${atEdge + 1200}px`); // preview
    expect(await virtualCursorX()).toBeCloseTo((edge + 1200) % 1440, 0); // wrapped around
    expect(userTransactions()).toBe(before);

    await page.mouse.up();
    await expect.poll(userTransactions).toBe(before + 1);
    expect(stored("body").props?.fontSize).toBe(atEdge + 1200);
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    expect(await page.locator(".virtual-cursor").count()).toBe(0);
    await page.keyboard.press("Control+z"); // one undo step puts it back
    await expect.poll(() => stored("body").props?.fontSize).toBe(original);
  });

  it("losing the pointer lock mid-scrub (Esc, switching windows) cancels it", async () => {
    await allowPointerLock(true);
    await select("Card");
    const before = userTransactions();
    const opacity = await canvasStyle("card", "opacity");

    await startScrub("Opacity", -8);
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    const y = (await label("Opacity").boundingBox())?.y ?? 0;
    await page.mouse.move(1440 - 8, y + 5); // reach the edge: locks
    await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
    await lockedMove(0);
    await lockedMove(-20);
    await page.waitForTimeout(80);
    expect(await canvasStyle("card", "opacity")).not.toBe(opacity);

    await page.evaluate(() => document.exitPointerLock()); // what the browser does on Esc
    await expect.poll(() => canvasStyle("card", "opacity")).toBe(opacity);
    expect(await page.locator(".virtual-cursor").count()).toBe(0);
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(userTransactions()).toBe(before);
  });

  it("toggles are switches that work with the pointer and the keyboard", async () => {
    await select("Card");
    const locked = page.getByRole("switch", { name: "Locked" });
    await locked.click();
    await expect.poll(() => stored("card").locked).toBe(true);
    await synced(); // Space toggles what the switch shows; it must show "on" first
    expect(await locked.isChecked()).toBe(true);
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
    expect(h.pageErrors).toEqual([]);
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
