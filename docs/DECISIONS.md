# Veloce Decision Log

Why things are the way they are. Add new decisions at the bottom; if one is reversed, mark it
**Superseded** and link the new entry. Don't re-argue a decision here without new information.

---

### D1 — The server owns the document (2026-11-18)

Browser tabs and AI agents are both clients of a doc-server. **Why:** a browser-owned store means the
AI can't work without an open tab, two tabs conflict, and screenshots depend on the user's window.
Server ownership enables headless AI generation, persistence, and live human + AI co-editing.

### D2 — Pure TypeScript `core` shared everywhere (2026-11-18)

Schema, ops, undo and lint rules live in a package with no DOM/React dependency. **Why:** the same
logic runs in the editor, doc-server, MCP and tests, so behavior never drifts.

### D3 — Auto-layout frames, not absolute X/Y everywhere (2026-11-18)

Layout (flexbox-like frames) is stored in the document; absolute positioning is one frame mode.
**Why:** LLMs describe structure well but do pixel math badly; a one-off "layout tool" that computes
X/Y breaks as soon as content changes. Stored layout reflows automatically for humans and the AI.

### D4 — Invertible ops + transactions with origin (2026-11-18)

**Why:** human and AI edit concurrently, which is a multiplayer problem. Undo must be per origin
(Ctrl+Z never undoes the agent), and "undo what the AI just did" must be one step. A server op log
is simpler than CRDTs for a local-first app; Yjs stays an option if cloud collaboration arrives.

### D5 — Plugins by capability, one shared clock (2026-11-18)

Plugins add element types, effects, transitions, themes and importers/exporters, not alternative
tween engines. **Why:** GSAP/anime.js/Framer Motion overlap ~90%; several engines confuse the AI,
fight over the timeline and break seeking/export. Animations are stored as intent (`fadeUp 400ms`),
and GSAP is just the default driver behind an `AnimationDriver` interface.
Kept: Lottie and Rive (they play designer-made assets, a different job), Three.js, charts, code, math.
Dropped: anime.js. Optional: Matter.js only with deterministic stepping or pre-baking.

### D6 — One Zod schema generates UI, MCP input, validation and docs (2026-11-18)

**Why:** plugins written once work for humans and AI automatically; docs can't drift from code.

### D7 — Built-in elements use the public plugin API (2026-11-18)

**Why:** guarantees the plugin API is good enough for third parties.

### D8 — Electron for desktop (2026-11-18)

**Why over Tauri:** Tauri uses each OS's own webview (WebKitGTK on Linux), which gives inconsistent WebGL and text
rendering, a problem for a Three.js-heavy app that needs exact text measurement. Electron ships the
same Chromium everywhere, and `printToPDF`/`capturePage` give export and AI screenshots that match
on-screen rendering. Trade-off: bigger install (~120MB). Build web-first; Electron is a thin shell.

### D9 — MCP runs in-process with the doc-server over Streamable HTTP (2026-11-18)

**Why:** no extra hop or state copy; works from the Electron main process or a standalone Node
server. A stdio shim is added later for clients that only support stdio.

### D10 — Own file format: `.veloce` (zip container) (2026-11-18, extension confirmed)

`manifest.json`, `document.json`, `theme.json`, `plugins.lock.json`, content-hashed `assets/`,
`fallbacks/`, `preview.png`. MIME: `application/vnd.veloce+zip`. **Why:** independent of PowerPoint
(PPTX is just an import/export plugin); a single shareable file; versioned with migrations so
old decks always open. Avoid `.vce` (exam simulator) and `.vlc` (looks like VLC).

### D11 — Security posture for a public product (2026-11-18)

Built-in plugins run in the main page; community plugins and AI-written custom code run in sandboxed
iframes with a message-passing API. Electron: `contextIsolation`, `sandbox`, no `nodeIntegration`.
**Why:** shared decks/plugins running arbitrary code would mean XSS, and with Electron, file system access.

### D12 — Agent quality: lint first, screenshot second (2026-11-18)

**Why:** structured lint (overflow, overlap, contrast) is cheap and precise; screenshots are
token-heavy and LLMs misread them. Screenshots are the final visual check.

### D13 — AI knowledge in layers (2026-11-18)

Tool descriptions (always loaded) → MCP `instructions` + `get_docs(topic)` (the fallback that works with any
agent) → Claude skill (workflow + design taste) → docs site/`llms.txt`. Reference docs are generated from schemas.

### D14 — Veloce is FOSS; GSAP default, Motion as fallback driver (2026-11-18)

Veloce is free and open-source. GSAP stays the default `AnimationDriver` (most battle-tested timelines);
**Motion** (motion.dev, MIT, formerly Framer Motion, vanilla JS API, Web Animations API based, seekable)
is the fallback driver. **Why:** GSAP is free but its license is not OSI-approved, which may conflict with
a GPL project license or distro packaging. Decks store animation _intent_, so switching drivers never
touches files. Final default depends on the project license (open question in ROADMAP).

### D15 — Apache-2.0 license (2026-11-18)

**Why:** permissive (friendly to plugin authors and companies building on Veloce) with an explicit
patent grant that MIT lacks. Compatible with GSAP's no-charge license being a non-OSI dependency.

### D16 — Tooling: TypeScript 7, Vitest, Biome, source export condition (2026-11-18)

- **TypeScript 7** (native compiler) with `tsc -b` project references. Each package declares its runtime
  via `lib`/`types`: `core` and `format` get neither DOM nor Node, so purity is compiler-enforced.
- **Biome** instead of ESLint + Prettier: one fast tool for lint + format + import sorting.
  ⚠️ `biome migrate` once rewrote `recommended: true` to `preset: "none"` (all rules off). Keep
  `"preset": "recommended"`.
- **`@veloce/source` export condition:** packages export `./src/index.ts` under it; Vitest and
  `tsconfig.tests.json` use it so tests run without building. `default`/`types` point at `dist/`.
- **Test files** are excluded from package builds and type-checked by `tsconfig.tests.json`
  (`pnpm typecheck` runs both).
- **Architecture guard:** `scripts/architecture.test.ts` holds the allowed dependency graph.
- **Supply-chain:** pnpm's minimum-release-age policy stays on. Don't add `minimumReleaseAgeExclude`
  entries. If a just-published version is blocked, pin the previous release instead.
