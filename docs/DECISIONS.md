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
lets `{ layout: { mode: "grid", columns: 3 } }` work in one call. Extended by D52 (the shape
rule for untagged unions like `padding`).

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

### D42: Infinite scrubbing with pointer lock (2026-11-18)

1. **A scrub that reaches the window's left or right edge locks the pointer** (Pointer Lock
   API). Movement keeps arriving past the edge, and a virtual cursor wraps around the window
   (`components/virtual-cursor.ts`), Blender style. On release the lock is dropped and the
   real cursor reappears where it froze. **Why:** a page can't move the OS cursor, as Blender
   does. Pointer lock is the standard web equivalent and works in Electron.
2. **The lock is only requested at the edge (16 px zone), not when a scrub starts.** Short
   scrubs (most of them) never lock. **Why:** in a browser tab, Chrome shows a "Press Esc
   to show your cursor" notice whenever the lock engages, and the page can't hide it. Users
   found it annoying on every scrub; now it only appears when a scrub really goes past the
   edge. A plain label click never locks. Chrome grants the lock seconds after the press
   (tested at 6 s); if it ever refuses, the fallback below applies.
3. **Robustness:**
   - "Locked" is read from `document.pointerLockElement` on every event, because it is set
     before the `pointerlockchange` event fires.
   - The first event after locking and jumps over 300 px are ignored, because Chromium
     reports a bogus jump when the lock engages.
   - Losing the lock mid-scrub (Esc in a browser, switching windows) cancels, like Esc.
   - Engaging the lock releases pointer capture, which is not treated as the end of the
     gesture.
   - Accelerated (OS) movement is used: `unadjustedMovement` isn't supported everywhere, and
     accelerated movement feels like the normal cursor.
4. **Fallback:** when the lock is refused (no API, or Chrome's cooldown right after Esc), the
   scrub works as before and stops at the screen edge.
5. **Tests:** headless Chromium emulates the lock by snapping its synthetic cursor back after
   each move (+N, then -N), so real mouse moves can't drive a locked scrub. The suite refuses
   the lock by default, which covers the fallback path. The locked tests take a real press
   and a real lock, then deliver movement events directly. They check wrapping, the
   ignored glitch events, one transaction, and the cancel on lock loss.
6. **Test stability:** after waiting for the server, tests also wait for the editor to receive
   and paint that version (`synced()`). Without that, CI once pressed Space on a switch that
   still showed the old state. `VELOCE_TEST_CPU_THROTTLE=4` runs the suite on a 4× slower
   CPU, which it passes. Past that, headless Chromium's own pointer-lock emulation stalls,
   even on a blank page (2 fps at 8×), so higher rates aren't meaningful.

### D43: Direct manipulation on the canvas without Moveable (2026-11-18)

1. **Own handles and geometry instead of Moveable.** Pure maths in `apps/editor/src/model/`
   (`geometry.ts`: anchored/rotated resizing, rotation; `snapping.ts`; `reorder.ts`: insertion
   slots and drop targets; `manipulate.ts`: the ops), a small DOM bridge
   (`components/canvas-space.ts`) and three drag objects (`components/canvas-drags.ts`).
   **Why:** Moveable drives CSS transforms on the target element, but our layers are placed
   by the layout engine (golden rule 4) and every change must be a previewed op, not a DOM
   mutation (D39, D41). Most of the work (reordering stacks, dropping into frames) is
   structural, which Moveable doesn't do. Owning ~600 lines of pure, unit-tested geometry
   beats adapting a large dependency. This supersedes "Moveable" in the stack list.
2. **What a drag does depends on the parent frame.** In a free (absolute) frame it changes
   `position`, snapping edges and centres to siblings and the frame's content box (6 screen
   px, magenta guides). In a stack or grid it reorders, live. Over another frame it drops
   into it (`node.move`; entering a free frame sets `position`, leaving one removes it). Near
   the edge of a frame that sits in a row/column means "beside it". Ctrl/Cmd keeps the layer
   in its frame; Alt turns snapping off; Shift locks the axis. **Why:** the default slide
   root is a stack, so for most decks "move" is really "reorder" (Figma's auto-layout
   behaviour, which designers already know).
3. **Drop targets and slots use the layout frozen at drag start.** **Why:** the live preview
   reflows the layout under the pointer. Hit-testing the live DOM oscillates (a hugging
   stack shrinks when its child leaves, the pointer exits it, the child comes back…).
4. **Resize keeps the opposite side fixed, also for rotated layers** (movement measured along
   the layer's own axes). Sides change one dimension (a text keeps its "hug" height),
   corners both; Shift keeps the ratio, Alt resizes around the centre. Sizes are whole
   pixels, rounded _before_ anchoring so the anchor never drifts. The rotate knob sits below
   the layer (Shift: 15° steps), so it never collides with the name tag.
5. **Same contract as scrubbing (D41):** preview locally once per frame, ONE transaction on
   release, Esc/blur cancels without a trace. Pointer capture starts only when a press
   becomes a drag. **Why:** while captured, Chrome sends click/dblclick to the capturing
   element, which broke double-click drill-in (caught by the browser test). The capture is
   on the canvas, never on a handle (handles can unmount mid-drag).
6. **Keyboard path (WCAG 2.5.7):** arrow keys move free layers by 1 px (Shift 10). Held keys
   preview, and releasing the last one commits one transaction. Stack layers reorder with
   Alt+↑/↓; sizes and rotation are in the inspector.
7. **Tests:** pure modules are unit-tested; `tests/integration/phase3-canvas.test.ts` drives
   every gesture in Chromium (one transaction each, exact stored values, undo). The browser
   suites share `tests/integration/editor-harness.ts`.

### D44: Typing on the slide with TipTap, inside the layer's own box (2026-11-19)

Double-click a text layer (or press Enter with it selected) to edit it in place.

1. **TipTap 3 (`@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, pinned 3.33.1, MIT; ProseMirror
   and linkifyjs underneath, MIT)**, used through `@tiptap/core` directly (no `@tiptap/react`:
   the editor mounts imperatively into the stage). Limited to what the core rich text model
   holds: headings, quotes, code blocks, rules and hard breaks are off. A heading is a text
   _style_ here (`$text.h1`), not a node type. **Why:** ProseMirror is the proven model for
   rich text with an explicit schema. A bare `contenteditable` would have us re-implementing
   selection, marks, lists and paste normalisation.
2. **Pure mapping in `apps/editor/src/model/rich-text-doc.ts`.** Flat paragraphs tagged
   `list` + `level` become nested `bulletList > listItem > paragraph`, grouped exactly like the
   renderer groups `<ul>`/`<ol>`. Coming back, the tree is flattened, adjacent runs with the
   same marks merge, and every value is re-validated with the core schemas (links, colors,
   text style tokens). Unformatted text goes back to the plain string form. Paragraph
   alignment and text style are global attributes; color is our own mark that keeps the core
   value (a token stays a token). **Why:** pasted HTML must never produce a transaction the
   server refuses (the whole edit would be lost) or a `javascript:` link. A no-op edit must
   not change the stored form either.
3. **The editor lives inside the layer's DOM box on the stage.** It mirrors the text plugin's
   box style, and the plugin's own render stays underneath (`visibility: hidden`). **Why:**
   it inherits the stage scale, ancestor rotations, theme CSS variables and fonts for free,
   so the text doesn't move when editing starts (the browser test checks every glyph to
   within 0.5 px). The hidden render, fed by the live preview, keeps laying the slide out,
   so a hug-height box grows and its stack reflows as you type. The renderer only rewrites
   its own child and the box's inline style, so the extra child and the `data-text-editing`
   attribute survive re-renders. Limited to the built-in `text` type for now. Other plugins
   would need a plugin API hook to declare an editable rich text prop and its box style.
4. **Same contract as every gesture (D41):** typing only previews (once per frame). Ending the
   session commits ONE `node.update` of `props.content` ("Edit text …"), so a whole typing
   session is one undo step; inside it, Ctrl+Z is TipTap's own history. It ends on Esc (the
   layer stays selected), a press elsewhere on the canvas, a selection change, the layer
   being deleted (nothing is sent then), or a slide/deck switch. "Follow the AI" doesn't jump
   slides while you type.
5. **Floating toolbar** (bold, italic, underline, strike, code, bulleted/numbered list, link)
   above the layer, outside the `aria-hidden` overlay, `role="toolbar"`. Buttons keep focus in
   the editor. Links use an inline field, not `window.prompt` (Electron has none). Bare
   addresses are completed (`veloce.dev` → `https://…`, `a@b.co` → `mailto:`) and other
   schemes are refused. Text color and per-paragraph style/alignment round-trip but have no
   toolbar controls yet.
6. **TipTap is a lazy chunk** (~122 KB gzip). It's prefetched as soon as a text layer is
   selected, so the main bundle grew only ~4 KB. **Why:** most sessions never type on the
   slide, and startup matters more than the first keystroke after a double-click.

### D45: Marquee, spacing indicators, slide dragging and the clipboard (2026-11-19)

1. **Marquee:** dragging on the empty canvas (or from a locked layer) selects every layer the
   box touches, live. It catches top-level layers, or the deepest ones with Ctrl/Cmd, never
   locked or hidden ones. Shift adds to the selection. It runs through the canvas gesture
   engine (D43) as a drag whose command is always null. **Why touch, not contain:** that's
   what Figma and Keynote do, so a quick sweep is enough.
2. **Spacing indicators** (red, with a number): while moving or resizing an unrotated free
   layer, the gap to the nearest neighbour that faces each side (same row or column), else
   to the frame's content edge. With Alt held, the gaps between the selection and the
   hovered layer: the four inner gaps when one contains the other, the horizontal and
   vertical gaps when they're apart. With nothing else hovered, it measures to the
   selection's parent (the slide edges at the top level). Pure maths in `model/spacing.ts`.
3. **Slide dragging in the rail:** pointer events, not HTML5 drag-and-drop. **Why:** we need a
   click/drag threshold, an insertion line, Esc to cancel and auto-scroll near the edges.
   HTML5 DnD gives none of those reliably, and its drag image can't be styled. The rows are
   measured once at the start (as on the canvas), and the slot comes from the same
   `insertionIndex` as stack reordering. One `slide.move`, and the moved slide is selected.
   Alt+↑/↓ stays the keyboard path.
4. **Clipboard through the real `copy`/`cut`/`paste` events,** not key handlers. The payload is
   the copied layers as JSON under `application/x-veloce+json`, plus a plain-text version.
   **Why:** the system clipboard carries it between slides, decks, editor tabs and restarts,
   and the browser's Edit menu works too. Text fields and the on-slide text editor keep
   their own clipboard.
   - **Where a paste lands:** nothing selected → the slide; one other frame selected →
     inside it; otherwise → right after the selection.
   - **What the paste looks like:** fresh IDs everywhere. In free frames the position is
     kept, shifted 20 px while it's taken; in stacks and grids it's dropped.
   - **Validation:** the payload is re-validated with `NodeSchema` before use.
   - **Text from other apps** becomes a new text layer.
   - **Images from another deck** are refused with a clear message, because core rejects
     references to assets the deck doesn't have. Copying the asset files along belongs to
     asset import.

### D46: A history panel fed by a server-side log (2026-11-19)

1. **The doc-server keeps the history, not the editor.** Each open deck keeps a bounded log
   (`HISTORY_LIMIT` = 500) of `{ version, origin, label, slideIds, at }`. It's sent in the
   `snapshot`, and every `change` message now carries the server's timestamp `at`. **Why:**
   the AI usually builds a deck _before_ anyone opens the editor (and tabs reload), so a
   client-only log would start empty exactly when it's most interesting. Adding fields keeps
   the protocol compatible (`SYNC_PROTOCOL_VERSION` stays 1; the client tolerates an older
   server without `history`).
2. **Session-only, not saved** in the `.veloce` file. **Why:** undo stacks are per session
   too, and saving history is a file-format decision (size, privacy of agent activity) for
   later. When the server restarts, the history starts fresh.
3. **The panel** is a third left-panel tab. It lists changes newest first, grouped into runs
   by author (You / the agent's name from its MCP client). It shows the slides each change
   touched (click to go there), how long ago, and an All / You / AI filter. **Undo stays per
   origin (golden rule #7):** the panel shows the AI's changes, but Ctrl+Z only ever takes
   back yours, and the panel's footer says so.
4. **One name helper:** `originName` in `model/history.ts` replaces the top bar's own copy.
   The panel's root class is `.history-panel`: `.history` was already the top bar's
   undo/redo group, and the clash stacked those buttons vertically. A browser test now
   checks that layout.

### D47: Theme picker, palette and font editing, token-aware pickers (2026-11-19)

1. **Theme changes are whole-theme `deck.setTheme` ops** (the op the AI's `set_theme` sends),
   built by pure helpers in `model/theme-edit.ts`. **Why:** golden rule #1 (same ops for
   humans and agents), and swapping a theme or one token restyles every slide at once and is
   one undo step. Editing a token renames the theme "Name (custom)" once, so the picker and
   the AI can tell a tweaked theme from the built-in one (`builtinIdOf` compares by value).
2. **The Theme section lives in the inspector when nothing is selected**, under the slide's
   settings: built-in theme cards (each previewed in its own background, heading font and
   colors), the palette (each swatch opens the system color picker), contrast warnings, and
   one font picker per font token. **Why:** it's the deck-level equivalent of "properties of
   the selection", where Figma and Keynote put document settings; no new panel or modal.
3. **Native `<input type="color">`, wired to the gesture contract (D41)** by
   `useColorPicker`: the `input` event previews (once per frame), the native `change` event
   (the picker closing) commits one transaction. **Why:** no color-picker dependency, it's
   accessible, and the OS picker has an eyedropper. Trade-off: no alpha, so editing a
   translucent token makes it opaque. The hook binds through a callback ref, so a picker that
   mounts later (a gradient replaced by a color) still gets its listeners.
4. **Contrast warnings in the palette** check the pairs slides lean on most (text and muted
   on background/surface: 4.5:1; primary on background: 3:1; on-primary on primary: 4.5:1),
   the same WCAG math lint uses. **Why:** a bad palette breaks every slide at once; it should
   be caught where it's made, not slide by slide in lint.
5. **Four more bundled fonts (OFL 1.1, @fontsource-variable, pinned 5.3.0):** Manrope, Space
   Grotesk, Fraunces, Lora, alongside Inter and JetBrains Mono. Core's `BUNDLED_FONTS`
   catalogs them (family, stack, category, one-line note) for the editor's font picker and
   the AI's `get_docs("theme")`. Only Inter and JetBrains Mono load at startup; the rest load
   when a slide uses them (`document.fonts.ready` covers measurement). Two new built-in themes
   use them: **Paper** (Fraunces + Lora, warm light) and **Studio** (Space Grotesk + Manrope,
   dark with an electric lime). A test makes sure every built-in theme only uses bundled fonts.
   **Why:** a deck must look identical on every machine and in headless previews, and
   "pick any system font" breaks that. Arbitrary fonts arrive with asset import (font files
   in the `.veloce` zip).
6. **Token-aware pickers:** font and text-style dropdowns show each option in its own
   typeface (`SelectOption.fontFamily`). A color field holding a raw hex offers "Use theme
   color 'x'": the nearest theme color by redmean distance. **Why:** raw colors don't follow
   theme switches; one click puts a stray color back on the theme.
7. **Undo passes through dropdowns.** The shortcut guard treated our `Select` trigger
   (`role="combobox"`) like a text field, so Ctrl+Z did nothing right after picking from any
   inspector dropdown until focus moved. Undo/redo now pass through non-text comboboxes
   (`deckKeysPassThrough`; D48 extends it to copy and paste); every other shortcut is still
   blocked there.
   `tests/integration/phase3-theme.test.ts` covers it.
8. **Inspector spacing rhythm:** sections are divided by a rule with 18–20px of padding, rows
   inside are 10px apart, and a titled `Group` inside a section ("Colors", "Fonts") adds 12px
   above a smaller sentence-case heading. History author groups follow the same spacing.
   Section titles use a class (`.inspector-section-title`), not `.inspector-section h3`:
   that descendant rule made every heading inside a section look like a section title.
9. **No in-app logo or wordmark.** The top bar opens with the deck: title (or the deck
   picker), slide position, undo/redo. The app's name lives in the window/tab title
   ("Deck title – Veloce"), as in Figma, Keynote and other professional tools. **Why:** a
   gradient logo plus name in the toolbar read as toy-like, and the document should lead.
   App identity belongs to the OS chrome (window title, dock/taskbar icon, About dialog).

## D48 — Asset import: the server decides what a file is; one transaction per import

**Status:** Accepted (2026-11-19)

Images and fonts get into a deck by dropping them on the canvas, pasting (a screenshot or
copied files), "Replace…" on an image, "Add font file…" in the theme, copying layers from
another deck, or the agent's new `add_asset` MCP tool.

1. **Upload, then one transaction.** Clients `POST /api/decks/:id/assets` with the raw bytes.
   The doc-server inspects them, stores the content-hashed file and replies `{ id, info }`.
   Nothing is in the document yet. The client then commits `asset.add` together with the
   layers that use it (or the theme change, or the swapped image prop) as **one**
   transaction, so a drop is a single undo step. That's the same `asset.add` op the agent
   uses (golden rule #1). Unreferenced uploads are just bytes in the store, never in the
   saved `.veloce` (the writer only packs registered assets).
   **Why:** the server stays the only writer of bytes, and the document stays ops-only;
   upload progress and failure never leave a half-applied transaction behind.
2. **The server sniffs bytes; nothing trusts the client.** `inspectAsset` reads magic bytes
   and headers: PNG, JPEG (SOF scan), GIF, WebP (VP8/VP8L/VP8X), AVIF (`ftyp` + `ispe`), and
   SVG (root `<svg>` after BOM/declaration/comments/doctype); fonts TTF/OTF/WOFF/WOFF2
   (collections refused). The declared MIME type and extension are ignored. `asset.add` is
   refused (`INVALID`, "use the asset info the upload returned") unless its mime and size
   match what the server inspected, so a client can't relabel an SVG as a PNG. SVG stays
   `<img>`-only (Phase 1 rule).
   **Why:** the file lands in a FOSS app's documents that other people open, so the
   server is the security boundary, not the browser.
3. **Upload hardening.** It requires an `x-veloce-upload: 1` header (a cross-site form
   can't set it, so a hostile page can't push files into a deck, on top of D34's
   Host/Origin checks). It is capped at 50 MiB (`MAX_ASSET_BYTES`), by `content-length` and
   again while streaming. The file name comes URI-encoded in `x-veloce-filename`, and only
   its basename is kept. Errors are 403/404/413/415 with a reason the editor shows as a
   toast.
4. **Fonts are named by the file.** The server reads the `name` table (typographic family,
   nameID 16, else nameID 1), OS/2 weight/italic, and the `fvar` `wght` range. It
   decompresses WOFF with zlib and WOFF2 with brotli, with output caps. Variable fonts
   without nameID 16 get trailing style words stripped ("Manrope ExtraLight" → "Manrope").
   It falls back to the file name. The result is stored as `AssetInfo.font`
   `{ family, weight (number or [min,max]), style }`, an **additive, optional field**:
   format v1 hasn't shipped, so no migration. Editor tabs and the render page register
   each deck font as a `FontFace` (`deck-fonts.ts`), swapping the set when the deck
   changes, and the canvas re-measures on `loadingdone`. Theme font pickers list deck
   fonts first (hint "deck"), as the stack `"Family", system-ui, sans-serif`.
   **Why:** users and agents pick fonts by family name; requiring them to type it would
   break on the first file whose name doesn't match its family.
5. **Placement.** Dropped images are centered on the drop point, inside the deepest free
   (absolute) frame under it that isn't locked or hidden. They keep their own pixel size,
   shrunk to at most 60% of that frame and never upscaled. Several files cascade by 24px.
   Pasted files go where pasted layers go. In stacks and grids they're appended, and the
   layout places them (golden rule #4). Replacing an image keeps the layer's box and
   removes the old file when nothing else uses it.
6. **Cross-deck paste copies files.** The clipboard payload records the source deck and the
   infos of the assets the copied layers use. On paste into another deck, the editor
   fetches each missing file from the source deck and uploads it to this one, then pastes:
   `asset.add` + nodes in one transaction. If the source deck is gone, the paste is
   refused with a reason, and never yields layers pointing at missing files.
7. **`add_asset` (MCP, tool 14).** It takes `files: [{ path } | { data, name }]`, 1–20 per
   call. Paths must be absolute regular files under the size cap, and base64 is accepted for
   generated images. It's one commit for all files, deduplicated. Its reply gives each
   image's `"asset:<id>"` with a usage example, and each font's family with a `set_theme`
   example. Deck fonts also appear in `get_docs` (theme section).
   **Why:** agents need images (logos, charts, photos) and brand fonts, and a path is
   cheaper than pasting megabytes of base64 into a tool call.
8. **Dropdown triggers pass copy/paste through.** `undoPassesThrough` from D47 §7 is now
   `deckKeysPassThrough` and also covers the clipboard. Ctrl+V right after switching decks
   in the deck picker did nothing, because focus stayed on that combobox.

`tests/integration/phase3-assets.test.ts` covers this in real Chromium: drop (position,
one transaction, undo), refusals, screenshot paste, cross-deck paste, Replace…, and a font
dropped → offered in the theme → rendering. HTTP and MCP paths are covered in
`phase2.test.ts` and `mcp.test.ts`.

## D49 — Free positioning per layer: `positioning: "free"`, one shared rule

**Status:** Accepted (2026-11-19). Extends D43 §2 (what Ctrl/Cmd does in a move).
Amended by D58: positions are measured from the frame's edges, not its content box.

Agents build slides as stacks and grids (golden rule 4), so a person could only reorder
layers, never put one where they wanted. Now any layer in a stack or grid can leave the flow
and sit at its own position on top of it, like Figma's "ignore auto layout".

1. **An explicit field: `positioning?: "auto" | "free"`** on every node, next to
   `position`. It's optional and additive. Format v1 hasn't shipped, so there's no migration
   (same call as D48 §4). **Why:** a `position` alone can't mean "free". Decks already carry
   stale positions on stack children (left over from switching a frame out of absolute), and
   agents write `position` in stacks expecting it to work. An enum matches the inspector
   (Position: Auto / Free) and Figma's `layoutPositioning`, and leaves room to grow.
2. **One rule: `isFreeLayer(node, parentLayout)` in core.** A layer is placed by its own
   position if its parent is absolute, or if it's `"free"` in a stack or grid. The root never
   is. The renderer, the editor's `isFree`, paste, lint and the MCP outline all call this
   one rule. Free children of stacks and grids get exactly the CSS of absolute-frame children.
   They're absolutely positioned from the content box, so flexbox and grid close up around
   them. They paint in document order, the same as everything else.
3. **Going free never jumps.** The position comes from the layer's layout offset in its frame
   (`offsetLeft/Top` minus the padding). That ignores transforms, so rotation and the canvas
   zoom can't skew it. Sizes that the flow was stretching get baked to pixels (`freeSizing`).
   That covers `fill`, `auto` across a stretching stack, and a grid cell's width (and its
   height, unless aligned). `auto` that was fitting its content becomes `hug`. Fixed and hug
   sizes stay. It's one transaction; Auto removes `positioning` and `position` again.
4. **Ctrl/Cmd-drag pulls a layer out of its stack** at the spot you let go. D43 already made
   Ctrl/Cmd mean "stay in this frame", so this extends it to "stay in this frame, right
   here". It's read live, so pressing or releasing it mid-drag switches between reorder and
   place. While pulling, the layer snaps only to the frame's content box, because its
   siblings are reflowing and their start rectangles would be stale guides. Free layers then
   move, nudge, snap and resize by position like any free-frame child. **Why Ctrl:** Alt
   (no snap) and Shift (axis lock) were taken, and the old Ctrl-only reorder within the
   frame is still the default whenever the pointer stays in that frame.
5. **Free siblings aren't reorder slots.** Insertion works on the flowing siblings, and
   `childIndexForSlot` maps the slot back to a child index. A layer dropped after the last
   flowing sibling goes before any trailing free ones, so those stay on top.
6. **Changing frames resets it.** Dropping a free layer into another frame clears
   `positioning`, because "free" was about the frame it was freed in. Pasting keeps free
   layers free in stacks (stepping off taken spots like D45 pastes) and drops the flag in
   absolute frames. Switching a frame from absolute to stack or grid clears its children's
   now-ignored positions in the same transaction.
7. **Agents:** the MCP node input documents `positioning`. `get_docs("layout")` has a "Free
   layers" section (badges, stickers, arrows on top of a flow). The outline marks
   `[free at x,y]`. A new lint rule, `ignored-position` (warning), names any `position` a
   stack or grid ignores and offers both fixes: add `positioning: "free"` or remove the
   position.

`tests/integration/phase3-free.test.ts` covers this in real Chromium. Free layers render out
of the flow. Inspector Free doesn't move the layer by a pixel, and the flow closes up. Ctrl-drag
pulls a layer out. Free layers move by position without reordering, and reorders skip them.
Every gesture is one undo step.

## D50 — Switching a frame to Free pins everything where it was

**Status:** Accepted (2026-11-19). Builds on D49.

Switching a stack or grid to Free (absolute) used to pile every child at 0,0, and a frame
that hugged its content collapsed. Now nothing on screen moves.

1. **One transaction: `switchLayout`** (in `model/manipulate.ts`). It contains the layout
   change and the ops from `freezeFrameOps`. Each child gets its measured layout offset as
   `position`, plus `freeSizing` for what the flow was stretching (D49 §3). Children that
   were already `"free"` keep their position and drop the flag, which is redundant in an
   absolute frame. Hidden children can't be measured, so they're left as they are.
2. **The frame keeps its own size.** Free children don't size their frame. So on each axis
   where the frame was fitting its content (`hug`, or `auto` that its parent doesn't stretch,
   `stretchedBy`), its rendered pixels are baked. Stretched or fixed axes stay, and the
   root always fills the stage.
3. **The new layout is sent whole.** Core replaces a layout object when its `mode` changes
   (the discriminator rule, json.ts). The old editor-side `replacePatch` only sent the keys
   that changed, so every mode switch silently **lost the frame's padding**. Padding now
   always carries over, and gap carries over between stack and grid. `replacePatch` is
   removed.
4. **Going back to a stack or grid** removes the positions the flow would ignore (D49 §6).
   Sizes that were baked stay baked. Undo is the way back to the exact earlier layout.
   **Why:** guessing which pixel widths were "really" `fill` would be wrong as often as right.

Agents switching a frame over MCP get no baking (they describe structure and set their own
positions; lint's `ignored-position` and `off-canvas` catch mistakes).
`tests/integration/phase3-free.test.ts` checks in Chromium that the frame and its children
stay within 1px, in one undo step.

## D51 — Layers panel drag and drop: pointer-driven, frozen panel, one move command

**Status:** Accepted (2026-11-19).

Rows in the Layers panel can be dragged to reorder layers, or to move them into and out of
frames, by themselves or with the whole selection.

1. **Pointer events, not HTML5 drag and drop.** **Why:** we need a live canvas preview, our
   own indicator, Escape to cancel, and the same 4 px threshold as the canvas, so a click
   still selects. Native DnD gives a ghost image and none of the rest.
2. **Drop zones (`layerDropAt`, pure).** Ordinary rows split into halves: before or after.
   Frame rows split into quarters: top = before, middle half = **into** (appended to its
   children), bottom = after. Below an expanded frame, "after" means before its first
   child, which is what's drawn right underneath. Below the last child of a frame, the
   pointer's x picks the level, Figma-style: drag left to drop after the frame (or after
   its own parent, and so on). Locked frames and a layer's own subtree refuse drops. A line
   with a ring, indented to the drop's depth, or an outlined frame row, shows where the
   layers go.
3. **One command (`moveLayers`, pure).** It takes the top-level selected layers in document
   order, and the target is "in parent P before sibling S", skipping past dragged siblings.
   It replays the moves on plain child lists to get each `node.move` index, because every
   move shifts the next one's. Layers that change frames follow the canvas rules (D43,
   D49): entering a Free frame, they keep their spot on the slide (measured at the press);
   entering a stack or grid, they drop `position`; and they always drop `positioning`.
4. **The panel is frozen while dragging.** It keeps rendering the slide from the press,
   while the canvas shows the live preview. **Why:** the preview reorders the document, and
   rows moving under the pointer would make the target oscillate (D43 §3, same lesson).
5. Panel order stays document order (first child on top), not Figma's paint order (last
   child on top). **Why:** decks are mostly stacks, where document order _is_ top-to-bottom
   on the slide.

`model/layer-drop.test.ts` covers the zones and the move replay.
`tests/integration/phase3-layers.test.ts` checks in Chromium: reorder, drop into a frame,
pull out to the left, drop into a free frame without moving, Escape, and click-to-select.

## D52 — Merge patch "shape rule": switching `padding` to another form replaces it

**Status:** Accepted (2026-11-19). Extends D18.

`padding` is a number/token, `{ x, y }`, or `{ top, right, bottom, left }`. The two object
forms have no tag, so D18's discriminator rule didn't apply. Patching `{ x, y }` with
`{ top, … }` merged into `{ x, y, top, … }`, which matches no form, and failed with a bare
`set.layout.padding: Invalid input`. An agent run hit this, and the workaround it had to
guess was `"x": null, "y": null`.

1. **The shape rule.** In `json.ts`, fields whose object forms have disjoint keys are listed
   by field name (only `padding` today). When a patch's first non-null form key belongs to
   a different form than the target's, the object is replaced, not merged. `diffPatch`
   applies the same rule, so undo inverses stay exact
   (`mergePatch(from, diffPatch(from, to)) = to`). **Why per field name:** plugin props are
   arbitrary JSON, and `{ x }` merged with `{ top }` must still merge there (the same
   scoping D18 uses for `type`).
2. **Errors say how to fix the call.** `PaddingSchema` has its own union message: one form,
   pixels/token, `{ x, y }`, or `{ top, right, bottom, left }`, "not a mix of the two
   objects". A bad value inside a valid form is still reported at that value
   (`padding.left: Too small`).
3. **Swept for the same trap.** Every other union in core and the built-in plugins is either
   tagged (layout `mode`, paint `type`) or a union with primitives, which merge patch
   replaces anyway. Future untagged unions of objects (anchors were designed with a single
   `{ x, y }` shape partly for this reason) go in the same table.

`json.test.ts` covers the rule and the `diffPatch` round trips. `ops.test.ts` switches a
frame's padding form through `node.update` and back with its inverse, and checks the error
wording.

## D53 — Product shape: Blender-style workspaces, Figma-clean panels, and a 1.0 line

**Status:** Accepted (2026-11-19).

The user's direction for the app: a Blender and Figma hybrid. Blender's **workspaces**, one
per kind of work (designing, animating, presenting, later 3D), and its app-level menus and
Preferences. Figma's **easy panels**, with the important options always in reach.

1. **Workspaces are views, not modes of the document.** Each workspace is a preset of panels
   over the same deck, the same ops and the same server (golden rules 1 and 2), so nothing in
   core changes per workspace. **Why:** the editor is already a client; Blender works the
   same way (one file, many workspaces).
2. **Fixed presets first.** Panels resize and collapse, but there's no Blender-style "split
   any area into any editor" before 1.0. **Why:** that freedom is a large part of why Blender
   is hard to learn, and "Figma-easy" is half the goal. Custom layouts wait for user demand.
3. **A workspace appears only when its phase ships.** Design now; Animate and Present with
   Phase 4; 3D after 1.0. No empty tabs.
4. **AI stays global.** The deck switcher, Follow AI / Live and Present stay in the top bar on
   every workspace. **Why:** AI-first means agent activity is never hidden in one workspace.
5. **Preferences are app settings, not document content.** They're stored in a user settings
   file owned by the server, outside `.veloce` files and outside ops. Deck-level settings
   (stage size, theme) stay in the deck. GPU choice is a launch switch, so it arrives with
   Electron (Phase 6) and needs a restart.
6. **The app shell comes before Motion** (Phase 3, round 5). **Why:** Phase 4 then lands as
   the Animate and Present workspaces instead of being squeezed into today's screen and
   rebuilt later.
7. **A 1.0 shipping line.** The roadmap's phases hold only 1.0 work; everything else waits in
   "After 1.0" (3D, custom layouts, PPTX, phone remote, recording, suggestion mode,
   community plugins…). **Why:** the user wants to ship; a roadmap where everything is
   "next" never ships. Items move up only when the user says so.

## D54 — Group and ungroup keep every pixel where the layout allows it

**Status:** Accepted (2026-11-19). Extends D49 and D50.

Ctrl+G wraps the selection in a new frame named "Group"; Ctrl+Shift+G dissolves selected
frames into their parents. Both are editor op builders (`apps/editor/src/model/group.ts`)
over existing ops (`node.insert`, `node.move`, `node.update`, `node.remove`) in one
transaction. There's no new op and no MCP tool: an agent groups with the same ops.

1. **Two kinds of group, picked by how the members are placed.**
   - Members placed by a stack's or grid's flow get a **flow group** with the same layout
     (direction, gap, align, wrap; a grid keeps its gap with as many columns as it has
     members). It takes the first member's slot and fits its content. It fills the main
     axis when a member did, so the space stays taken.
   - Members placed freely (an absolute parent, or `positioning: "free"`) get a **free
     group**: an absolute frame cut to their bounding box, rotation included. Positions are
     rebased onto it, and it goes where the frontmost member was, so stacking order holds.

   **Why:** "keeps its layout" was the requirement. One rule for both kinds would either
   drag flow layers out of the flow (breaking agents' auto-layout slides) or reflow free
   layers.
2. **Mixed or cross-frame selections are refused with a toast** that says what to do, not
   guessed at. **Why:** a mix has no layout that keeps both kinds in place; cross-frame
   grouping would silently move layers.
3. **Ungroup keeps pixels whenever a child ends up free.** That's when the new parent is
   absolute, the child was free, or the frame was free. The child gets its measured spot,
   the frame's rotation added to its own, and the sizes the frame's flow was stretching
   (`freeSizing`, D50). Opacity and hidden carry over. Otherwise children join the parent's
   flow in the frame's slot. Fill, stroke and padding go with the frame, as in Figma.
4. **Measurements come from the canvas, the decisions from the model.** The model takes a
   `GroupMeasure` (sizes, sizing, `positionIn`), so it's unit-tested without a browser.

## D55 — Align and distribute act on free layers, on the slide

**Status:** Accepted (2026-11-19). Extends D49.

The inspector shows an alignment bar (left, horizontal centers, right, top, vertical
centers, bottom; distribute horizontally and vertically) with Figma's keys: Alt+A/H/D,
Alt+W/V/S, Alt+Shift+H/V. The keys are matched by physical key, because Alt+letter types
symbols on macOS. Op builders live in `apps/editor/src/model/align.ts`; each action is one
transaction of `node.update`s.

1. **Only free layers.** The bar appears, and the keys work, only when every selected layer
   is placed by `position`. **Why:** a stack's or grid's layout places its children
   (golden rule #4); there the frame's align/justify is the tool. Writing positions the
   flow ignores would trip the `ignored-position` lint.
2. **The geometry is on the slide.** Boxes come from the canvas (rotation included), so
   free layers in different frames align with each other. Each shift is turned back into
   the parent's space by undoing ancestor rotation.
3. **One layer aligns within its frame's content box** (as in Figma). Distribute needs
   three or more layers. It keeps the outer two in place and makes the gaps equal, even
   between boxes of different sizes.
4. **Moving bakes "fill" on that axis.** A free layer that fills its frame along an axis
   (text does by default) stretches to the frame's far edge, so moving it would resize it.
   Moving bakes that size to its rendered pixels, the same rule as going free (D49/D50).
   A layer that doesn't move keeps "fill".

## D56 — Layers panel: Shift selects a range, Ctrl/Cmd toggles; the canvas keeps Shift

**Status:** Accepted (2026-11-19). Extends D39.

In the Layers panel, Shift+click selects every visible row from the anchor (the last row
clicked without Shift) to the clicked one, on top of what was selected when the anchor
was set. Shift-clicking again from the same anchor replaces the range, so it can shrink.
Ctrl/Cmd+click toggles one row. Pure logic in `apps/editor/src/model/layer-select.ts`.

- **Why:** this is how Figma's layer list and every file manager work. With align,
  distribute and group, selecting many layers became common, and one Shift-click per
  layer didn't scale.
- **The canvas keeps Shift = toggle.** Layers on a slide have no row order to make a range
  from. Figma's canvas also uses Shift to toggle, and Ctrl/Cmd on our canvas already means
  "pull out of the layout" when dragging (D49).
- **A stale anchor isn't trusted.** If the anchor is no longer selected or visible (a click
  on the canvas, a collapsed frame), the range starts from the last selected visible row.
  If there's none, Shift just adds the row: Shift never drops what was selected.
- Shift and Ctrl/Cmd presses never start a row drag (D51), so a selection click can't
  move a layer.

## D57 — Anchors: `position` measured from the frame's start, end or middle

**Status:** Accepted (2026-11-19). Extends D49.

Free layers get an optional `anchor: { x?, y? }` with `"start" | "center" | "end"` per axis
(default `"start"`, i.e. left/top as before). It's Figma's constraints, minus "scale" and
"left & right": the two cases agent decks actually hit are a badge in a card's corner and
something centred.

1. **`position` keeps its single `{ x, y }` shape; the anchor changes what it measures.**
   - `"end"`: the inset from the content box's right/bottom edge, positive inward (CSS
     `right`/`bottom`).
   - `"center"`: the offset of the layer's centre from the content box's centre.

   **Why:** no union of position shapes (the trap D52 fixed for padding), and existing
   decks, which have no anchor, mean exactly what they did. It's an optional field, so no
   migration.
2. **The renderer uses the matching CSS:** `right`/`bottom` for "end"; for "center", the
   midpoint plus a `translate(-50%)` placed before the rotation. "fill" takes the content
   box minus the inset from the anchored edge.
3. **The math lives in core** (`anchor.ts`): `shiftAnchored` (a move of the start edge plus
   any growth, in a layer's anchor), plus `startPosition` and `anchoredPosition`
   (conversions). Every editor gesture already computed "start edge + delta". Moves, resizes,
   nudges and align now route that delta through `movedPosition`, so they work unchanged
   for anchored layers. A resize keeps the anchored edge still.
4. **Switching the pin never moves the layer.** The inspector's Pin X / Pin Y convert the
   position using the layer's and the frame's layout sizes, which rotation doesn't change.
5. **An anchor belongs to its frame.** Moving a layer into another frame by dragging, putting
   it back in the flow, or switching its Free frame to a stack drops the anchor. Group and
   ungroup re-measure the layer on screen and drop it too. **Paste is the exception:** it keeps
   the anchor, so a badge copied from one card lands in the other card's corner.
6. **Agents** get the field with a description, a docs paragraph with a badge example, a
   `[free at 16,16 from top-right]` outline marker, and the `ignored-position` lint for an
   anchor the flow ignores.

## D58 — Free layers are measured from the frame's edges; strokes take no room

**Status:** Accepted (2026-11-19). Amends D49 and D57. From the first agent test of anchors.

An agent pinned a badge "16px from the top-right" and it landed 80px from the card's right
edge, because positions were measured inside the padding. Changing the padding moved the
badge, which contradicted our own docs. The agent had to wrap the card in an unpadded frame.
It also had to give the other cards invisible strokes to line up with a stroked one.

1. **`position` is measured from the frame's own edges, for every free layer** (in absolute
   frames and `positioning: "free"` in stacks/grids, with any anchor). **Why:** that's
   Figma's model, and what people and agents expect. Padding spaces a frame's flow; it was
   never meant to move layers that left the flow. Pinned corners now survive padding changes.
2. **Padding on an absolute frame does nothing**, so it isn't rendered. Lint flags it
   (`ignored-padding`), the inspector shows a hint instead of the field, and switching a
   frame to Free drops it (the frozen positions already include it). The schema still
   accepts it, so older decks and agents' habits don't fail validation.
3. **Strokes are an inset outline, not a border.** Adding a stroke never moves or shrinks
   the content (Figma's inside stroke). **Why:** a border took layout space, so a 4px stroke
   shifted text 4px and made stroked cards lay out differently from unstroked ones.
4. **No format migration** (format v1 is unshipped). Free layers inside padded frames shift
   by the padding. The user's decks were migrated once through the running server's MCP: 3
   layers in 2 decks, one undoable transaction per deck, after a backup. The script isn't
   idempotent, so it isn't kept in the repo.
5. **Editor measurements follow the frame's edges:** `offsetInParent`, `positionIn`,
   `frameSize` for anchors, align's single-layer container, and the drop corner in Free
   frames. Image drops already used the frame's outer box; they're consistent now.

The same feedback round also fixed:

- `empty-space` no longer flags centred slides (balanced bands) and ignores free layers.
  One small label in a corner used to count as filling an empty half.
- `overlap` gives free-layer advice (fill-width text needs `width: "hug"`).
- Theme docs say which deck's theme they describe.
- The layout docs cover negative offsets and how `fill` shares space after padding.
- The outline shows rotation.
