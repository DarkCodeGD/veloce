/**
 * Phase 3 acceptance (round 6, D97): slide numbers, footers and sections. An agent sets a
 * footer, a section and a slide-number field; the editor draws them and keeps the numbers
 * right when slides move; people set the footer, hide it on a slide, add and collapse
 * sections and insert fields while typing. Real Chromium, real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Quarterly" } });
  const slide = (id: string, extra: Record<string, unknown>, children: unknown[]) =>
    agent.callTool({ name: "upsert_slide", arguments: { slide: { id, ...extra, children } } });
  await slide("s1", {}, [{ id: "head", type: "text", props: { content: "Welcome" } }]);
  await slide("s2", { section: "Results" }, [
    {
      id: "num",
      type: "text",
      props: {
        content: [{ runs: [{ text: "Slide " }, { text: "", field: "slideNumber" }] }],
      },
    },
  ]);
  await slide("s3", {}, [{ id: "tail", type: "text", props: { content: "Thanks" } }]);
  await agent.callTool({
    name: "apply_ops",
    arguments: {
      label: "Footer",
      ops: [{ op: "deck.setFooter", footer: { text: "Acme", slideNumber: true } }],
    },
  });
}

const READY = ".editor-canvas [data-node-id='head']";
const onCanvas = (id: string) => page.locator(`.editor-canvas [data-node-id='${id}']`);
const shown = (id: string) => onCanvas(id).textContent();
const thumbs = () => page.locator(".rail .thumb-row").count();

async function fromMenu(menu: string, command: string) {
  await page.getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menuitem", { name: command }).click();
}

async function goToSlide(n: number) {
  await page
    .getByRole("button", { name: new RegExp(`^Slide ${n}\\b`) })
    .first()
    .click();
  await expect.poll(() => page.locator(".deck-position").textContent()).toMatch(`${n} /`);
}

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: READY });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)(
  "Phase 3: slide numbers, footers and sections",
  { timeout: 60_000 },
  () => {
    it("draws the footer and fields, and keeps the numbers right when slides move", async () => {
      await goToSlide(2);
      await expect.poll(() => shown("num")).toBe("Slide 2");
      expect(await shown("_footer-number")).toBe("2");
      expect(await shown("_footer-text")).toBe("Acme");
      // The footer is drawn over the slide but isn't a layer: clicks go through to the slide.
      expect(await onCanvas("_footer").evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(
        "none",
      );
      // An agent moves another slide: this one's number follows, though it didn't change.
      const open = await h.workspace.get(h.latestDeck().id);
      const moved = open.apply({
        origin: "agent:claude",
        label: "Move the last slide first",
        ops: [{ op: "slide.move", id: "s3", index: 0 }],
      });
      expect(moved.ok).toBe(true);
      await expect.poll(() => shown("num")).toBe("Slide 3");
      await expect.poll(() => shown("_footer-number")).toBe("3");
    });

    it("sets the footer from Insert, and hides it on one slide", async () => {
      await fromMenu("Insert", "Footer and slide numbers…");
      const dialog = page.getByRole("dialog", { name: "Footer and slide numbers" });
      expect(await dialog.getByRole("switch", { name: /^Slide number/ }).isChecked()).toBe(true);
      await dialog.getByRole("switch", { name: /^Date/ }).check();
      await dialog.getByRole("button", { name: "Apply to all slides" }).click();
      await expect
        .poll(() => h.latestDeck().footer)
        .toEqual({
          date: true,
          text: "Acme",
          slideNumber: true,
        });
      await expect.poll(() => shown("_footer-date")).not.toBe("");

      // Controlled by the stored value: it flips once the server applied the change.
      await page.getByRole("switch", { name: "Show footer" }).click();
      await expect.poll(() => onCanvas("_footer").count()).toBe(0);
      const here = h.latestDeck().slides.find((s) => s.id === "s2");
      expect(here?.hideFooter).toBe(true);
    });

    it("adds, collapses and removes sections in the rail", async () => {
      await goToSlide(1);
      await fromMenu("Slide", "Add section…");
      const dialog = page.getByRole("dialog", { name: "Add section" });
      await dialog.getByRole("textbox", { name: "Name" }).fill("Intro");
      await dialog.getByRole("button", { name: "Add" }).click();
      // The deck is s3, s1 | Results: s2 now: Intro takes s3 and s1, up to Results.
      const intro = page.getByRole("button", { name: "Section Intro, 2 slides" });
      await expect.poll(() => intro.count()).toBe(1);
      expect(h.latestDeck().slides[0]?.section).toBe("Intro");

      const before = await thumbs();
      const results = page.getByRole("button", { name: /^Section Results/ });
      await results.click(); // collapse
      await expect.poll(() => results.getAttribute("aria-expanded")).toBe("false");
      expect(await thumbs()).toBe(before - 1); // Results holds s2 only
      await results.click();
      await expect.poll(thumbs).toBe(before);

      await page.locator(".rail-section").first().hover();
      await page.getByRole("button", { name: "Remove section Intro" }).click();
      await expect.poll(() => intro.count()).toBe(0);
      expect(h.latestDeck().slides[0]).not.toHaveProperty("section");
      await page.locator(".toast").last().getByRole("button", { name: "Undo" }).click();
      await expect.poll(() => h.latestDeck().slides[0]?.section).toBe("Intro");
    });

    it("inserts a field while typing, stored as a field run", async () => {
      await goToSlide(1);
      const box = await onCanvas("tail").boundingBox();
      if (!box) throw new Error("no text on the slide");
      const at = { x: box.x + box.width / 4, y: box.y + box.height / 2 };
      await page.mouse.click(at.x, at.y);
      await page.mouse.dblclick(at.x, at.y);
      await expect.poll(() => page.locator(".text-edit-content").count()).toBe(1);
      await page.keyboard.press("End");
      await page.keyboard.type(" · ");
      await page.getByRole("button", { name: "Insert field" }).click();
      await page.getByRole("menuitem", { name: /^Slide count/ }).click();
      await expect
        .poll(() => page.locator(".text-edit-content .text-field").textContent())
        .toBe("3");
      await page.keyboard.press("Escape");
      await expect
        .poll(() => JSON.stringify(h.stored("tail").props?.content))
        .toContain('"field":"slideCount"');
      await expect.poll(() => shown("tail")).toBe("Thanks · 3");
      expect(h.pageErrors).toEqual([]);
    });
  },
);
