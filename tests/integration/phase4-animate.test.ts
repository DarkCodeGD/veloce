/**
 * Phase 4 acceptance (the Animate workspace, first slice, D118): a person animates a slide
 * without an agent. Switch to Animate, select a layer, rest the pointer on an effect to see
 * it play on the canvas (never an edit), click it to add it, tune it (start, settings),
 * undo, play the slide, and remove it. Text-only effects show only for text. Save a tuned
 * animation as a preset, play it on another layer, update it and delete it (D119). Every
 * change is an ordinary transaction (golden rule 1). Real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Animation } from "@veloce/core";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Moves", theme: "midnight" } });
  await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        layout: { mode: "absolute" },
        children: [
          {
            id: "title",
            type: "text",
            position: { x: 120, y: 100 },
            props: { content: "Quarterly results", style: "$text.h1" },
          },
          {
            id: "box",
            type: "shape",
            width: 300,
            height: 300,
            position: { x: 800, y: 500 },
            props: { shape: "rect", fill: "$color.primary" },
          },
          {
            id: "list",
            layout: { mode: "stack", direction: "column", gap: 16 },
            position: { x: 120, y: 500 },
            children: [
              { id: "one", type: "text", props: { content: "One" } },
              { id: "two", type: "text", props: { content: "Two" } },
            ],
          },
        ],
      },
    },
  });
}

const panel = () => page.locator(".animate-panel");
const animations = (): Animation[] => h.latestDeck().slides[0]?.animations ?? [];
const playingOnCanvas = () => page.locator(".editor-canvas.is-playing").count();
const running = () => page.evaluate(() => document.getAnimations().length);
const selectLayer = async (id: string) => {
  await page.locator(`.editor-canvas [data-node-id="${id}"]`).click({ force: true });
};

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas .slide-surface" });
  page = h.page;
}, 90_000);

afterAll(async () => {
  if (problem) return;
  await h.close();
});

describe.skipIf(problem !== null)(
  "Phase 4: the Animate workspace (D118)",
  { timeout: 60_000 },
  () => {
    it("switches to Animate: the right panel shows the slide's motion", async () => {
      await h.synced();
      await page.getByRole("tab", { name: "Animate" }).click();
      await panel().waitFor();
      await panel().getByText("Nothing moves on this slide yet").waitFor();
      await panel().getByText("Select a layer on the slide to animate it").waitFor();
    });

    it("previews an effect on the canvas while the pointer rests on it, without editing", async () => {
      await selectLayer("box");
      const tile = panel().getByRole("button", { name: "Slide in", exact: true });
      await tile.hover();
      await expect.poll(playingOnCanvas).toBe(1);
      await expect.poll(running).toBeGreaterThan(0); // on the compositor, like presenting
      await page.locator(".animate-panel .inspector-section-title").first().hover(); // away
      await expect.poll(playingOnCanvas).toBe(0);
      await expect.poll(running).toBe(0);
      expect(h.userTransactions()).toBe(0);
    });

    it("offers text effects only for text", async () => {
      expect(await panel().getByRole("button", { name: "Typewriter" }).count()).toBe(0);
      await selectLayer("title");
      await panel().getByRole("button", { name: "Typewriter" }).waitFor();
      await selectLayer("box");
    });

    it("adds an effect with a click, on a click step, shown in the steps list", async () => {
      await panel().getByRole("button", { name: "Slide in", exact: true }).click();
      await expect
        .poll(() => animations().map((a) => [a.target, a.effect?.name]))
        .toEqual([["box", "slide-in"]]);
      expect(h.userTransactions()).toBe(1);
      await panel().getByRole("heading", { name: "Click 1" }).waitFor();
      await panel().locator(".animate-row.is-selected", { hasText: "Slide in" }).waitFor();
    });

    it("tunes it: the start and the effect's own settings, each one undo step", async () => {
      await panel().getByRole("combobox", { name: "Start" }).click();
      await page.getByRole("option", { name: "With previous" }).click();
      await expect.poll(() => animations()[0]?.trigger).toBe("withPrevious");
      await panel().getByRole("heading", { name: "As the slide appears" }).waitFor();

      await panel().getByRole("combobox", { name: "Direction" }).click();
      await page.getByRole("option", { name: "Left" }).click();
      await expect.poll(() => animations()[0]?.effect?.params).toEqual({ direction: "left" });

      await page.keyboard.press("Control+z");
      await expect.poll(() => animations()[0]?.effect?.params).toBeUndefined();
      expect(animations()[0]?.trigger).toBe("withPrevious"); // only the last change undone
    });

    it("plays the slide on the canvas, then goes back to rest by itself", async () => {
      const before = h.userTransactions();
      await panel().getByRole("button", { name: "Play" }).click();
      await expect.poll(playingOnCanvas).toBe(1);
      await expect.poll(running).toBeGreaterThan(0);
      await expect.poll(playingOnCanvas, { timeout: 5000 }).toBe(0);
      expect(h.userTransactions()).toBe(before);
    });

    it("removes it from the steps list with Delete, keeping the layer", async () => {
      await panel().locator(".animate-row", { hasText: "Slide in" }).click();
      await page.keyboard.press("Delete");
      await expect.poll(() => animations().length).toBe(0);
      expect(h.stored("box")).toBeDefined();
      await panel().getByText("Nothing moves on this slide yet").waitFor();
    });

    // ── Saved presets (D119) ─────────────────────────────────────────────────────────

    const presets = () => h.latestDeck().presets;
    const tile = (name: string) => panel().locator(".effect-tile", { hasText: name });

    it("saves a tuned animation as a preset, which it then plays by name (D119)", async () => {
      await selectLayer("box");
      await panel().getByRole("button", { name: "Slide in", exact: true }).click();
      await panel().getByRole("combobox", { name: "Direction" }).click();
      await page.getByRole("option", { name: "Left" }).click();
      await expect.poll(() => animations()[0]?.effect?.params).toEqual({ direction: "left" });

      await panel().getByRole("button", { name: "Save as preset…" }).click();
      const dialog = page.getByRole("dialog", { name: "Save as preset" });
      await dialog.getByLabel("Name").fill("Swoop");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect.poll(presets).toEqual({
        swoop: { title: "Swoop", effect: { name: "slide-in", params: { direction: "left" } } },
      });
      expect(animations()[0]?.effect).toEqual({ name: "swoop" });
      await panel().locator(".animate-row", { hasText: "Swoop" }).waitFor();
      await panel().getByRole("heading", { name: "Saved" }).waitFor();
    });

    it("adds the preset to another layer from the Saved group", async () => {
      await selectLayer("title");
      await tile("Swoop").click();
      await expect
        .poll(() => animations().map((a) => [a.target, a.effect?.name]))
        .toEqual([
          ["box", "swoop"],
          ["title", "swoop"],
        ]);
    });

    it("updates the preset from one animation's changes, for both", async () => {
      await panel().getByRole("combobox", { name: "Direction" }).click();
      await page.getByRole("option", { name: "Right" }).click();
      await expect.poll(() => animations()[1]?.effect?.params).toEqual({ direction: "right" });
      await panel().getByRole("button", { name: "Update preset" }).click();
      await expect.poll(() => presets()?.swoop?.effect?.params).toEqual({ direction: "right" });
      expect(animations()[1]?.effect).toEqual({ name: "swoop" });
      await expect
        .poll(() => panel().getByRole("button", { name: "Update preset" }).count())
        .toBe(0);
    });

    it("deletes the preset, its animations moving as before; Undo brings it back", async () => {
      await tile("Swoop").hover();
      await panel().getByRole("button", { name: "Delete preset Swoop" }).click();
      await expect.poll(presets).toBeUndefined();
      expect(animations().map((a) => a.effect)).toEqual([
        { name: "slide-in", params: { direction: "right" } },
        { name: "slide-in", params: { direction: "right" } },
      ]);
      await page.keyboard.press("Control+z");
      await expect.poll(() => presets()?.swoop?.title).toBe("Swoop");
      expect(animations().map((a) => a.effect?.name)).toEqual(["swoop", "swoop"]);
      expect(h.pageErrors).toEqual([]);
    });

    // ── Layout (D120) ────────────────────────────────────────────────────────────────

    it("plays a stack's animation on its items one by one (D120)", async () => {
      await selectLayer("list");
      await panel().getByRole("button", { name: "Fade in", exact: true }).click();
      await expect.poll(() => animations().at(-1)?.target).toBe("list");
      await panel().getByRole("combobox", { name: "Children" }).click();
      await page.getByRole("option", { name: "One by one", exact: true }).click();
      await expect.poll(() => animations().at(-1)?.stagger).toEqual({});
      await panel().locator(".animate-row", { hasText: "one by one" }).waitFor();
      await panel().getByRole("spinbutton", { name: "Gap" }).waitFor();
    });

    it("makes an item make room as it comes in, as one undo step", async () => {
      await page.locator('.editor-canvas [data-node-id="two"]').dblclick({ force: true });
      await panel().getByRole("button", { name: "Fade in", exact: true }).click();
      await expect.poll(() => animations().at(-1)?.target).toBe("two");
      await panel().getByRole("switch", { name: "Make room" }).click();
      await expect.poll(() => animations().at(-1)?.space).toBe("makeRoom");
      await panel().getByText("It's out of the layout until it comes in").waitFor();
      await page.keyboard.press("Control+z");
      await expect.poll(() => animations().at(-1)?.space).toBeUndefined();
      expect(h.pageErrors).toEqual([]);
    });

    // ── Animate this slide (D121) ─────────────────────────────────────────────────────

    it("animates the whole slide in one click, and undoes it in one step", async () => {
      const before = animations().length;
      await page.keyboard.press("Escape");
      await panel().getByRole("combobox", { name: "Pacing" }).click();
      await page.getByRole("option", { name: "Build", exact: true }).click();
      await panel().getByText("one point per click").waitFor();
      await panel().getByRole("button", { name: "Replace animations" }).click();
      await page.getByText(/Animated the slide: \d+ layers move/).waitFor();
      await expect.poll(() => animations().some((a) => a.stagger !== undefined)).toBe(false);
      await expect.poll(() => animations().length).toBeGreaterThan(0);
      expect(animations().every((a) => a.id.startsWith("an"))).toBe(true);
      await page.keyboard.press("Control+z");
      await expect.poll(() => animations().length).toBe(before);
      expect(h.pageErrors).toEqual([]);
    });

    it("animates every slide in one click, keeping the ones already animated", async () => {
      const slides = () => h.latestDeck().slides;
      const before = slides().map((s) => s.animations?.length ?? 0);
      await panel().getByRole("button", { name: "Animate whole deck" }).click();
      // Every slide here is animated already, so with "keep" on there's nothing to do.
      if (before.every((n) => n > 0)) {
        await page.getByText("Every slide already has animations").waitFor();
        await panel().getByRole("switch", { name: "Keep animated slides" }).click();
        await panel().getByRole("button", { name: "Animate whole deck" }).click();
      }
      await page.getByText(/^Animated \d+ slides?/).waitFor();
      await expect.poll(() => slides().every((s) => (s.animations?.length ?? 0) > 0)).toBe(true);
      await page.keyboard.press("Control+z");
      await expect.poll(() => slides().map((s) => s.animations?.length ?? 0)).toEqual(before);
      expect(h.pageErrors).toEqual([]);
    });

    it("goes back to Design with the inspector as it was", async () => {
      await page.getByRole("tab", { name: "Design" }).click();
      await expect.poll(() => panel().count()).toBe(0);
      await page.locator(".inspector-panel .inspector").waitFor();
      expect(h.pageErrors).toEqual([]);
    });
  },
);
