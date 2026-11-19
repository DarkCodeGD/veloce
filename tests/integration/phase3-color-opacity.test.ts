/**
 * Phase 3 acceptance (round 4): theme colors at an opacity, `"$color.primary/30"`. An agent
 * writes one, the renderer paints it as the theme color at that opacity (and keeps following
 * theme switches), and the inspector's Opacity box edits it while
 * swatches keep it. Driven in real Chromium against the real server.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { parseCssColor } from "@veloce/core";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem, type EditorHarness, startEditor } from "./editor-harness.js";

const problem = await browserProblem();
let h: EditorHarness;
let page: Page;
/** What the agent read back after building the slide (lint included). */
let buildResult = "";

async function build(agent: Client) {
  await agent.callTool({ name: "create_deck", arguments: { title: "Glow", theme: "midnight" } });
  const result = await agent.callTool({
    name: "upsert_slide",
    arguments: {
      slide: {
        id: "s1",
        children: [
          { id: "title", type: "text", props: { content: "Glass and glow", style: "$text.h1" } },
          {
            id: "glow",
            type: "shape",
            width: 400,
            height: 120,
            props: { shape: "rect", fill: "$color.primary/30" },
          },
          { id: "faint", type: "text", props: { content: "Whisper", color: "$color.text/15" } },
          { id: "strong", type: "text", props: { content: "Speak", color: "$color.text/90" } },
        ],
      },
    },
  });
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  buildResult = content.map((c) => c.text ?? "").join("\n");
}

const canvasNode = (id: string) => page.locator(`.editor-canvas [data-node-id='${id}']`);

/** The glow shape's painted background color, as [r, g, b, a] (0–255, alpha 0–1). */
async function glowPaint() {
  const css = await canvasNode("glow").evaluate((root) => {
    for (const el of [root, ...root.querySelectorAll("*")]) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg !== "rgba(0, 0, 0, 0)") return bg;
    }
    return "";
  });
  return parseCssColor(css);
}

/** A theme color at an opacity, to compare a painted color against (channels rounded). */
function expected(hex: string, opacity: number) {
  const [r, g, b] = parseCssColor(hex) ?? [0, 0, 0];
  return [Math.round(r), Math.round(g), Math.round(b), opacity];
}
const rounded = (c: readonly number[] | null) =>
  c ? [Math.round(c[0] ?? 0), Math.round(c[1] ?? 0), Math.round(c[2] ?? 0), c[3]] : null;

beforeAll(async () => {
  if (problem) return;
  h = await startEditor({ build, ready: ".editor-canvas [data-node-id='glow']" });
  page = h.page;
}, 60_000);

afterAll(async () => {
  if (!problem) await h?.close();
});

describe.skipIf(problem !== null)("Phase 3: colors at an opacity", { timeout: 60_000 }, () => {
  it("an agent writes one without lint errors", () => {
    // Contrast for these is measured in phase2.test.ts (it needs the render service).
    expect(buildResult).toMatch(/Lint: no issues/);
  });

  it("paints the theme color at that opacity, and follows a theme switch", async () => {
    const primary = () => h.latestDeck().theme.colors.primary ?? "";
    await expect.poll(async () => rounded(await glowPaint())).toEqual(expected(primary(), 0.3));

    await page.keyboard.press("Escape");
    const before = primary();
    await page.locator(".theme-card", { hasText: "Paper" }).click();
    await expect.poll(() => h.latestDeck().theme.name).toBe("Paper");
    expect(primary()).not.toBe(before);
    await h.synced();
    await expect.poll(async () => rounded(await glowPaint())).toEqual(expected(primary(), 0.3));
  });

  it("edits the opacity in the inspector; a new color keeps it", async () => {
    await canvasNode("glow").click();
    const opacity = page.getByLabel("Fill opacity");
    await expect.poll(() => opacity.inputValue()).toBe("30");

    await opacity.fill("60");
    await opacity.press("Enter");
    await expect.poll(() => h.stored("glow").props?.fill).toBe("$color.primary/60");

    // A swatch changes the color, not the opacity; the picked swatch shows as on.
    const accent = page.getByRole("button", { name: "Fill: accent" });
    await accent.click();
    await expect.poll(() => h.stored("glow").props?.fill).toBe("$color.accent/60");
    await expect.poll(() => accent.getAttribute("aria-pressed")).toBe("true");

    // Arrow keys nudge; 100% is the plain token again.
    await opacity.press("ArrowUp");
    await expect.poll(() => h.stored("glow").props?.fill).toBe("$color.accent/61");
    await opacity.fill("100");
    await opacity.press("Enter");
    await expect.poll(() => h.stored("glow").props?.fill).toBe("$color.accent");

    // A typed hex takes the opacity as its alpha byte.
    const hex = page.getByRole("textbox", { name: "Fill", exact: true });
    await hex.fill("#ff3366");
    await hex.press("Enter");
    await expect.poll(() => h.stored("glow").props?.fill).toBe("#ff3366");
    await opacity.fill("50");
    await opacity.press("Enter");
    await expect.poll(() => h.stored("glow").props?.fill).toBe("#ff336680");
    expect(h.pageErrors).toEqual([]);
  });
});
