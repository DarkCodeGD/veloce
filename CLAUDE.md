# Veloce

AI-first presentation app: AI agents build professional animated decks through an MCP server,
humans edit the same deck in the editor. Desktop on Linux/Windows/macOS (Electron). Files: `.veloce`.
It's a FOSS product for other people — security, file-format stability, signing, updates and
dependency licenses matter (check a library's license before adding it).

## Start of every session

1. Read [docs/ROADMAP.md](docs/ROADMAP.md) → "Current status" and the active phase.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the map (packages, data flow, where to start
   reading). Skim [docs/DECISIONS.md](docs/DECISIONS.md) before proposing architecture changes. Don't re-argue
   a decision without new information; if one changes, add a new entry and mark the old one Superseded.
3. Continue with the first unchecked item in the active phase unless the user asks for something else.

## End of every work session

- Tick completed checkboxes in ROADMAP.md and update "Current status" (active phase, date, notes).
- Record any new architectural decision in DECISIONS.md with its **why**.
- If a change makes [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) wrong (a new package, a new
  data flow, a moved responsibility), update it in the same change.

## Golden rules

1. Humans and AI go through the same ops/transactions — no special cases.
2. The doc-server owns the document; editor tabs and MCP are clients.
3. One timeline clock; plugins implement `seek(t)` and never run their own loop. Stay deterministic.
4. Layout is structural (auto-layout frames); the AI describes structure, the engine computes pixels.
5. One Zod schema per element type generates inspector UI, MCP input, validation and docs.
6. Built-in elements and commands use the public plugin API; third-party plugins run sandboxed (D79).
7. Every op is invertible; transactions carry an origin (`user` | `agent:<id>` | `plugin:<id>`, D79); undo is per origin.

## Conventions

- TypeScript strict, pnpm workspaces, Vitest for tests. `core` must stay free of DOM/React imports.
- Every new op, migration and plugin ships with tests (plugins must pass the conformance kit).
- Plugins must `dispose()` everything they create (DOM, listeners, WebGL contexts, workers).
- MCP tools: few, high-leverage, batch-friendly; errors must tell the agent how to fix the call.
- After changing anything agents use (MCP tools, docs, errors), retest with a real agent: run
  the server, spawn a subagent (Sonnet 5.5, high effort) that has only the Veloce MCP tools,
  have it build a real deck and try to break it, and report what worked, friction, errors,
  docs gaps and bugs. Fix, retest, repeat until it comes back clean; the maintainer does the
  final hand test. Scripted MCP tests prove the tools work, not that agents can discover and
  use them (D97 §8). Editor-only changes get unit and browser tests instead.
- Never put base64 blobs in `document.json`; assets are content-hashed files in the `.veloce` zip.

## Commands

- `pnpm check`: lint + typecheck + test (same as CI). Run before declaring work done.
- `pnpm test` runs Vitest against `src/` (no build needed); `pnpm build` = `tsc -b`.
- `pnpm format` auto-fixes formatting (Biome also formats Markdown).
- `pnpm start` builds everything and runs the server + editor on `http://127.0.0.1:4321` (decks in
  `./decks`). `pnpm dev:server` + `pnpm dev:editor` for editor work with Vite HMR on :5173.
- Browser tests need `pnpm build:editor` and headless Chromium
  (`pnpm --filter @veloce/server exec playwright-core install chromium-headless-shell`); without
  them they skip locally. CI requires them (`VELOCE_REQUIRE_BROWSER=1`).
- The render page runs the **built** editor: rebuild (`pnpm build:editor`) after renderer changes
  before trusting browser test results.
- Visual regression (`tests/visual/`, D102): a deliberate visual change → look at the diffs in
  `tests/visual/.output/`, then `pnpm test:visual:update` and commit the new screenshots with
  the change. Never edit the reference decks to make a test pass.
- `pnpm perf:motion` (D107) plays one busy slide on the real GPU, main-thread motion vs the
  compositor, and writes `tests/perf/motion/.output/report.md`. Machine-dependent, so it's
  not in `pnpm check`; rerun it after changing how motion is drawn or played.
- New package/dependency between packages → update `scripts/architecture.test.ts` + DECISIONS.md.
- Respect pnpm's minimum-release-age policy: never add `minimumReleaseAgeExclude`; pin an older version.
- Plugins live in `plugins/<name>` as `@veloce/plugin-<name>`; every plugin test runs `checkElementConformance` for its elements and `checkEffectConformance` for its effects.
- `tests/integration/` holds per-phase acceptance tests (the roadmap's "Done when").
