# Veloce Roadmap

> **Source of truth for what to build next.** Claude: read "Current status" first, work on the
> first unchecked item in the active phase, tick boxes as items land, and update "Current status"
> before the session ends. Decisions and their reasons live in [DECISIONS.md](DECISIONS.md).

## Current status

- **Active phase:** Phase 2: See it + let the AI in (not started)
- **Last updated:** 2026-11-18
- **Notes:** Phase 1 done: `pnpm check` green (lint + typecheck + 117 tests, no build needed).
  `renderer`, `doc-server`, `mcp`, `server`, `editor`, `desktop` are still placeholders.
  Next: renderer (deck → DOM with the plugin registry), then doc-server, then MCP.

---

## The product in one paragraph

Veloce is a desktop app (Linux, Windows, macOS) for making professional, animated presentations.
**AI agents build decks through an MCP server**, and humans edit the same deck by hand in the editor,
even at the same time. Decks are saved as **`.veloce`** files. Capabilities (3D, Lottie, Rive, charts…)
come from **plugins** that all follow one contract and one shared timeline clock. It is a
**free and open-source (FOSS)** product for other people, so security, stable file formats,
signing, updates and dependency licenses matter.

## Golden rules (never break these)

1. **Humans and AI use the same ops.** The editor and the MCP server both send transactions to the
   same core. Nothing is special-cased for either one.
2. **The server owns the document.** Browser tabs and AI agents are clients. The AI can work with no tab open.
3. **One timeline, one clock.** Plugins never run their own animation loop. They implement `seek(t)`.
   Everything must be deterministic so seeking, thumbnails and export match playback exactly.
4. **Structure, not pixels.** Layout lives in the document as auto-layout frames. The AI describes
   structure ("row of 3 cards") and the engine computes positions.
5. **One schema → everything.** Each element type's Zod `propsSchema` generates the inspector UI,
   the MCP tool input, validation and the AI docs. Docs are generated, not hand-written (except the skill).
6. **Built-ins are plugins.** Text, shape and image use the exact same plugin API as third parties.
7. **Every op is invertible** and every transaction records its origin (`user` | `agent:<id>`), so
   undo is tracked per origin and "undo what the AI did" is one step.

## Target architecture

```
veloce/
├── apps/
│   ├── editor/          React web app: editor UI, hosts the renderer
│   ├── server/          Standalone Node entry: doc-server + MCP (for web/dev use)
│   └── desktop/         Electron shell: main process runs doc-server + MCP, window loads editor
├── packages/
│   ├── core/            Zod schemas, ops, transactions, undo, theme tokens, lint rules (pure TS, no DOM)
│   ├── format/          .veloce zip read/write, manifest, content-hashed assets, migrations
│   ├── plugin-api/      Plugin contract types, registry, conformance test kit
│   ├── renderer/        Deck → DOM, stage scaling, plugin host, timeline clock, measurement
│   ├── doc-server/      Open documents, apply transactions, versioning, WebSocket sync, autosave
│   └── mcp/             MCP tools/resources/instructions, mounted inside doc-server's process
├── plugins/
│   ├── text/ shape/ image/            (built-in, Phase 1–3)
│   └── chart/ lottie/ rive/ code/ math/ icon/ video/ three/ …   (Phase 5)
└── docs/                ROADMAP.md, DECISIONS.md, generated reference docs
```

Data flow: `editor`/`MCP` → transaction (ops + origin) → `doc-server` → `core.apply` (validate) →
new version → broadcast to all clients → `renderer` re-renders → measurements feed lint.

## Stack

TypeScript (strict) · pnpm workspaces · Vite · React (editor UI only) · Zod · Vitest · Playwright ·
fflate (zip) · TipTap (rich text) · Moveable (transform handles) · GSAP (default animation driver; fallback driver: Motion, MIT. See D14) ·
`@modelcontextprotocol/sdk` (Streamable HTTP) · Electron + electron-builder + electron-updater ·
plain Three.js inside the 3D plugin (plugins are framework-agnostic).

---

## Phase 0 — Repo setup ✅ (2026-11-18)

- [x] `git init` (branch `main`), `.gitignore`, `.editorconfig`, `.nvmrc`, `README.md`
- [x] License: Apache-2.0 (`LICENSE` + `NOTICE`)
- [x] pnpm workspace with `apps/*`, `packages/*`, `plugins/*`
- [x] Shared `tsconfig.base.json` (strict, ES2023, NodeNext, project references); per-package `lib`/`types` per runtime
- [x] Vitest + Biome at root; `pnpm build`, `typecheck`, `test`, `lint`, `format`, `check` scripts
- [x] Empty packages created with correct dependency directions, guarded by `scripts/architecture.test.ts`
- [x] CI workflow (GitHub Actions): install, lint, typecheck, test

**Done when:** `pnpm install && pnpm build && pnpm test` passes on an empty-but-wired monorepo. ✅

## Phase 1 — Foundation (`core`, `format`, `plugin-api`) ✅ (2026-11-18)

**Schema (`core`)**: `packages/core/src/schema/`

- [x] IDs: stable strings; callers may choose readable IDs, builders generate `nd_…`/`sl_…`; slides and nodes share one namespace (D17)
- [x] `Deck`: id, formatVersion, meta (title, description, authors, language), stage, theme, slides[], assets registry. Plugin requirements are derived at save time (`registry.lockFor`), not stored
- [x] `Slide`: id, name, background, notes, hidden, root frame. (Timeline is added in Phase 4 as an optional field; no stub)
- [x] `Frame` auto-layout: `stack` (direction, gap, padding, align, justify, wrap), `grid` (columns, gap, rowGap), `absolute`; frame style (fill, stroke, radius, shadow, clip)
- [x] `Element`: id, `type`, `props`, width/height (`number | "hug" | "fill"`), position, rotation, opacity, locked, hidden, name
- [x] Rich text model (paragraphs → runs with marks, lists, links). Own model; the TipTap mapping comes in Phase 3
- [x] Theme tokens: colors, fonts, text styles, space, radius, shadow; refs like `$color.primary`; `themeToCssVariables`
- [x] Stage: 1920×1080 default, configurable per deck

**Ops & transactions (`core`)**: `ops/`, `transaction.ts`, `document.ts`

- [x] 12 ops: `slide.insert/remove/move/update`, `node.insert/remove/move/update`, `deck.updateMeta`, `deck.setTheme`, `asset.add/remove`
- [x] Pure `applyOp` with exact inverse; immutable path copying (untouched subtrees shared)
- [x] Updates use JSON Merge Patch + discriminator rule; prototype-pollution keys dropped (D18)
- [x] Transactions `{ id, origin, label, ops }`: validated, atomic
- [x] `DeckDocument`: per-origin undo/redo, conflicting undo fails cleanly and is dropped, history cap (D19)
- [x] Actionable errors: codes, paths, "Did you mean…" (closest only), slide/node mix-up hints

**File format (`format`)**

- [x] `.veloce` zip: manifest (first, stored), document, theme, plugins.lock, `assets/<sha256>.<ext>`, `fallbacks/<id>.png`, preview
- [x] Works in Node and browser (fflate + Web Crypto, no Node/DOM APIs)
- [x] `formatVersion` + migration registry (`migrateDocument`), TOO_NEW error for files from newer versions
- [x] Content-addressed assets, hash-verified on read and write; never base64 in JSON
- [x] Hardened reader: path traversal, entry/size caps (declared + actual), unknown entries skipped (D21)
- [x] Writer refuses invalid decks / mismatched assets; reproducible output for a fixed timestamp

**Plugin contract (`plugin-api`)**

- [x] `ElementDefinition`: type, title, description, `propsSchema` (zod), `defaultProps`, `defaultSize`, `deterministic`, `aiDocs`, `mount()` (D22)
- [x] `ElementInstance`: `update`, `seek(seconds)`, `dispose` (idempotent), optional `renderStatic`
- [x] `PluginRegistry`: register (manifest + namespacing checks), `validateElement` → core, `describe()` with JSON Schema, `lockFor(deck)`
- [x] CSS helpers: tokens → `var(--v-…)`, paints, borders, shadows
- [x] Conformance kit: lifecycle, container ownership, determinism, leaks (listeners incl. window/AbortSignal/once, timers, rAF, DOM). WebGL-context tracking is added with the `three` plugin (Phase 5)
- [x] Built-in plugins `@veloce/plugin-text` (XSS-safe, semantic lists), `@veloce/plugin-shape`, `@veloce/plugin-image` (assets only, alt required)

**Done when:** a test builds a deck purely through transactions, saves `.veloce`, loads it back
identically, and per-origin undo/redo works. Built-in plugins pass the conformance kit.
✅ `tests/integration/phase1.test.ts`

## Phase 2 — See it + let the AI in (`renderer`, `doc-server`, `mcp`, view-only `editor`)

> Notes from Phase 1:
> - Load SVG assets only via `<img>` (scripts in SVG must never run).
> - The MCP server (Node) needs plugin schemas + `aiDocs` but not `mount()` (DOM). If importing plugins into Node gets awkward, split each plugin into a DOM-free definition module and a render module.
> - Allow `apps/*` to depend on `@veloce/plugin-*` in `scripts/architecture.test.ts` when wiring them.

**Renderer**

- [ ] Deck → DOM; frames map to CSS flexbox; stage scaled to fit via CSS transform
- [ ] Plugin host: mount current slide ±1 only; others show static thumbnails
- [ ] Theme tokens → CSS variables; font loading (await fonts before measuring)
- [ ] Measurement pass: computed bounds per node, text overflow detection → reported to server

**Doc server**

- [ ] Open/create/save documents; versioned; transactions applied in order
- [ ] WebSocket sync protocol: client sends transaction → server applies → broadcasts patch + version; rejects stale/invalid with reason
- [ ] Atomic autosave (write temp file → rename)
- [ ] Render worker for screenshots/measurement without a user window (Playwright in dev/web; hidden BrowserWindow in Electron later)

**Lint (`core` rules + renderer measurements)**

- [ ] Rules: text overflow, overlap, off-canvas, low contrast (WCAG), empty slide, too much text, missing alt text
- [ ] Output structured JSON with node ids and suggested fixes

**MCP (`mcp`, Streamable HTTP at `http://localhost:<port>/mcp`)**

- [ ] Server `instructions` (core workflow + rules: the fallback for agents without the skill)
- [ ] Tools (keep the set small, ~10):
  - `get_deck_summary` (compact: slides, node ids, types, bounds; no blobs)
  - `get_slide(slideId)`
  - `upsert_slide(slide)` (whole slide in one call)
  - `apply_ops(ops, label)` (batch transaction)
  - `list_element_types` (from plugin registry, with prop schemas)
  - `set_theme` / `list_themes`
  - `lint(slideId?)`
  - `render_preview(slideId, step?)` → image content block
  - `undo_agent_changes(count?)`
  - `get_docs(topic)` (on-demand docs: core, layout, theme, each plugin's aiDocs)
- [ ] Resources: `deck://current/summary`, `deck://current/theme`
- [ ] All inputs validated with Zod; errors are actionable (`isError: true` + how to fix)

**Editor (view-only)**

- [ ] Slide list + stage + live updates from server

**Done when:** in Claude Code, "make a 5-slide pitch deck about X" produces a good-looking deck
live in the browser; the agent runs `lint` + `render_preview` and fixes its own issues.
Then: review agent transcripts and redesign any tool the agent struggled with.

## Phase 3 — Manual editor

- [ ] Selection (click, shift-click, marquee), hover outlines, layers panel
- [ ] Move/resize/rotate (Moveable); snapping guides + spacing indicators
- [ ] Auto-layout-aware drag (reorder within frame, drop into frames)
- [ ] Text editing with TipTap, mapped to the core rich text model
- [ ] Inspector panel auto-generated from each plugin's `propsSchema`
- [ ] Slide panel: add, duplicate, delete, reorder (drag)
- [ ] Theme picker + token-aware color/font pickers
- [ ] Asset import (drag & drop images/fonts/files → content-hashed assets)
- [ ] Clipboard (copy/paste within and between decks), keyboard shortcuts
- [ ] Undo/redo for the `user` origin only; history panel shows agent transactions too

**Done when:** a full deck can be built by hand; human and agent edit concurrently without
conflicts; Ctrl+Z never undoes the agent's work.

## Phase 4 — Motion

- [ ] Timeline schema: per-slide steps (click triggers); animations `{ target, effect | keyframes, trigger: onClick | withPrevious | afterPrevious, delay, duration, easing }`
- [ ] Core clock: `seek(slideId, step, t)`; plugins driven via `seek(t)`
- [ ] `AnimationDriver` interface; GSAP as default driver (swap-able)
- [ ] Effect presets (fade, slide, scale, blur, typewriter, count-up, stagger…), extensible by plugins
- [ ] Slide transitions (fade, push, zoom) + **morph** (match nodes by id across slides)
- [ ] Presenter mode: fullscreen, speaker notes, next-slide preview, timer, second window synced
- [ ] MCP: `set_animations(slideId, steps)`, `render_preview` at a step/time
- [ ] Determinism test: seek to the same step/time twice → identical screenshots

**Done when:** decks animate in presenter mode and every frame is reproducible by seeking.

## Phase 5 — Plugins

Each plugin: `propsSchema`, `aiDocs`, `renderStatic`, conformance kit passes.

- [ ] `chart` (ECharts): bar/line/pie/area/scatter, data in props, animated entry
- [ ] `lottie` (dotLottie): play/seek, segment control
- [ ] `rive`: state machine inputs as props, seekable via clock
- [ ] `code` (Shiki): syntax highlight, line highlight steps
- [ ] `math` (KaTeX)
- [ ] `icon` (Lucide/Iconify)
- [ ] `video`: seek-synced to the clock
- [ ] `diagram` (Mermaid)
- [ ] `three`: declarative scene (models, lights, camera, presets) + WebGL context manager (budget < 16 live contexts)
- [ ] `custom-component`: AI/user-written code in a sandboxed iframe with a declared param schema → inspector knobs
- [ ] Optional: `physics` (Matter.js) with fixed timestep + seeded RNG, or pre-baked keyframes

**Done when:** all plugins pass conformance; the agent can discover and use them via `list_element_types` + `get_docs`.

## Phase 6 — Desktop app (Electron)

- [ ] Main process hosts doc-server + MCP; window loads the editor
- [ ] Security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, minimal preload IPC
- [ ] `.veloce` file associations (Windows registry, macOS UTI/Info.plist, Linux .desktop + shared-mime-info), `open-file` handling, single-instance lock
- [ ] `veloce://` protocol handler
- [ ] Native menus, recent files, window state, crash recovery from autosave
- [ ] "Connect AI" panel: copy-paste config for Claude Code / Claude Desktop / Cursor; stdio shim for clients that need it
- [ ] Packaging: AppImage + deb + rpm, NSIS (Windows), dmg (macOS); electron-updater

**Done when:** installs on all 3 OSes, double-clicking a `.veloce` opens it, and Claude Code connects.

## Phase 7 — Import & export

- [ ] PDF (printToPDF / Playwright), one page per slide (option: per step)
- [ ] PNG/JPEG per slide
- [ ] Standalone HTML: self-contained animated deck playable in any browser
- [ ] MP4: frame-by-frame render through the seekable clock + ffmpeg
- [ ] PPTX import (shapes, text, images, basic layout; best-effort animations)
- [ ] PPTX export (static, using fallbacks for plugin elements)

**Done when:** a deck can be shared with someone who doesn't have Veloce, and old PowerPoints can be brought in.

## Phase 8 — AI knowledge

- [ ] Reference docs generated from Zod schemas + plugin `aiDocs` (no hand-written API docs)
- [ ] MCP `instructions` + `get_docs` topics finalized
- [ ] Claude skill `veloce-deck-design`: workflow (storyline → theme → batch build → lint → preview → fix) + design taste rules
- [ ] `llms.txt` + human docs site for plugin developers
- [ ] AI eval suite: fixed prompts → decks → lint score + screenshot review; run when tools change

**Done when:** a fresh agent with only the MCP (no skill) can make a decent deck, and with the skill makes a great one.

## Phase 9 — Launch prep

- [ ] Community plugin sandbox (iframe + postMessage RPC, permission prompts) + install UX
- [ ] Code signing: Apple Developer + notarization; Windows signing certificate
- [ ] Opt-in crash reporting & telemetry
- [ ] Performance budget: 60fps playback, memory stable across 100+ slides, no leaks
- [ ] Accessibility (keyboard nav, screen reader labels, alt text)
- [ ] Starter templates & themes, onboarding
- [ ] Trademark check for "Veloce", dependency license audit

---

## Open questions

- [x] **Project license:** Apache-2.0 (decided 2026-11-18). GSAP can stay the default driver if its license text checks out (D14).
- [ ] **GSAP license:** read the GSAP "standard no-charge license" text. Veloce doesn't compete with
      Webflow, but GSAP's license is not OSI-approved: fine next to an MIT/Apache app, but a conflict with GPL
      and a blocker for strict distro packaging (e.g. Debian main). If incompatible → Motion becomes the
      default driver and GSAP ships as an optional plugin. **Resolve before Phase 4.**
- [ ] **Name:** trademark search for "Veloce" in the software class.
- [x] **Extension:** `.veloce` confirmed by the user (2026-11-18).
- [ ] **Sync:** server op log now; move to Yjs only if cloud multi-user collaboration becomes a goal.
- [ ] **Business:** hosted web viewer / cloud sync / plugin marketplace (post-launch).
