/**
 * Visual regression: reference decks rendered by the real render worker (the page agents'
 * previews use, same renderer and plugins as the editor) and compared pixel by pixel with
 * stored screenshots, so renderer work can't silently move a pixel in existing decks.
 *
 * - Reference decks: `decks/<name>.json` (a deck as stored, any format version) and the
 *   asset files it uses in `decks/assets/`. They load like a file on disk does: migrated,
 *   validated, packed into a `.veloce` file and opened by the workspace. Treat them as
 *   existing users' decks: don't edit them to make a test pass; add a new deck or slide.
 * - Baselines: `screenshots/<deck>--<slide>.png`, at the stage's full size (1 stage pixel =
 *   1 image pixel). A mismatch writes the actual image and a diff to `.output/` (CI uploads
 *   it). After a deliberate visual change, review the diffs, then update the baselines:
 *   `pnpm test:visual:update`.
 * - Avoid what changes by itself: the `date` field and the footer's date show today.
 * - `motion.json` (format v3, D113) animates: every trigger, `$motion` tokens, springs, 2.5D.
 *   Its slides are drawn at rest, and also at `MOMENTS` in the middle of their animations,
 *   seeked by the clock like an export (`<deck>--<slide>@<step>-<ms>.png`, D115).
 *
 * Needs the built editor (`pnpm build:editor`) and headless Chromium, like the other
 * browser tests: skipped locally without them, required in CI (VELOCE_REQUIRE_BROWSER=1).
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuiltinRegistry } from "@veloce/builtins";
import { type Deck, sha256Hex, validateDeck } from "@veloce/core";
import { Workspace } from "@veloce/doc-server";
import { migrateDocument, type RawDocument, writeVeloce } from "@veloce/format";
import { PlaywrightRenderService, startVeloceServer, type VeloceServer } from "@veloce/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserProblem } from "../integration/editor-harness.js";
import { compareScreenshots } from "./compare.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DECKS = join(HERE, "decks");
const SCREENSHOTS = join(HERE, "screenshots");
const OUTPUT = join(HERE, ".output");
const EDITOR_DIST = fileURLToPath(new URL("../../apps/editor/dist", import.meta.url));

/** `pnpm test:visual:update` runs Vitest with `--mode update`: write baselines, don't compare. */
const UPDATE = (import.meta as { env?: { MODE?: string } }).env?.MODE === "update";

const problem = await browserProblem();

/** A reference deck file, loaded the way a `.veloce` file's document is (migrated, validated). */
async function loadReferenceDeck(file: string, registry = createBuiltinRegistry()) {
  const raw = JSON.parse(await readFile(join(DECKS, file), "utf8")) as RawDocument;
  const migrated = migrateDocument(raw, Number(raw.formatVersion));
  const validation = validateDeck(migrated, registry.applyContext());
  if (!validation.ok) {
    throw new Error(`${file} isn't a valid deck: ${validation.errors[0]?.message}`);
  }
  const { deck } = validation;
  const assets = new Map<string, Uint8Array>();
  for (const id of Object.keys(deck.assets)) {
    const hash = id.replace(/^asset:/, "");
    const name = (await readdir(join(DECKS, "assets"))).find((f) => f.startsWith(`${hash}.`));
    if (!name) throw new Error(`${file} uses ${id}, but decks/assets/ has no file for it`);
    const bytes = new Uint8Array(await readFile(join(DECKS, "assets", name)));
    if ((await sha256Hex(bytes)) !== hash)
      throw new Error(`decks/assets/${name} doesn't match its hash`);
    assets.set(id, bytes);
  }
  return { deck, assets };
}

const deckFiles = (await readdir(DECKS)).filter((f) => f.endsWith(".json")).sort();

/** Moments of animated decks to capture too: slide, step, ms into the step. */
const MOMENTS: Readonly<Record<string, readonly [slide: string, step: number, time: number][]>> = {
  motion: [
    ["steps", 0, 600], // the subtitle rising
    ["steps", 1, 150], // cards on a spring, staggered
    ["steps", 1, 770], // a card swinging in from depth
    ["steps", 2, 333], // bars growing, their color blending
    ["steps", 2, 1777], // the pulse looping
    ["finale", 0, 60], // the title flipping up at absurd
  ],
};

let dir: string;
let workspace: Workspace;
let app: VeloceServer;
const decks: Deck[] = [];

beforeAll(async () => {
  if (problem) return;
  dir = await mkdtemp(join(tmpdir(), "veloce-visual-"));
  const registry = createBuiltinRegistry();
  for (const file of deckFiles) {
    const bundle = await loadReferenceDeck(file, registry);
    // A fixed save time keeps the file bytes reproducible (nothing visual depends on it).
    const bytes = await writeVeloce(bundle, { now: new Date("2026-01-01T00:00:00Z") });
    await writeFile(join(dir, `${basename(file, ".json")}.veloce`), bytes);
    decks.push(bundle.deck);
  }
  workspace = await Workspace.open({ dir, context: registry.applyContext() });
  app = await startVeloceServer({
    workspace,
    registry,
    editorDir: EDITOR_DIST,
    port: 0,
    log: () => {},
    render: (baseUrl) => new PlaywrightRenderService({ baseUrl }),
  });
  await rm(OUTPUT, { recursive: true, force: true });
}, 60_000);

afterAll(async () => {
  if (problem) return;
  await app.close();
  await workspace.close();
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(problem !== null)("Visual regression: reference decks", { timeout: 60_000 }, () => {
  it("has reference decks to render", () => {
    expect(deckFiles.length).toBeGreaterThan(0);
  });

  for (const file of deckFiles) {
    const name = basename(file, ".json");
    it(`${name}: every slide matches its stored screenshot`, async () => {
      const deck = decks.find((d) => d.id === `visual-${name}`);
      if (!deck) throw new Error(`decks/${file} must have the ID "visual-${name}"`);
      const render = app.render;
      if (!render) throw new Error("the server has no renderer");

      const failures: string[] = [];
      const shots: { slideId: string; key: string; at?: { step: number; time: number } }[] = [
        ...deck.slides.map((s) => ({ slideId: s.id, key: `${name}--${s.id}` })),
        ...(MOMENTS[name] ?? []).map(([slideId, step, time]) => ({
          slideId,
          key: `${name}--${slideId}@${step}-${time}`,
          at: { step, time },
        })),
      ];
      for (const { slideId, key, at } of shots) {
        const shot = await render.screenshot(deck, {
          deckId: deck.id,
          slideId,
          width: deck.stage.width,
          format: "png",
          ...(at && { at }),
        });
        const baselinePath = join(SCREENSHOTS, `${key}.png`);
        if (UPDATE) {
          await mkdir(SCREENSHOTS, { recursive: true });
          await writeFile(baselinePath, shot.data);
          continue;
        }
        if (!existsSync(baselinePath)) {
          failures.push(`${key}: no stored screenshot (run pnpm test:visual:update)`);
          await saveOutput(`${key}.actual.png`, shot.data);
          continue;
        }
        const result = compareScreenshots(await readFile(baselinePath), shot.data);
        if (!result.match) {
          failures.push(`${key}: ${result.reason}`);
          await saveOutput(`${key}.actual.png`, shot.data);
          if (result.diff) await saveOutput(`${key}.diff.png`, result.diff);
        }
      }
      // Stored screenshots for slides the deck no longer has would never be checked again.
      const stale = existsSync(SCREENSHOTS)
        ? (await readdir(SCREENSHOTS)).filter(
            (f) => f.startsWith(`${name}--`) && !shots.some((s) => f === `${s.key}.png`),
          )
        : [];
      expect(stale, "stored screenshots of slides the deck doesn't have").toEqual([]);
      expect(
        failures,
        `Slides look different (actual and diff images in tests/visual/.output/; if the change is intended, run pnpm test:visual:update)`,
      ).toEqual([]);
    });
  }
});

async function saveOutput(file: string, data: Uint8Array): Promise<void> {
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(join(OUTPUT, file), data);
}
