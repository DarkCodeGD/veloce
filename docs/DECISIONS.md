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

### D17: Caller-chosen IDs in one namespace per deck (2026-11-18)

IDs are any 1–64 char `[A-Za-z0-9_-]` string, unique across all slides **and** nodes of a deck.
Builders generate prefixed IDs (`sl_…`, `nd_…`); agents may pick readable ones (`"title"`).
**Why:** an agent can insert a node and reference it later in the same batch without a round
trip, and an ID always means exactly one thing (errors can say "that's a slide, not a node").

### D18: "Absent means default" + JSON Merge Patch for updates (2026-11-18)

Optional fields are omitted rather than stored with default values, and documents never contain
`null`. Updates use RFC 7386 merge patch (`null` deletes). Extension: if a patch changes a tagged
object's variant (layout `mode`, paint `type` with core-known values), the object is replaced, not
merged. Keys `__proto__`/`constructor`/`prototype` are dropped. **Why:** compact JSON is cheaper
for agents to read, merge patch is a standard agents already know, and the discriminator rule
lets `{ layout: { mode: "grid", columns: 3 } }` work in one call.

### D19: Undo applies inverse ops as a new change (2026-11-18)

Each origin has its own undo/redo stacks of inverse ops. Undo applies them on top of the current
deck. If another participant's later edit makes that impossible, the undo fails with a readable
reason and the entry is dropped (no history rewriting, no OT/CRDT). Inverse updates only revert the
fields that changed. **Why:** simplest model that's correct for human + agent co-editing on a
server-owned document; per-field inverses keep others' edits to the same node intact.

### D20: Content-addressed assets, referenced as `"asset:<sha256>"` (2026-11-18)

Asset ID = SHA-256 of the bytes. Anything referencing an asset uses the `asset:` prefix, so core
finds references inside plugin props without knowing plugin schemas (used for "can't remove an asset
in use" and file validation). No remote URLs in documents. **Why:** dedupe, integrity checks, and
self-contained decks that work offline and never contact third-party servers when opened.

### D21: Treat every .veloce file as hostile (2026-11-18)

The reader blocks unsafe paths, caps entry count / per-entry / total size (checked against both the
zip's declared sizes and the actual bytes), ignores unknown entries, re-hashes every asset, migrates,
then fully validates. The writer refuses anything it couldn't read back. **Why:** a FOSS app opens
files from strangers; zip bombs, path traversal and corrupted assets must fail safely and clearly.

### D22: Plugin contract details (2026-11-18)

- The renderer owns the container element; plugins only add children (checked by the kit).
- `seek(time)` takes **seconds** on the slide timeline. `dispose()` must be idempotent.
- `renderStatic()` is optional: DOM/canvas capture covers most elements.
- Third-party element types are namespaced (`acme.sparkles`); bare names are for `veloce.*` plugins.
- Plugins import `z` from `@veloce/plugin-api` so the app shares one zod instance.
- Schemas must convert to JSON Schema (kit checks it): use regex strings, not `z.custom`.

**Why:** clear ownership prevents renderer/plugin fights; namespacing prevents collisions; the
conformance kit turns "don't leak" from advice into an automatic check.

### D23: Zero-dependency crypto via Web Crypto (2026-11-18)

IDs (`getRandomValues`, unbiased) and SHA-256 (`crypto.subtle`) use `globalThis.crypto`, typed
locally so `core` stays free of DOM/Node typings. **Why:** fewer dependencies = smaller
supply-chain surface; Web Crypto is available in Node 22 and every browser.

### D24: Tests always run against source (2026-11-18)

Vitest resolves the `@veloce/source` export condition in both browser-like (`resolve.conditions`)
and Node (`ssr.resolve.conditions`) environments. **Why:** found in Phase 1. With only the first
set, cross-package tests in Node silently used stale `dist/` builds. `pnpm test` must pass with
no `dist/` folders at all.

### D25: Sync protocol lives in `core` (2026-11-18)

Messages (`open`, `transaction`, `undo`, `redo` / `welcome`, `decks`, `snapshot`, `change`,
`result`, `error`) are Zod schemas in `core/sync.ts`. Clients replay a `change` with the same pure
`applyChange` the server used and ask for a fresh snapshot on any version gap. The server always
stamps the origin (a client-sent `origin` key is rejected). Transactions apply against the latest
version, never rejected as "stale": ops address nodes by ID, so they compose, and an invalid op
fails with a reason. **Why:** one definition shared by the editor, the server, tests and later
Electron; replaying ops keeps unchanged slides identical by reference, so the renderer skips them;
server-stamped origins make per-origin undo trustworthy.

### D26: `@veloce/builtins` package (2026-11-18)

`createBuiltinRegistry()` registers text, shape and image for every app (editor, render page,
server, desktop). **Why:** one list of built-ins instead of four copies drifting apart.

### D27: Rendering is a contract in `doc-server` (2026-11-18)

`RenderService { measure, screenshot, close }` is defined in `doc-server`; Playwright lives only in
`apps/server` (Electron will use a hidden window). `CachedRenderService` caches measurements in
WeakMaps keyed by slide, theme and stage objects. **Why:** keeps `doc-server` and `mcp` testable
without a browser (fakes in tests). Structural sharing makes identity a free cache key: an
unchanged slide is never re-measured, and entries disappear with the old document.

### D28: One shared active deck (2026-11-18)

The workspace (a folder of `.veloce` files) has one active deck that the editor and all agents
share. Agents switch it with `open_deck`/`create_deck`, and editor tabs follow. **Why:** the
product is "watch the AI build it". If agents and users could point at different decks, users
would miss the work. Per-session decks can come later if needed.

### D29: MCP via the SDK's low-level `Server` (2026-11-18)

We use the low-level `Server` with our own ListTools/CallTool handlers instead of `McpServer`.
Tool input schemas come from `z.toJSONSchema(…, { io: "input", reused: "ref" })`. `apply_ops`
advertises a compact schema but validates strictly. There is one `Server` per HTTP session, capped
at 64 sessions (least recently used is evicted). **Why:** `McpServer` wants its own zod schema
shapes; we already have exact schemas and need control over their size. `reused: "ref"` shrank
`upsert_slide` from 19.8 KB to 7.5 KB, and a test keeps the budget.

### D30: Write tools return lint results (2026-11-18)

`upsert_slide` and `apply_ops` lint the slides they changed (with real measurements when a
renderer is available) and append the issues to the result. **Why:** agents rarely call `lint`
on their own; the feedback arrives at the moment they can fix it, at no extra round trip.

### D31: Lint additions (2026-11-18)

- `unknown-token` (error): a well-formed but undefined token such as `$text.h11`. The schema checks
  only the format; the theme can change later. Suggestions match on the token name.
- `small-text` (< 20px on a 1920-wide stage).
- Overflow is measured geometrically: content rects against the element box. Vertical extents come
  from block boxes only, because text ranges include the font's full ascent and descent and read
  as overflow at line-height < 1.2.
- `overflow: clip` frames skip the check.

**Why:** found while testing with real Chromium. `scrollHeight` misses content overflowing at the
top, and text-range heights caused false positives on every heading.

### D32: Pinned Playwright, bundled fonts (2026-11-18)

- `playwright-core` is pinned to 1.64.1 (Apache-2.0) to match the cached
  `chromium-headless-shell` build. Upgrade both together.
- Inter and JetBrains Mono (OFL-1.1, `@fontsource-variable`) are registered with `FontFace` under
  the exact family names the themes use.
- The render page waits for fonts before measuring.

**Why:** measurements and screenshots must be identical on every machine. A system fallback font
changes line breaks and therefore lint results.

### D33: 13 MCP tools (2026-11-18)

The ~10 planned tools plus `create_deck`, `list_decks` and `open_deck`. There is no
`list_themes`: the `set_theme` error and `get_docs("theme")` list the themes. **Why:** an agent
must be able to start from an empty workspace without the user's help.

### D34: Local server security (2026-11-18)

- The server binds to loopback by default.
- The `Host` header must name this server (DNS rebinding).
- Requests carrying an `Origin` must come from the server's own pages (cross-site requests and
  WebSocket hijacking). Extra origins are allowed with `--allow-origin`.
- Pages are served with a strict CSP.
- Assets are served with `sandbox` CSP and `nosniff`.
- The render page may only load from this server.

All of this is covered by `tests/integration/phase2.test.ts`.

**Why:** any website the user visits can reach `localhost`. The server can write files and has no
login, so these checks are its only protection.

### D35: Renderer lifecycle and sizing (2026-11-18)

- On a slide switch, removed nodes are disposed **before** new ones mount. Plugin errors are
  isolated behind a placeholder.
- An absent size resolves as `node.width ?? plugin.defaultSize ?? "auto"`. `"auto"` fits content
  on the main axis and follows the parent's `align` on the cross axis.

**Why:** browsers cap WebGL contexts (~16), so a disposed-after-mount swap can fail on heavy
slides. `"auto"` gives agents the layout they expect when they omit sizes.

### D36: Built-in themes keep agent-facing pairs readable (2026-11-18)

A test checks every built-in theme:

- `primary` and `muted` reach ≥ 4.5:1 on both `background` and `surface`.
- `on-primary` reaches ≥ 4.5:1 on `primary`.
- `text` reaches ≥ 7:1 on `background`.

Midnight's primary changed to `#8b6dff`, with dark `on-primary`.

**Why:** the first scripted agent run hit `low-contrast` with nothing but theme tokens. If the
obvious tokens fail lint, agents waste turns fixing problems the theme created.

### D37: Fixes from the first real-agent transcript (2026-11-18)

Claude Code built a 5-slide deck and reported five hiccups. Each one now has a regression test.

1. **The agent reads the real palette.** Before any deck exists, `get_docs("theme")` used to
   describe Light as if it were current. It now lists every built-in theme's palette, and
   `create_deck`/`set_theme` results include the active palette. **Why:** the agent assumed
   `on-primary` was white, which it isn't in Midnight.
2. **Contrast is checked over gradients.** The check samples the stops and three points between
   each pair, and the worst background wins. Images are still skipped. **Why:** a gradient that
   darkens under dark text passed lint, and only a preview caught it.
3. **`"hug"` follows the parent's `align`.** Only `stretch` falls back to `start`.
   **Why:** a hug-sized button stayed left-aligned in a centered column; this was a renderer bug.
4. **`upsert_slide` protects other people's work.** It refuses to replace a slide that another
   origin (usually the user) edited last, unless the agent passes `overwrite: true`. Replacing a
   slide keeps the root frame's ID, and the tool description points to `apply_ops` for fixes.
   **Why:** golden rule 1. A whole-slide rebuild would silently discard the human's edits.
   Last-editor tracking is per session: `OpenDeck.lastEditor`, derived from slide identity.
5. **New `empty-space` rule (info).** It fires when more than 40% of the slide height is empty
   above or below all elements. **Why:** agents that skip previews can't see unbalanced slides.
   The rule only measures elements, because fill frames span the slide anyway.

### D38: Hardening from the second agent transcript (2026-11-18)

1. **Agents may only rebuild slides their own MCP session created.** `upsert_slide` refuses to
   replace any other slide (the user's, an earlier session's, another agent's, or anything that
   existed before a server restart) unless the agent passes `overwrite: true`. This tightens
   D37 #4. The ownership set lives in `AgentSession`, one per MCP connection, so it starts empty
   after a restart. The instructions also tell agents to `create_deck` for a new presentation
   instead of reworking the user's deck. **Why:** D37's last-editor check is in memory, and
   every Claude Code session shares the origin `agent:claude-code`. After a restart, a new
   session could silently replace the user's slides, and the undo history would be gone.
2. **Text is measured word by word horizontally.** Whitespace never counts as content.
   **Why:** at a soft wrap the line's trailing space hangs past the box, which produced false
   3–9px "too wide" errors on wrapped text in every alignment. Agents were rewriting good copy to
   silence them. This extends D31.
3. **Radial gradients are `ellipse farthest-side`.** Offset 1 reaches the box sides, so a centered
   gradient ends exactly on an ellipse shape's outline. **Why:** with CSS's default
   (farthest-corner), glows were cut off with a hard edge. `closest-side` was rejected because it
   collapses to nothing when the center is on a corner. This changes how existing radial fills
   render, which is acceptable before the file format is frozen.
4. **No icon glyphs until the `icon` plugin lands (Phase 5).** The design docs tell agents not to
   use symbol characters as icons. **Why:** the bundled fonts cover text only, so symbols fall
   back to a mismatched system font. Bundling symbol fonts would be the wrong fix; icons should
   be vector elements.

### D39: Editor editing foundation (2026-11-18)

1. **No optimistic writes.** The editor sends a transaction and waits for the server's
   `result`; the next `change` repaints. **Why:** the server owns the document (golden rule 2)
   and a localhost round trip is about 1 ms, so optimistic state would buy nothing and add a
   reconciliation layer. Interactions (later: drag, resize) preview locally and commit one
   transaction at the end.
2. **Figma-style selection.** A click picks the top-level layer under the pointer; once inside a
   frame, clicks pick that frame's children. Double-click drills in, Esc selects the parents,
   Enter the first child, Ctrl+A the siblings. Locked layers pass clicks to their container.
   **Why:** auto-layout decks are deeply nested, so "innermost wins" would make frames almost
   impossible to select. The rules live in `model/selection.ts`, free of DOM, and are tested.
3. **The inspector reads the plugin's schema through JSON Schema**
   (`z.toJSONSchema(…, {io: "input"})`) and maps it to a small set of field kinds (enum,
   boolean, number, token, color, paint, length, text, rich text, read-only). **Why:** golden
   rule 5. Third-party plugins get a working inspector for free, and JSON Schema is a stable
   surface, unlike Zod's internals. Fields commit on Enter or blur and revert on Esc;
   `null` resets to the default.
4. **Undo toasts instead of confirmation dialogs** for destructive actions. **Why:** every edit
   is one undoable transaction, so a dialog only slows people down.
5. **Accessibility rules** from the ui-ux-pro-max skill's checklist (used as read-only guidance):
   visible labels and focus, SVG icons, 150–300 ms transitions, reduced motion, and a
   non-drag path for every drag (WCAG 2.5.7; Alt+↑/↓ reorders layers and slides).
   **Rejected from the skill:** its suggested palette, IBM Plex fonts and landing-page patterns.
   **Why:** they don't fit a dark, content-first editor whose chrome must stay quieter than
   the slide.
6. **`lucide-react` 1.67.0** for icons (ISC license; pinned past the minimum release age).
   **Why:** tree-shakable SVG icons with a consistent stroke, and a permissive license.

### D40: Custom dropdowns and quiet scrollbars (2026-11-18)

1. **A hand-rolled `Select` replaces every native `<select>`** (`components/Select.tsx`). It
   follows the WAI-ARIA "select-only combobox" pattern: focus stays on the trigger,
   `aria-activedescendant` marks the highlighted option, and the keyboard matches a native
   select. The keyboard logic is pure and tested (`model/listbox.ts`). **Why:** the native
   popup is drawn by the OS, so it can't follow the theme and looked dated. A library (Radix,
   MIT) would also work, but it adds about a dozen packages for one control.
   **Not used:** `appearance: base-select`. It is Chromium-only, so the editor would look
   different in other browsers during development.
2. **While open, the popup follows its trigger when a panel scrolls**, and it closes once the
   trigger is out of sight. **Why:** closing on any scroll fought inertial touchpad scrolling,
   whose late scroll events closed the popup right after it opened (seen in a browser test).
3. **Scrollbars have no track and no arrow buttons; the thumb is a slim pill** that brightens
   while the pointer is over the panel. Chromium (Electron) is styled with `::-webkit-scrollbar`.
   The standard `scrollbar-width`/`scrollbar-color` properties go only to engines without it.
   **Why:** Chromium ignores the webkit rules once the standard properties are set, and the
   standard ones can't hide the arrow buttons.

### D41: Scrubbable numbers, live previews, tooltips and switches (2026-11-18)

1. **Live previews are local** (`preview.ts`). While a number is scrubbed or nudged, its ops
   are applied to a copy of the deck that only this tab's canvas renders; one transaction is
   sent when the gesture ends (pointer up, key up, blur). **Why:** D39's "preview locally,
   commit once": a drag stays one undo step and one message, and other clients never see
   half-finished values. The preview is dropped when the transaction resolves; the server
   sends `change` before `result`, so the value never flashes back.
2. **The inspector reads the committed deck, never the preview**; fields show their in-flight
   value themselves. **Why:** a field compares against its committed value to decide whether
   anything changed and what Esc restores. Comparing against the preview would discard every
   scrub.
3. **Scrub feel:** one step per pixel, Shift 10×, Alt 1/10, a 3 px threshold so a label
   click still focuses the field, clamping without a dead zone, and Esc to cancel. ↑/↓ nudge
   with the same modifiers. Rounding applies to the change, not the value, so set precision
   survives (60.5 → 61.5). The math is pure and tested (`model/scrub.ts`).
4. **An unset number scrubs from what you see.** The order is the schema's `default`, then
   the rendered CSS property of the same name (`fontSize` → `font-size`) if it fits the
   field's bounds, then the minimum. **Why:** text sizes come from style tokens, so starting
   from 0 would jump. Reading by CSS name keeps the editor free of plugin-specific code.
   `exclusiveMinimum` (`.positive()`) now maps to a minimum just above the bound.
5. **One global tooltip layer** (`data-tip`, `data-keys`) replaces `title`. It has a 500 ms
   delay, instant neighbours, shows on keyboard focus, is dismissible and hoverable
   (WCAG 1.4.13), and shows platform shortcut chips. **Why:** native tooltips are slow,
   unstyled and mouse-only. One document listener is cheaper than a wrapper per button.
6. **Switches are real checkboxes** (`role="switch"`) drawn with background gradients, which
   work in every engine. Textareas grow with `field-sizing: content`; engines without it keep
   a resize grip.
7. **`tests/integration/phase3-editor.test.ts`** drives these controls in real Chromium and
   counts the transactions the server receives.
