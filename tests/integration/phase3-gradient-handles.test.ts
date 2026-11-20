/**
 * Phase 3 acceptance (D87): on-canvas gradient handles. With the paint picker open on a
 * gradient, its handles sit on the painted layer (or the slide): turn a linear gradient by
 * its ends, move and add and remove stops on the slide itself, move a radial gradient's
 * center. Every drag is one undo step, Esc cancels one. Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

interface Stop {
  offset: number;
  color: string;
}
interface Gradient {
  type: string;
  angle?: number;
  center?: { x: number; y: number };
  start?: number;
  end?: number;
  radius?: { x: number; y: number };
  stops: Stop[];
}

/** A 600×300 shape with a left-to-right gradient, on a slide with a radial background. */
async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Handles", theme: "midnight" } });
  const result = await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        background: {
          type: "radial-gradient",
          center: { x: 0.5, y: 0.5 },
          stops: [
            { offset: 0, color: "$color.primary" },
            { offset: 1, color: "$color.background" },
          ],
        },
        children: [
          {
            id: "glow",
            type: "shape",
            width: 600,
            height: 300,
            props: {
              shape: "rect",
              fill: {
                type: "linear-gradient",
                angle: 90,
                stops: [
                  { offset: 0, color: "$color.primary" },
                  { offset: 1, color: "$color.accent" },
                ],
              },
            },
          },
        ],
      },
    },
  });
  if (result.isError) throw new Error(JSON.stringify(result.content));
}

const fill = () => h.stored("glow").props?.fill as Gradient;
const handles = () => page.getByTestId("gradient-handles");

async function centerOf(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not visible");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Run `act`; expect exactly one transaction from it (one undo step). */
async function oneStep(act: () => Promise<void>) {
  const before = h.userTransactions();
  await act();
  await expect.poll(() => h.userTransactions()).toBe(before + 1);
  await h.synced();
  await page.waitForTimeout(50); // the picker renders the new value, the handles follow
}

async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function openPicker(field: string) {
  await page.getByRole("button", { name: `${field}: color picker` }).click();
  await page.getByRole("dialog", { name: "Color picker" }).waitFor();
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='glow']" });
  page = h.page;
  await page.locator(".editor-canvas [data-node-id='glow']").click();
  await openPicker("Fill");
  await handles().waitFor();
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe.skipIf(problem)("on-canvas gradient handles (D87)", { timeout: 60_000 }, () => {
  it("sit on the painted layer while the picker edits its gradient, instead of its resize handles", async () => {
    const shape = await page.locator(".editor-canvas [data-node-id='glow']").boundingBox();
    if (!shape) throw new Error("shape");
    // 90°: the line runs across the middle, left edge to right edge.
    const start = await centerOf(handles().locator('[data-gradient="start"]'));
    const end = await centerOf(handles().locator('[data-gradient="end"]'));
    expect(Math.abs(start.x - shape.x)).toBeLessThan(1.5);
    expect(Math.abs(end.x - (shape.x + shape.width))).toBeLessThan(1.5);
    expect(Math.abs(start.y - (shape.y + shape.height / 2))).toBeLessThan(1.5);
    expect(await handles().locator(".gradient-stop").count()).toBe(2);
    expect(await page.locator("[data-handle]").count()).toBe(0);
  });

  it("turns a linear gradient by dragging its end (one step), and undo turns it back", async () => {
    const end = await centerOf(handles().locator('[data-gradient="end"]'));
    const start = await centerOf(handles().locator('[data-gradient="start"]'));
    const mid = { x: (start.x + end.x) / 2, y: start.y };
    await oneStep(() => drag(end, { x: mid.x, y: mid.y + 100 }));
    expect(fill()).toMatchObject({ type: "linear-gradient", angle: 180 });
    expect(fill().stops).toHaveLength(2);
    expect(h.changes.at(-1)?.label).toMatch(/fill/i);
    await oneStep(() => page.keyboard.press("Control+z"));
    expect(fill().angle).toBe(90);
  });

  it("moves a stop along the line and selects it in the picker", async () => {
    const start = await centerOf(handles().locator('[data-gradient="start"]'));
    const end = await centerOf(handles().locator('[data-gradient="end"]'));
    const chip = await centerOf(handles().locator('[data-stop="1"]'));
    // To three quarters of the way, keeping the chip's distance from the line.
    const to = { x: start.x + (end.x - start.x) * 0.75, y: chip.y };
    await oneStep(() => drag(chip, to));
    expect(fill().stops[1]?.offset).toBeCloseTo(0.75, 2);
    expect(fill().stops[1]?.color).toBe("$color.accent");
    expect(await handles().locator('[data-stop="1"]').getAttribute("data-selected")).not.toBeNull();
    expect(await page.getByLabel("Fill stop position", { exact: true }).inputValue()).toBe("75");
  });

  it("adds a stop with a click on the line, and removes one dragged away from it", async () => {
    const start = await centerOf(handles().locator('[data-gradient="start"]'));
    const end = await centerOf(handles().locator('[data-gradient="end"]'));
    await oneStep(() => page.mouse.click(start.x + (end.x - start.x) * 0.25, start.y));
    expect(fill().stops).toHaveLength(3);
    expect(fill().stops[1]?.offset).toBeCloseTo(0.25, 2);

    const chip = await centerOf(handles().locator('[data-stop="1"]'));
    await oneStep(() => drag(chip, { x: chip.x, y: chip.y - 120 }));
    expect(fill().stops.map((s) => s.offset)).toEqual([0, 0.75]);
  });

  it("Delete removes the selected stop, never the layer (D88)", async () => {
    const start = await centerOf(handles().locator('[data-gradient="start"]'));
    const end = await centerOf(handles().locator('[data-gradient="end"]'));
    await oneStep(() => page.mouse.click(start.x + (end.x - start.x) * 0.5, start.y));
    expect(fill().stops).toHaveLength(3);
    await oneStep(() => page.keyboard.press("Delete"));
    expect(fill().stops.map((s) => s.offset)).toEqual([0, 0.75]);
    // Two left: nothing to remove, and the layer stays.
    const before = h.userTransactions();
    await page.keyboard.press("Backspace");
    await expect.poll(() => page.getByText("A gradient needs at least two stops").count()).toBe(1);
    expect(h.userTransactions()).toBe(before);
    expect(h.stored("glow")).toBeDefined();
  });

  it("slides a linear gradient's end along its line: a shorter ramp (D88)", async () => {
    const start = await centerOf(handles().locator('[data-gradient="start"]'));
    const end = await centerOf(handles().locator('[data-gradient="end"]'));
    await oneStep(() => drag(end, { x: start.x + (end.x - start.x) * 0.75, y: end.y }));
    expect(fill()).toMatchObject({ angle: 90, start: 0 });
    expect(fill().end).toBeCloseTo(0.75, 2);
    // The knob stayed under the pointer.
    const moved = await centerOf(handles().locator('[data-gradient="end"]'));
    expect(Math.abs(moved.x - (start.x + (end.x - start.x) * 0.75))).toBeLessThan(2);
    await oneStep(() => page.keyboard.press("Control+z"));
  });

  it("Esc cancels a drag: nothing changes", async () => {
    const before = h.userTransactions();
    const end = await centerOf(handles().locator('[data-gradient="end"]'));
    await page.mouse.move(end.x, end.y);
    await page.mouse.down();
    await page.mouse.move(end.x - 50, end.y + 120, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(h.userTransactions()).toBe(before);
    expect(fill().angle).toBe(90);
    // The picker stays open: Esc went to the drag.
    expect(await page.getByRole("dialog", { name: "Color picker" }).count()).toBe(1);
  });

  it("go away when the picker closes", async () => {
    await page.keyboard.press("Escape");
    await expect.poll(() => handles().count()).toBe(0);
    await expect.poll(() => page.locator("[data-handle]").count()).toBeGreaterThan(0);
  });

  it("move a radial background's center on the slide", async () => {
    await page.keyboard.press("Escape"); // nothing selected: the slide's own section
    await openPicker("Background");
    await handles().waitFor();
    const slide = await page.locator(".editor-canvas .slide-surface").boundingBox();
    if (!slide) throw new Error("slide");
    const knob = await centerOf(handles().locator('[data-gradient="center"]'));
    expect(Math.abs(knob.x - (slide.x + slide.width / 2))).toBeLessThan(1.5);
    // Off the slide's left edge: centers aren't kept inside (D88).
    const to = { x: slide.x - slide.width * 0.05, y: slide.y + slide.height * 0.25 };
    await oneStep(() => drag(knob, to));
    let background = h.latestDeck().slides[0]?.background as Gradient;
    expect(background.center?.x).toBeCloseTo(-0.05, 2);
    expect(background.center?.y).toBeCloseTo(0.25, 2);
    // Moving it kept the size it showed before (half the slide each way), now pinned.
    expect(background.radius).toEqual({ x: 0.5, y: 0.5 });

    // The horizontal size knob, pulled in to 40% of the slide's width.
    const sizeKnob = await centerOf(handles().locator('[data-gradient="radius-x"]'));
    const center = await centerOf(handles().locator('[data-gradient="center"]'));
    await oneStep(() => drag(sizeKnob, { x: center.x + slide.width * 0.4, y: sizeKnob.y }));
    background = h.latestDeck().slides[0]?.background as typeof background;
    expect(background.radius?.x).toBeCloseTo(0.4, 2);
    expect(background.radius?.y).toBe(0.5); // unchanged (no Shift)
    // Chromium reports the sized ellipse the way the contrast lint parses it.
    const css = await page
      .locator(".editor-canvas .slide-surface")
      .evaluate((root) =>
        [root, ...root.querySelectorAll("*")]
          .map((el) => getComputedStyle(el).backgroundImage)
          .find((image) => image.startsWith("radial-gradient")),
      );
    expect(css).toMatch(/^radial-gradient\(40% 50% at -5% 25%, /);
  });

  it("raised no page errors", () => {
    expect(h.pageErrors).toEqual([]);
  });
});
