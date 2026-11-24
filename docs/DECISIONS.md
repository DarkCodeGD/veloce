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
and GSAP is just the default driver behind an `AnimationDriver` interface. (The driver is
Motion since D100; since D105 the timeline is our own, in core, and libraries only draw.)
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

**Superseded by D100** (Motion is the only bundled driver; GSAP isn't shipped).

Veloce is free and open-source. GSAP stays the default `AnimationDriver` (most battle-tested timelines);
**Motion** (motion.dev, MIT, formerly Framer Motion, vanilla JS API, Web Animations API based, seekable)
is the fallback driver. **Why:** GSAP is free but its license is not OSI-approved, which may conflict with
a GPL project license or distro packaging. Decks store animation _intent_, so switching drivers never
touches files. Final default depends on the project license (open question in ROADMAP).

### D15 — Apache-2.0 license (2026-11-18)

**Why:** permissive (friendly to plugin authors and companies building on Veloce) with an explicit
patent grant that MIT lacks. Compatible with GSAP's no-charge license being a non-OSI dependency
(moot since D100: GSAP isn't shipped).

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
**Partly superseded by D68:** each agent session now keeps its own target deck; the editor
still follows agents when they create or open one.

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
4. **No icon glyphs until the `icon` plugin lands (Phase 6).** The design docs tell agents not to
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
   schemes are refused. Text color and per-paragraph style/alignment round-trip; their
   toolbar controls came later (D61).
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
   **Superseded by D64** (the editor's own picker, with alpha).
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
   Electron (Phase 7) and needs a restart.
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

## D59 — A frame's overflow counts its flow children only

**Status:** Accepted (2026-11-19). From the agent retest of D58.

An agent hung a rotated "Save 20%" sticker 12px past a CTA card's corner, the pattern our docs
recommend. Lint reported it as an error, "children are 23px too tall". There was no way to say
it was intended, so the final lint run never came back clean.

1. **Free layers (absolutely positioned) don't count toward their frame's overflow.** The
   renderer's `measure` leaves them out of a frame's content extents. **Why:** they are placed
   by hand, so hanging past an edge is a design choice, not a frame too small for its
   content. The flow is where the "this doesn't fit" bugs come from, and it is still
   measured. A free layer's own content overflow (text too big for its fixed box) is still
   reported on it.
2. **Leaving the slide is still caught,** by `off-canvas`, for free layers too.
3. **This also applies to Free (absolute) frames.** Every child there is free, so they never
   report overflow. A fixed-size Free frame is a canvas you place things on, as in Figma,
   where content past a frame is shown unless the frame clips.
4. **Marking any finding as intentional** is a separate, wider feature (Phase 9), so it isn't
   bolted onto this rule.

## D60 — Canvas zoom and pan: a camera on the stage, as view state

**Status:** Accepted (2026-11-19).

1. **The renderer's StageView takes a camera** `{scale, x, y}`. `null` means fit, which
   thumbnails and playback keep using. Layout still runs at stage size and only the picture
   is transformed, so text wraps the same at every zoom. A set camera stays put when the
   window resizes; a fitted one refits.
2. **The math is pure** (`model/camera.ts`, unit-tested):
   - zoom keeps the point under the pointer still
   - preset steps
   - capped wheel factors: pinch is smooth, a mouse notch is about 22%
   - `keepVisible` keeps 64px of the slide on screen
   - `cameraFor` zooms to fit a rect (fit and Zoom to selection)
3. **Input follows Figma's keys.** Shift+digits are matched by `e.code` (Shift+1 types "!").
   Mod + "+" / "-" are matched by the character typed (`zoomKeyDirection`), because "+" sits
   on a different key on many layouts (German), where the physical-key match let the browser
   zoom the whole page instead. Space is claimed
   only while the pointer is over the canvas and nobody is typing, so a space typed into a
   text layer or a field stays a space. Handles hide while the hand tool is up.
4. **Updates land once per animation frame,** and nothing moves the camera while a drag
   runs, whichever input asks (wheel, keys, the zoom pill, a camera queued just before the
   drag began), so the drag's start coordinates stay valid. A window or slide-size change
   re-applies `keepVisible`, so shrinking the window can't strand a zoomed slide off-screen.
   A Space + double-click (two quick pans) is never a double-click on the canvas: it would
   hit no layer and clear the selection. A middle-button press on the canvas is the hand
   tool, never Linux's primary-selection paste: while it's down, `paste` / `beforeinput`
   (insertFromPaste) are swallowed in the capture phase, until the release has been handled
   (Figma does the same; otherwise every middle-drag over a text layer being edited pasted).
5. **Zoom is view state, not document state.** No op, no undo entry, not shared with other
   tabs or agents. It resets to fit when the deck changes. **Why:** golden rule 2, the
   document is the deck and the view is per viewer.
6. **The overlay needs no zoom-specific code.** It already measures the rendered DOM, so
   outlines, handles, guides and the text editor stay exact at every zoom.
7. **The browser's page zoom is blocked app-wide** (`page-zoom.ts`, installed at startup):
   Ctrl/⌘ + scroll and pinch over a panel do nothing, and Mod + "+"/"-" zoom the canvas
   even while typing in a field (like Figma). Both listen in the capture phase on `window`,
   because the inspector's fields stop their keys from reaching editor shortcuts. **Why:**
   scaling the whole UI by accident is never what you meant in a design tool. People who
   need a bigger UI keep the OS display scale, and Preferences (D53) will get a UI scale.

## D61 — Text toolbar: style, color and alignment; whole-text formatting lives on the layer

**Status:** Accepted (2026-11-19).

1. **Three menus in the typing toolbar:** Style (the theme's `$text.*` styles, each shown in
   its own font with its size and weight), Color (the theme's swatches first, then the
   system picker) and Align (left, center, right, justify; Ctrl/Cmd+Shift+L/E/R/J, Google
   Docs' keys). Style and alignment format whole paragraphs, color formats the selected
   text. Each control shows the selection's effective value (its own format, else the
   layer's), or "Mixed".
2. **The menus never take the focus.** They're plain buttons in a popup that cancel their
   mousedown, not the inspector's `Select`. **Why:** the text selection stays visible while
   you pick, and the next keystroke keeps typing (D44's toolbar rule). Esc closes an open
   menu before it ends the session. The color picker (D64) is shown inline in the Color menu
   and keeps the focus too; only its hex box takes it while you type, and hands it back.
3. **Formatting that covers the whole text moves to the layer** when the session ends
   (`model/text-box.ts`): every paragraph h2 → the layer's `style: "$text.h2"`, every plain
   run accent → `color`, every paragraph centered → `align`. Overrides that only repeat the
   layer's value are dropped. **Why:** the inspector shows the layer's props, so "select
   all, center" must change what it shows, and an agent reading the deck should see one
   `style`, not the same override on every paragraph. The same rich text otherwise has many
   spellings, and the shortest one is the one people and agents can read.
4. **Every rewrite is visually a no-op,** and the unit tests pin each rule:
   - A paragraph style beats the layer's font overrides (`fontSize`, `font`…), because it's
     set on the paragraph. So hoisting a style clears those overrides, and a paragraph style
     equal to the layer's is only redundant when the layer has none.
   - Links are colored by the browser, not by the layer, so a link's own color never moves
     to the layer and is never dropped.
   - Typing previews the text as typed. Only the commit hoists, so the toolbar keeps reading
     paragraphs against the layer as it was when typing started. A no-op session still sends
     nothing (both sides are compared after the same treatment).
5. **A styled paragraph gets the whole text style,** letter-spacing and case included. Before
   this, only font, size, weight and line-height applied, so a "display" paragraph inside a
   body layer didn't match a "display" layer. Core's `TEXT_STYLE_CSS` / `textStyleCss` is now
   the one list that the text plugin and the editor's typing surface both apply. **Why:** the
   two had drifted apart once already, and that caused this bug.

## D62 — Creation tools live in the top bar's centre, not floating over the canvas

**Status:** Accepted (2026-11-19). Extends D53.

The editor gets a tool bar (Select, Frame, Shape, Text, Image, Hand). Figma floats its
tools in a pill at the bottom of the canvas; Veloce puts them in the centre of the top bar,
between the deck switcher and menus (left) and Follow AI / Live / Present (right).

1. **Next to the rest of the app's controls.** **Why (the user's call):** Veloce has a top
   bar and Figma doesn't, so the tools sit with the menus and the deck controls, a short
   trip from one to the other. Keynote, Google Slides and PowerPoint put insert tools at
   the top too, so it's where presentation users look.
2. **In the bar, not floating over the canvas's top edge.** **Why:** a floating bar there
   would collide with what already pops up above layers (the text toolbar, D61, and
   selection labels), and it would cover the part of the slide where titles usually are.
   In the bar it covers nothing.
3. **Creating a layer is one `node.insert`,** the same op an agent sends (golden rule 1), so
   undo, history and the AI's view of the deck need nothing new.
4. **Narrow windows fold the tools into one menu,** so the bar never wraps or hides the AI
   controls (D53: AI activity is never hidden).

## D63 — Colors at an opacity: `$color.name/NN`, rendered with `color-mix()`

**Status:** Accepted (2026-11-19). Extends D47.

Glows, glass panels and tinted cards need translucent colors. Until now the only way was a
hex with alpha (`#818cf84d`), which stays behind on a theme switch. Any color token now
takes an opacity in percent: `"$color.secondary/30"`.

1. **A suffix on the token string, in percent (0–100), whole numbers only.** **Why:** a color
   stays one string everywhere (props, paints, gradient stops, strokes, text runs), so no
   schema grows an object form and every place that takes a color takes this too. It reads
   like Tailwind's `primary/30`, which agents already know. Whole percents keep the JSON
   Schema a plain `pattern` (MCP) and make typos like `/300` or `/30%` invalid, not clamped.
   The value is additive and format v1 hasn't shipped, so there's no migration (D48 §4).
2. **Rendered as `color-mix(in srgb, var(--v-color-x) 30%, transparent)`.** **Why:** it
   stays on the theme variable, so a theme switch restyles without a re-render, like every
   other token. Mixing with `transparent` multiplies the theme color's own alpha, so an 80%
   theme color at 30% is 24%, the same rule `resolveColor` uses for swatches. Chromium
   (the editor, the render page and Electron) has supported it since 111. Core's
   `colorCss` is the one implementation; the plugin API's `cssColor` calls it.
3. **Lint treats `$color.x/30` as `$color.x`** for unknown-token errors, so typos still get
   "Did you mean". Contrast is measured on the rendered page, where Chromium reports
   `color-mix()` as `color(srgb r g b / a)`. `parseCssColor` reads that form, and the
   renderer finds it inside gradients (`CSS_COLOR_FN`), so translucent text, fills and
   stops are flattened like any other alpha.
4. **The editor: an opacity box next to every color field's hex, and the color keeps its
   opacity.** **Why:** the system picker had no alpha (D47; the picker that replaced it has
   one, D64). Figma keeps a fill's opacity
   when you change its color, so a swatch, a picked hex or "Use theme color" all keep the
   current opacity (`keepOpacity`). On a raw hex the box edits the alpha byte, so the
   control works the same on both kinds of color. 100% writes the plain form (`$color.x`,
   `#rrggbb`). Scrubbing and arrow keys preview live, then commit one transaction. The field
   shows a token by its name (`primary`), so it fits beside the opacity box; typing a name,
   `name/30` or a hex without `#` works too.

## D64 — The editor's own color picker, replacing `<input type="color">`

**Status:** Accepted (2026-11-19). Supersedes D47 §3.

On Linux/Wayland the browser's color popup opened off the screen's edge, past the
inspector. Chromium places that popup itself, and on Wayland it can't know where its window
sits on the screen, so it can't keep the popup on-screen. The page only controls the
invisible input it's anchored to. So the editor now draws its own picker.

1. **Plain DOM, no dependency:** a saturation × brightness square, hue and opacity sliders,
   an eyedropper (Chromium's `EyeDropper` API, shown only where it exists), a hex box and
   an opacity percent box (`components/ColorPicker.tsx`, color math in `model/color.ts`).
   **Why:** each picker library we'd add is more than this (~300 lines), and we need the
   gesture contract and focus rules below anyway.
2. **Placed by us, always inside the window** (`model/popover.ts`): beside the inspector,
   level with the swatch, like Figma's pickers left of its properties panel, so it covers the
   canvas and not the fields being edited. With no room there, it goes below or above the
   swatch, clamped to the window. **Why:** this was the bug, and the same code runs on every
   OS. The system picker also looked different on each OS, and on macOS it's a floating
   panel that outlives the page.
3. **Alpha everywhere.** The opacity slider edits a token's opacity (`$color.x/30`, D63) or a
   hex's alpha byte. Moving only the opacity keeps a token a token (`fromPicked`), so a
   theme color stays theme-following. Theme palette colors can now be translucent (D47's
   trade-off is gone).
4. **The gesture contract (D41):** dragging previews on every move and commits once on
   release; each arrow key, typed hex or eyedropper pick is one commit. Holding the HSV
   state in the picker keeps a gray's hue while you drag through it.
5. **Focus:** pressing the square or a slider cancels the press, so the focus stays where it
   was. In the text toolbar the picker sits inline in the Color menu and the selection stays
   highlighted while you drag (D61). The popover closes on Esc (without deselecting the
   layer) or on a press outside it; a hex typed but not entered still commits.

## D65 — Unused asset bytes are swept from memory, keeping what undo can restore

**Status:** Accepted (2026-11-19).

An upload is stored before anything is added: the server inspects the bytes, returns the ID,
and the client then sends `asset.add` (golden rule 1: the same path for agents and the
editor). A cancelled drop, a paste that fails halfway, or an agent's `add_asset` batch with
one bad file leaves bytes nothing uses. Saving never wrote them (`bundle` writes only the
deck's assets), but they stayed in the open deck's memory for the whole server session,
and a phone photo can be 40 MB.

1. **Keep exactly what can still be used:** the deck's assets, every asset some origin's
   undo or redo would add back (`DeckDocument.restorableAssetIds`: the `asset.add` ops in
   its stacks), and uploads younger than 10 minutes. Everything else is dropped.
   **Why:** an asset can only come back through `asset.add` (a node can't reference an
   asset that isn't in the deck), so undo never finds its bytes missing. Steps that fall off
   the history limit stop holding their assets, which bounds the memory too.
2. **A 10-minute grace period for uploads,** restarted when the same bytes arrive again.
   **Why:** the gap between an upload and its `asset.add` is a network round trip, not a
   person deciding, so 10 minutes is far more than any client needs, and still bounded.
   The restart covers an orphan that's uploaded again just before it would expire. A late
   `asset.add` gets "upload it again" in its error, so an agent can fix the call.
3. **When:** after every save (saves follow edits), and on a timer (every 10 minutes,
   `unref`'d) for decks nobody edits. **Why:** "on close" was the plan, but nothing is
   staged on disk, and decks stay open for the server's life, so closing frees everything
   anyway. The timer does what a sweep on close would have done, while the server runs.

## D66 — The paint picker: gradients and image fills by hand, plus conic gradients

**Status:** Accepted (2026-11-20).

The format has had linear and radial gradients and image fills since phase 1, and agents
used them, but the inspector could only replace them with a swatch. Golden rule 1 says
humans and agents can do the same things, so fills and backgrounds now get Figma's paint
picker in the color popover (D64).

1. **One field, tabs in the popover:** Solid | Linear | Radial | Angular | Image
   (`components/PaintPicker.tsx`, model in `model/paint.ts`). Fill and background fields (a
   frame's fill, the slide background, any plugin prop whose schema allows a paint) get it.
   Plain color fields (text color, strokes) keep the plain picker. **Why:** Figma users look
   for paints exactly there, and one field means no new inspector rows.
2. **Switching tabs converts at once,** in one undo step: a color becomes a gradient from it
   to itself at 0% (`$color.primary` → `$color.primary/0`, so it stays a theme color, as
   Figma does). Gradients keep their stops, and their angle and center where the new kind
   has them; a gradient becomes its first stop's color. Image waits for a file. **Why:**
   instant feedback without losing work while comparing kinds.
3. **Stops on a bar:** click it to add a stop, colored like the gradient is there. Between
   two stops of the same theme color the new stop is that token at the opacity in between;
   otherwise a mixed hex. Drag a stop to move it, past its neighbours too; drag it 32px away
   to remove it (at least two stay). Each stop is a slider (←/→, Shift ×10, Delete). The
   selected stop's color uses the theme swatches and the same picker, so tokens and `/NN`
   work in gradients. Stops are kept sorted, and offsets rounded to 0.1%. **Why:** CSS
   draws an out-of-order stop at the previous one's position, so a sorted list renders the
   way it reads.
4. **Conic gradients are new in the schema:** `{ "type": "conic-gradient", "angle"?, "center"?,
   "stops" }`, CSS `conic-gradient(from …deg at x% y%, …)`. The type name follows CSS like the
   other two; the UI calls it Angular (Figma's name). Adding it to the union is additive,
   and format v1 hasn't shipped, so no migration. Contrast lint measures it like the other
   gradients (it samples stops from the computed style). **Not added:** diamond gradients (no
   CSS equivalent), and video fills (they belong to the video plugin).
5. **Image fills** upload through the same route as drops (D65 sweeps a cancelled one), or
   reuse one of the deck's images, with a fit: Cover, Fit, Stretch, Tile. The upload's
   `asset.add` goes in the same transaction as the paint change. An image the paint stops
   using is unregistered in that step when nothing else uses it (like replacing an image
   element's picture), so undo brings both back.
6. **Objects are written whole:** angle, center and fit are always included, even at their
   defaults. **Why:** `node.update` merges an object of the same `type` into the old one, so
   a field left out would keep its old value.
7. **The popover closes like Figma's (amends D64 §5):** a header with what's being edited and
   a ✕, Esc, the trigger, or a press elsewhere in the panels. Presses on the canvas don't
   close it, so panning (middle button, Space + drag) and zooming keep it open while you
   look at the result. Selecting another layer (or slide) does close it: the inspector's
   fields are keyed by what they show, so they remount instead of a picker carrying over
   to a layer of the same type. Tooltips sit above the popover.
8. **Later:** on-canvas gradient handles (drag the ends of a linear gradient, the center of
   a radial one on the slide). That's canvas tool work, so it waits for round 5's tool bar
   (D62).

## D67 — Image optimization on import: the smallest file that still looks the same

**Status:** Accepted (2026-11-20).

A phone photo is 4–12 MB at 4000–8000 px, and a slide is 1920 px wide: decks got huge for
pixels nobody sees. Imports now work like TinyPNG, but per image: Veloce measures how much
each photo can lose before it shows.

1. **Resize to at most 3840 px** on the long side (twice the stage: sharp when zoomed in
   and in 4K exports), never up. This is most of the saving: a 5K wallpaper went
   3.8 MB → 128 KB.
2. **Quality searched per image, measured with SSIM.** Six 256 px tiles at full resolution
   (the five most detailed plus the smoothest non-flat one, where banding shows) are
   encoded, decoded and scored; a binary search over q55–95 finds the lowest quality that
   still scores 0.94. The score blends the mean with the worst 1% of windows, so one
   damaged patch (text on an empty slide) fails it. The 0.94 bar was checked by eye at 2×
   zoom on real photos and UI screenshots: grainy photos land around q88, clean ones
   around q75, and subpixel text stays identical. **Why:** one fixed quality smears grain
   in some photos and wastes bytes in others; searching on tiles costs ~0.8 s instead of
   ~8 s for full-size tries.
3. **WebP only, lossy or lossless, whichever is smaller.** Lossless WebP competes only for
   lossless sources (PNG, lossless WebP): screenshots and logos stay exact when that's
   smaller. Sharp RGB→YUV is used for those (crisp colored edges), not for photos.
   **Why:** every Veloce renderer is Chromium, so WebP always shows. MozJPEG was measured
   too, and at the same score WebP was 20–40% smaller on 6 of 7 photos while doubling the
   search time. AVIF encodes 5–10× slower in WebAssembly. GIF, SVG, AVIF, animated PNG or
   WebP, CMYK JPEGs and files under 32 KB (unless oversized) are left alone.
4. **Only clearly smaller results are used:** at least 10% smaller, or resized and smaller.
   Otherwise the original stays. Rotation from EXIF is applied to the pixels; the ICC color
   profile is copied into the new file (Display P3 photos keep their colors); EXIF itself
   (camera data, GPS location) and thumbnails are dropped, which is a privacy bonus. The
   name follows the format (`beach.png` → `beach.webp`).
5. **Keep original.** The server stores both files and returns
   `{ id, info, optimization: { original, method, quality, resized } }`. The editor adds the
   optimized file and shows "beach.png optimized: 3.4 MB → 98 KB (−97%), looks the same ·
   Keep original" for 12 s. Keep original swaps every reference deck-wide (images, fills,
   backgrounds), adds the original and removes the optimized file in one undo step
   (`swapAssets`). Whichever file isn't used is swept after the 10-minute grace (D65).
   Agents get the savings in `add_asset`'s reply and can pass `optimize: false` per file.
   A copy between decks (`x-veloce-optimize: 0`) is never optimized again. The same file
   uploaded twice reuses the first result.
6. **New package `@veloce/images`** (Node only, no Veloce dependencies), used by
   `doc-server`. Codecs are jSquash's WebAssembly builds of MozJPEG, libwebp, the PNG codec
   and the Lanczos resizer (Apache-2.0 wrappers around BSD/MIT/Apache code; no native
   binaries per OS). libimagequant (TinyPNG's palette PNGs) is GPL-3, so it's out, and so
   is `libimagequant-wasm`, which is labelled MIT but wraps it. SSIM, tile sampling and the
   container work (EXIF, ICC, animation and CMYK detection) are our own code.
7. **Off the main thread:** a 4K photo takes 1.5–4 s of CPU, which would freeze sync and MCP
   for everyone. One worker thread handles images one at a time (bursts queue up instead
   of competing for cores and memory). It starts on the first image and stops after 30 s
   idle to give back its WebAssembly memory, which only grows. A crash or a run over 60 s
   keeps the original: optimizing never makes an import fail. The package imports its
   own files as `./x.ts` (`rewriteRelativeImportExtensions` turns them into `.js` when
   built) so the worker runs the TypeScript source directly under Node's type stripping
   in tests and dev (Node 22.18+, where stripping is on by default: `engines` says so). The
   `ImageData` stand-in the codecs need is installed only when
   they load, so it lives in the worker and the server's globals stay untouched.
8. **Packaging (Phase 7):** the Electron build must ship `@jsquash/*`'s `.wasm` files and
   `@veloce/images/dist/worker.js` as real files (unpacked from asar, not bundled into
   one file), because the worker is started from its own URL.

## D68 — Each agent session keeps its own deck

**Status:** Accepted (2026-11-20). Supersedes the agent half of D28. From the round-4 agent test.

The test agent was building its deck while the user browsed other decks in the editor. Its
next `upsert_slide` went into the user's "SunBrew" deck, and the call after that failed with a
"did you mean" hint for a slide in a third deck. The active deck was global (D28), so whatever
the editor or any other agent opened last became every agent's write target. No tool took a
deck ID, so an agent had no way to protect itself.

1. **Every MCP session pins its deck:** `create_deck` and `open_deck` set it (and still switch
   the user's editor, as D28 wants). Otherwise it's the deck the editor showed at the
   session's first call. The user or another agent switching decks never moves it.
2. **Agent writes don't drag the editor back.** The user chose to look elsewhere.
   `get_deck_summary` tells the agent so ("The user's editor is showing another deck…;
   open_deck(…) shows it to them"), and `list_decks` marks both decks. **Why:** the agent can
   decide whether its work needs the user's eyes; switching the screen under someone is rude.
3. **Not chosen:** a `deckId` on every write tool (more to send on every call, and agents
   would still need a "current" one), and failing writes whose target moved (it was the
   global pointer that was wrong, not the agent).
4. Docs, deck resources and `list_decks` use the session's deck. A pinned deck that's gone
   from the workspace gives an error that says to `open_deck` another.

## D69 — Agent feedback round 3: what the round-4 deck test found

**Status:** Accepted (2026-11-20). A 15-slide MCP test deck covering every round-4 feature.

1. **Slide backgrounds sit on the theme background** (`cssSlideBackground`). A translucent
   gradient on a slide was drawn over the white page under the slide, so a purple glow on
   Midnight came out as a near-white ellipse. A color paint becomes a one-color gradient
   layer, since only the last CSS background layer may be a plain color.
2. **Links take the text's own color, underlined** (renderer and the in-place text editor),
   instead of the browser's #0000EE, which ignores the theme and failed contrast on dark
   slides. A run color still wins. **Why not the primary color:** the text color always has
   the contrast the text already has.
3. **Contrast lint samples a gradient under the text,** not every stop
   (`gradient-sample.ts`). The geometry is parsed from the computed CSS: linear projects the
   text box's corners on the gradient line, radial takes the nearest and farthest points
   from the centre, and conic takes the angles the box spans (two ranges when it wraps).
   Text at the faded end of "primary → primary/0" was an error at 1.70:1 though readable. A
   rotated box is still sampled whole.
4. **empty-space counts what's drawn:** elements, frames with a fill, stroke or shadow, and
   free layers taller than 8% of the slide. Still not counted: frames that only arrange, a
   painted backdrop at least 90% of the slide tall, and small free labels. It fired on 4 of
   15 balanced slides, which teaches agents to ignore lint.
5. **off-canvas reports painted frames** (a box in a diagram), once per box rather than once
   per text inside it. An unpainted frame's elements are reported as before.
6. **Error messages:** an opacity out of range says so ("must be a whole percent from 0 to
   100, got 150") instead of the paint union's bare "Invalid input". `anchor.x: "right"`
   suggests `"end"`. An image layer's `fit: "tile"` points at frame image fills.
7. **Font stacks fall back to the same kind of face:** imported fonts are classified serif,
   sans or monospace from their OS/2 table (PANOSE first, then the family class), stored as
   `font.category` (additive; format v1 hasn't shipped). Caladea now gets
   `"Caladea", Georgia, serif`. Fonts that don't say (many web builds, like Fontsource's Lora,
   ship an empty PANOSE and class) keep the sans fallback.
8. **Sizes are decimal** (`formatBytes`: 3,907,925 bytes is "3.9 MB", like file managers and
   `ls --si`), shared by add_asset's reply and the editor's toast.
9. **Docs:** every text run and layer prop, each text style's font and case in the theme
   docs, an image's 400 × 300 default even in a stretching column, how tiles are sized, how
   each visual lint rule measures, deck fonts' missing weights, and per-session decks.
10. **Kept as they are:** text over a shape isn't an `overlap` (shapes are usually
    backgrounds; documented). Screenshots stay lossy WebP when that's smaller and passes the
    SSIM bar: the 3× zoom check in D67 showed identical text, and that's TinyPNG's trade too.
    Contrast messages name the layer, not the run (later, if agents trip on it).

## D70 — Errors in the terms the agent sent

**Status:** Accepted (2026-11-20). From the D68/D69 retest (5-slide fix-check deck: 8 of 9
fixes confirmed, F7 partly).

1. **apply_ops is keyed on `op`.** Its input was a plain union of the shorthand inserts and
   core's strict `OpSchema`. When an inserted node was invalid, both branches failed, and the
   error picker preferred core's: "node.kind: Invalid discriminator", which told the agent to
   add a field that wasn't the problem and hid D69's anchor hint. Now each op is checked
   against one schema. The shorthand `node.insert` takes a superset of core's node, so
   nothing that used to pass is refused.
2. **Element errors carry a path into the tree** (`node.children[0].props`,
   `slide.root.children[2].props`). MCP drops the IDs it generated itself from messages
   ("The image element", not "nd_6xahrxrndl", which the agent never saw). For upsert_slide
   it also drops the internal `ops[0] (slide.insert)` prefix and maps paths to the slide that
   was sent (`slide.children[0].props`). **Why in MCP:** core can't know which IDs were made
   up; the tool that generated them can.
3. **Contrast:** the message reads "has a contrast of 1.20:1 against what's behind it". When a
   gradient is behind the text, the fix talks about the gradient (move the text, change that
   stop), not tokens the text already uses (`TextSample.gradient`).
4. **list_decks** marks a deck both `CURRENT` and `in the user's editor` when the user is
   watching the agent's deck. Before, "no editor open" looked the same. It's described as
   "most recently used first", which is what the sort does: opening a deck counts.
5. Docs: node.insert takes the upsert_slide node shape; the empty-space threshold (40%, unless
   the bands are about equal).

## D71 — Reverting AI changes, and agents hearing about it

**Status:** Accepted (2026-11-20). First item of round 5's parity checklist.

1. **Parity means the document, not the tools.** Whatever an agent can set, the user can see
   and change in the editor; otherwise the AI hands over a deck only the AI can fix. Tools
   that exist because the agent can't see (`render_preview`, `get_docs`, `get_deck_summary`,
   `list_element_types`) get no editor twin.
2. **Revert is the user's own change.** The History panel's Revert (one change, or "Revert
   all" on an agent's run) applies the stored inverses of those changes, newest first, as a
   `user` transaction. It doesn't pop the agent's undo stack. **Why:** the user's Ctrl+Z (or
   the toast's Undo) brings the work back, undo stays per origin (golden rule #7), and the
   agent's stack stays consistent. Inverses only touch the fields a change set, so later
   edits to other fields survive, like any undo; when the deck moved on so a change can't be
   taken back (its slide was deleted), the revert fails and nothing changes. Only agents'
   changes, still in effect, within the last 500 (the server's history keeps each change's
   inverse; asset bytes a revert could add back are kept from the sweep).
3. **Reverted state follows undo and redo.** Core's undo/redo results now say which
   transaction they take back (`reverses`), so the server knows when a revert was undone or
   redone. Change messages and history entries carry `reverts` / `restores`, entries a
   `reverted` flag (struck through, "Reverted" chip). Shared `appendHistory` keeps client and
   server marking alike.
4. **No "are you sure?".** Like other destructive edits, a toast with Undo. If the revert
   touched slides you edited after the agent (a reverted "Add slide" takes your edits on it
   too), the toast names them.
5. **Agents hear about it, in-band.** Every tool result (errors too) starts with what others
   changed since that session's last call: who, labels, slides changed or removed, and
   reverts of its own work with "that's the user's decision: don't redo it unless they ask".
   **Why in-band:** MCP is request/response and clients rarely show server-pushed
   notifications to the model, so a digest in the next result is what reliably lands. The
   session tracks the versions it made, so it never hears about its own work (another
   session with the same client name is "another session of you").
6. **upsert_slide won't resurrect a removed slide.** A slide another origin removed (deleted
   or reverted) is refused unless `overwrite: true`. **Why:** without it, an agent rebuilding
   from its own plan fights the user, the failure mode that made this a package deal.
7. **Kept out:** reviewing changes before they land (suggestion mode), reverting per slide,
   and reverting the user's own older changes (Ctrl+Z covers those).

## D72 — The revert retest: errors and digests that don't mislead

**Status:** Accepted (2026-11-20). From REPORT-3 (all 12 agent steps passed; these are its
findings).

1. **An ID someone removed says so.** When an op fails on a node or slide that another change
   removed this session, the error says who removed it and where (`Node "sub4"
   ("Questions?") was deleted by the user (it was on slide s4)`), and gives no nearest-match
   suggestion. **Why:** core's "did you mean sub1?" pointed the agent at a node on another
   slide that the user had just edited, so an agent fixing errors on autopilot would have
   overwritten the user's work. That was the one real temptation in the run. The doc-server
   keeps who removed each node (walking only the slides a change touched, at most 10,000
   entries) and lists the removed nodes on each history entry.
2. **The digest names removed nodes** (`removed node sub4 ("Questions?")`), so the agent
   knows which IDs are dead without calling get_slide on every slide.
3. **The digest doesn't lose anything.** Each change is reported once, so whatever the digest
   cuts is never seen. A revert undone right away becomes one "…, then undid that (no net
   change)" line (with no "user's decision" rule). The newest lines are kept, and older ones
   fold into an "Earlier: N more updates" line naming the slides they changed or removed.
   Before, it kept the oldest 8 and said "…and 7 more", which cut the newest changes.
4. **Wording:** a restore says "restored slides", labels' inner quotes become single quotes,
   and the digest shares the first text block with a blank line before the result, since
   clients join blocks without a break. A text edit's History label names the new text
   ("Edit text "Edited by me""), or the layer's name if it has one.
5. **The revert toast counts only real edits.** Your own reverts and undos of them are
   user-origin but only move AI content around, so they no longer count as "edited since".
   Slides are numbered as they were before the revert, so a removed slide is "slide 1",
   not "a slide".
6. **undo_agent_changes** says which slides it changed or removed, and returns lint like the
   other editing tools.
7. **Kept out:** text diffs in the digest (`"Revert Test" → "Edited by me"`). They'd cost tokens
   on every call, and get_slide is one call away.

## D73 — Lint in the editor: the agents' issues, worded for people

**Status:** Accepted (2026-11-20). Round 5 parity checklist.

1. **The server lints, the editor shows.** A `DeckLinter` in the doc-server re-lints a deck
   250 ms after a burst of changes, only while an editor tab has it open, never twice at once,
   and drops a result a newer change made stale. It pushes a `lint` sync message (`version`,
   `issues`, `visual`). **Why:** the issues are then exactly the ones agents get, from the same
   headless renderer and the same core rules. With `CachedRenderService`, a slide is measured
   once per version, whoever asks first, so the editor costs almost nothing extra. Measuring
   in the user's tab would compete with editing and could disagree with what agents see.
   `lintWithRender` is the one code path; MCP's lint uses it too.
2. **Core's wording stays agent-shaped; the editor rewrites it.** Agents need IDs and prop
   syntax (`text "nd_x7"`, `height: "hug"`); people need names and the inspector's words. The
   editor keeps core's measurement (which layers, by how much). It swaps IDs for layer names
   ("Text "Our tagline"", "this slide"), adds a short title per rule ("Text doesn't fit"),
   and writes fixes in UI terms ("Set its height to Hug content"). Unknown rules from a newer
   server fall back to core's text.
3. **Quiet by default.** An Issues tab (inactive tabs shrink to their icon, so four fit in the
   248 px panel), badges with the problem count on the tab and the thumbnails (bottom corner,
   clear of the slide actions), and a dot on layers. Tips (info) don't badge and stay folded
   behind "Show N tips". Clicking an issue goes to its slide and selects its layers. When the
   server has no renderer, the panel says the layout checks are off and why.
4. **Later:** a Preferences switch (lint on/off, which rules), and ignoring an issue on one
   element, which agents should respect too.

## D74 — Frame border and shadow in the inspector

**Status:** Accepted (2026-11-20). Round 5 parity checklist.

1. **Absent until added, Figma style.** "Border" and "Shadow" are inspector sections whose
   header carries **+** (add) or **−** (remove). **Why:** most frames have neither, and five
   empty fields per section would bury Fill & shape (D47's airy rule). An unbordered card
   shows two one-line headers. `Section` gained an optional header `action` and a compact
   `is-empty` state, so later optional sections (effects, per-corner radius) reuse it.
2. **Theme-first defaults.** A new border is 2px (1px is a hairline on a 1920px slide) in
   `$color.border`. A new shadow is the theme's `$shadow.md` token (else the first token, else
   explicit soft values), so it follows theme switches. **Why:** the AI and the theme speak
   in tokens; a hand-added shadow should look like the ones agents add.
3. **Presets, then Custom.** The Shadow menu lists the theme's shadows plus Custom. Custom
   copies the token's values into the frame, so nothing jumps and X, Y, Blur, Spread and
   Color appear to tweak. Picking a theme color for a shadow stores its hex (`ShadowSchema`
   takes hex only), at the shadow's current opacity like any new color, so it stays soft.
4. **Required fields have no reset.** Fields gained `required`: no reset button, and
   clearing one is ignored. A text draft whose commit is rejected (a cleared required color,
   or text that isn't a color) now snaps back to the document's value instead of leaving
   text on screen that was never applied. That also fixes the existing quirk for typos.
5. Edits are ordinary `node.update` merge patches (`{style: {stroke: {width: 6}}}`), the same
   ops agents send (golden rule 1). Pure logic lives in `model/frame-style.ts`.

## D75 — Per-side padding: one field or four, a control shared with radius

**Status:** Accepted (2026-11-20). Round 5 parity checklist.

1. **One field, plus "Individual sides".** The Padding row keeps its usual length field
   (Default, theme tokens, Custom px), with a toggle beside it that opens Top, Right, Bottom
   and Left. **Why:** most frames have even padding, so the common case stays one row; per-side
   values (which agents write as `{ x, y }` or four sides) are no longer read-only "set by AI".
2. **It opens by itself when the sides differ,** so a mixed padding is never shown as one
   misleading value. Turning it on changes nothing; edits do.
3. **Editing one side spells out all four,** so `{ x: 40, y: 20 }` with Left set to 80 becomes
   `{ top: 20, right: 40, bottom: 20, left: 80 }` and no side moves. Core already replaces
   rather than merges across padding forms, and `diffPatch` keeps each patch minimal.
4. **Turning it off keeps the value most sides have** (ties: the top's), as one value, in one
   undoable step. **Why:** a card with one odd side keeps the look of the other three; picking
   "top" alone would follow an accident of order. Per-corner radius should do the same.
5. **Compact side rows.** A side in pixels is the number plus a narrow token menu (▾) on one
   row; a side on a token is the menu alone. **Why:** the first cut stacked "Custom…" over the
   number, eight rows for four sides; one row each keeps the panel airy (D47) while each side
   can still take a theme token, as agents can (golden rule 1).
6. **`SidesField` is generic** (keys, labels, live handlers, a collapse callback) and knows
   nothing about padding, so per-corner radius reuses it after its schema change. The padding
   logic is pure in `model/sides.ts` (`uniformValue` and `mostCommon` are generic too).

## D76 — A File menu and Deck info: the deck's meta, edited and actually used

**Status:** Accepted (2026-11-20). Round 5 parity checklist.

1. **A File menu now, the menu bar later.** The top bar starts with "File" (New deck…, Deck
   info…), a WAI-ARIA menu button (`MenuButton`). **Why:** these commands need a home before
   the full app menu bar exists; the bar will be a row of the same component, so nothing is
   thrown away. Picking a command gives focus back to the button first, so a dialog it opens
   returns focus there when it closes.
2. **Dialogs are native `<dialog>` with `showModal()`.** The browser traps focus, handles
   Esc, makes the page inert and restores focus. **Why:** that's the hard, bug-prone part of
   any modal, and the platform does it right. What we add: focus on the first field (React's
   `autoFocus` runs before the dialog is shown), never leaving focus on a removed field (keys
   sent to a detached element never reach the window, so every shortcut went dead), the
   editor's shortcuts ignoring keys inside an open dialog (Delete on a button must not delete
   layers), and an opacity-only open animation (a transform would shift fixed popups).
3. **Popups go into the dialog they're opened from** (`popupHost`): a dropdown portaled to
   `<body>` from inside a modal dialog is inert, visible but unclickable. Select and the color
   picker use it.
4. **Deck info** edits title, description, authors (comma separated) and language as one
   `deck.updateMeta` with only the changed keys. Limits mirror `DeckMetaSchema`, and errors
   show in place. Language: common languages by name (`Intl.DisplayNames`), or "Other…" for
   any BCP 47 tag, tidied by `Intl.getCanonicalLocales` and named as you type. Validation is
   grammar only, like the schema, so a tag an agent wrote is never rejected.
5. **The meta is used, so the dialog's promises are true.** Agents' deck summaries now show
   "About:", authors and language when set, so they write for that audience in that language.
   The renderer sets `lang` on the slide stage, so screen readers (and hyphenation) follow it.
   **Why:** the dialog's hints said both; before this, nothing read the description or the
   language at all.

## D77 — New deck from the editor, the way agents make one

**Status:** Accepted (2026-11-20). Round 5 parity checklist.

1. **A `create` sync message** (`title`, optional built-in `theme` ID) runs
   `workspace.create`, the same path as MCP's `create_deck`. The new deck becomes the active
   one, so every tab switches to it through the existing `decks` event. **Why:** golden rule 1;
   no editor-only creation path, and an agent's next call sees the new deck as current, as if
   it had made it. An unknown theme is an error that lists the built-in ones.
2. **File → New deck** asks for a title ("Untitled deck", selected so typing replaces it) and
   a theme, picked from the same cards as the inspector's Theme section. Colors and fonts are
   tuned afterwards in the inspector.
3. **An empty deck can be started by hand.** The empty state's "Slides appear here as your
   agent builds them" now also offers **New slide** (or **New deck** when there's no deck).
   **Why:** without it, a deck made by hand was a dead end for anyone not using an agent.

## D78 — Theme styles: a dialog for text styles and the scales

**Status:** Accepted (2026-11-20). Round 5 parity checklist.

1. **A dialog, not an inspector section or a workspace.** Four tabs (Text styles, Spacing,
   Radius, Shadows) open from File → Theme styles… and from the inspector's Theme section,
   which keeps colors and fonts. **Why:** eight text styles of six fields each don't fit an
   inspector column, and a whole workspace for an occasional task is too heavy. Workspaces
   don't exist yet either.
2. **A draft, saved as one `deck.setTheme`.** That's the op `set_theme` uses (golden rule 1),
   so a whole session in the dialog is one undo step. Cancel or Esc drops it. The dialog shows
   each value as itself: the sample text in the style, bars for spacing, a corner for radius,
   a card wearing the shadow. The canvas preview runs too, but the modal covers most of it.
3. **Save merges by group onto the deck's current theme.** Only the groups changed in the
   dialog are written. **Why:** an agent can recolor the deck while the dialog is open, and
   a whole-theme save from the dialog's stale copy would silently undo that. When both sides
   changed the same group, the user's version wins, because they pressed Save last.
4. **Tokens can be added and removed, as agents can.** New names follow the token rule
   (letters, digits, `-`), and a new token starts as a copy of the selected one. A token the
   deck uses (an exact `$group.name` reference anywhere in the slides) can't be removed, and
   the dialog says how many layers use it. **Why:** removing it would leave broken references
   that lint would then flag.
5. **The units people expect.** Letter spacing shows in % like Figma (stored in em, the unit
   agents write, to 0.0001em so nothing is rounded away), weights by name ("Semibold · 600")
   with an agent's in-between weight kept, and case options shown in their own case.
6. **Enter and Esc act on the field** (`Dialog`'s `fieldKeys="field"`). Enter commits it and
   Esc reverts it, as in the inspector; only the buttons save or close. **Why:** in a dialog
   with dozens of fields, Esc to fix a typo must not throw away the whole draft.
7. **App dialogs open from anywhere** through a small store (`dialogs.ts`), and App renders
   them at the top level. **Why:** a dialog inside the inspector would unmount, losing its
   draft, whenever the inspector re-keys (for example, when Follow AI switches slides).

## D79 — Plugins extend the app, sandboxed like Figma

**Status:** Accepted (2026-11-20). Extends D22, which stays the contract for element types.

The user wants plugins like Blender's, Obsidian's and Figma's: plugins that add **tools**
(commands, panels, automations), not only new kinds of content. D22 only covers element
types (text, chart, lottie…). Of the three trust models, the user chose **Figma's: plugin
code runs sandboxed** and reaches the app only through an API. **Why:** Veloce is a FOSS app
people will install community plugins into, and it runs in Electron, where a trusted plugin
(Obsidian, Blender) gets the whole computer. Decks are also shared, and opening a deck
someone sent you must never run their code unsandboxed.

1. **One plugin package, several contributions.** A plugin's manifest declares what it
   contributes: commands (with menu places and default shortcuts), panels, and element types
   (D22). It declares them statically, so the app can list, search and show them without
   running plugin code. It also declares an `apiVersion`: the plugin API is semver'd, and
   frozen as v1 at 1.0.
2. **The sandbox.** Each third-party plugin runs in its own sandboxed iframe with an opaque
   origin (no `allow-same-origin`) and a strict CSP: no network unless its manifest allows a
   domain, and no Node, filesystem or Electron APIs ever. Plugin panels are sandboxed
   iframes too. Everything crosses a `MessageChannel` as an async RPC. **Why:** the browser's
   own isolation is the most battle-tested sandbox we can ship without native code; this is
   Figma's model (logic plus an iframe UI over `postMessage`).
3. **The document API is ops (golden rule 1).** Plugins read the deck, the selection and
   changes, and write only through transactions with a new origin, `plugin:<id>`. **Why:** a
   plugin then gets everything agents get, with no special cases: validation, per-origin
   undo, History ("Chart Maker changed slide 3"), Revert (D71) and lint. A plugin can't make
   a change the user can't see or take back.
4. **Commands are the extension point.** The menu bar, the command palette, the tool bar and
   keyboard shortcuts all read one command registry, and built-in commands register through
   it exactly as plugins do (golden rule 6, extended from elements to commands). **Why:**
   round 5 builds the menu bar and palette next. Designing their registry as the public
   API now is cheap; retrofitting it later isn't.
5. **Permissions, asked once.** Plugins can read the open deck and edit it through
   transactions by default (an edit is always visible and undoable). Anything else is
   declared and shown at install: network domains, asset upload, clipboard. A plugin that
   asks for more in an update is disabled until the user agrees. Plugins keep their own
   settings in plugin storage, outside decks.
6. **Clean lifecycle, like Obsidian.** Enabling loads a plugin, and disabling removes
   everything it registered (commands, panels, element types, frames, listeners) with no
   restart. The conformance kit checks this, as it checks elements' `dispose()`.
7. **Content plugins in decks.** A deck already records the element plugins it uses
   (`plugins.lock.json`). Opening a deck never installs or runs a plugin by itself. A missing
   plugin's elements show a placeholder that names the plugin. Third-party element types
   mount inside the sandbox; the renderer drives `seek(t)` over RPC and waits for the frame
   before capturing, so export stays deterministic (golden rule 3).
8. **First-party plugins** (`veloce.*`, shipped in the app and reviewed with it) use the same
   API but can be hosted in-process. **Why:** a sandbox per text box would cost too much
   for elements on every slide. The API is the same; only the transport differs, and the
   conformance kit runs plugins both ways.
9. **Agents can use plugins.** A command can opt in to being an MCP tool, with an input
   schema (golden rule 5). The agent calls it, and its transaction carries the plugin's
   origin. Agents work with no editor tab open (golden rule 2), so these commands run in the
   server's headless render page, the one that already measures slides for lint. This is a
   capability Blender, Obsidian and Figma don't have.
10. **Installing.** For 1.0: from a file or a folder, plus a developer mode that loads an
    unpacked folder and reloads it on save. A plugin directory and marketplace come after 1.0.

**Not decided yet (settle when the phase starts):** whether plugin logic gets a Worker
inside its iframe; the exact RPC shape (a typed proxy generated from the API's types is
likely); the package format and signing.

## D80 — A shape's outline uses the frame's Border section

**Status:** Accepted (2026-11-20). Round 5 parity checklist; extends D74.

1. **Strokes are found by their schema, not by their name.** A prop whose JSON Schema is
   `StrokeSchema`'s shape (a color, a number width, an optional line style, nothing else)
   is a `stroke` field. **Why:** golden rule 5. Any plugin that uses `StrokeSchema` gets the
   editor, not only shapes, and an unrelated object that happens to have `color` and `width`
   isn't mistaken for one.
2. **Same UI, same defaults as a frame's border.** A stroke field renders as its own Border
   section below the element's properties: **+** adds a 2px line in the theme's border color,
   with color, width and style, and **−** removes it. The helpers take a path (`style.stroke`
   for frames, `props.<key>` for elements), so the two can't drift apart. **Why:** a shape's
   outline was read-only, so only agents could add one. People shouldn't need to learn two
   UIs for the same line.
3. **The roadmap item for nested props shrinks to the image focus point.** It was the only
   other read-only built-in prop. A generic editor for any nested object waits for
   third-party plugins (D79) that actually need one.

## D81 — Adding layers: tools to draw, an Add menu at the pointer, one command registry

**Status:** Accepted (2026-11-20). Builds D62's tool bar; starts D79 §4's command registry.

The user asked for Blender's way in: click a tab to pick what to add, **or** press Shift+A
to open it where the cursor is. Both, plus Figma's drawing tools.

1. **Tools draw; the Add menu adds at a spot.** The tool bar (Select V, Frame F, Rectangle R
   / Ellipse O in one slot, Text T, Image, Hand H) arms a tool: a click adds the layer at its
   default size, a drag draws it (Shift: square, Alt: from the centre), live-previewed. After
   one layer it's back to Select, and Esc goes back too (Figma). **Why:** single letters are
   the fastest path for the few things added all the time, and they're what Figma, Keynote
   and PowerPoint users look for.
2. **The Add menu opens at the pointer, searchable.** Shift+A over the canvas opens it there,
   and the layer lands there. A right-click on the canvas opens the same menu, and so does
   the tool bar's ➕. Typing filters it by word starts ("circ" → Ellipse), arrows and Enter
   pick, and the last three used sit on top (per viewer, in browser storage). **Why:** six
   tool buttons can't hold what plugins will add (charts, code, video…), but a searchable
   menu can. The right-click and the tooltip teach Shift+A, which nobody guesses.
3. **Where it lands follows the drag-and-drop rules.** The innermost unlocked frame under the
   point; in a stack or grid, the slot nearest the point (free layers aren't slots); in a free
   frame, centred on the point and kept inside it. Away from the canvas (the ➕ button,
   Shift+A over a panel) it goes where a paste would: into the selected frame or after the
   selected layer. **Why:** one mental model for "where does this go", and golden rule 4:
   in a stack the engine places it, we only choose the slot.
4. **One `node.insert` per layer (golden rule 1).** New layers use theme tokens (a frame is a
   stack card in `$color.surface` with `$radius.md`; shapes take the plugin's default fill),
   and a new text layer starts typing with its "Text" placeholder selected, so typing
   replaces it and nothing empty is left behind. **Why:** undo, History, Revert and the AI's
   view of the deck need nothing new, and agents never meet an empty text layer.
5. **One command registry (D79 §4).** Each tool and each Add entry is a command (ID, label,
   icon, shortcut, menu, enabled/checked, run) in one registry that the tool bar, the Add
   menu, the folded narrow-window menu and the keyboard all read. The Add menu lists every
   registered element type, so a plugin's element appears without editor code. Shortcuts
   need exactly their modifiers and are ignored while typing. **Why:** the menu bar, the
   command palette and plugin commands then become more views and more entries, not new
   plumbing. The older shortcuts (undo, align, group…) move in with the menu bar.
6. **The tools stay centred.** The top bar is a three-column grid; the sides shrink and
   truncate, so the AI's activity pill appearing never shifts the tools under the pointer.

## D82 — An image's focus point is a dot on the picture

**Status:** Accepted (2026-11-20). Round 5 parity checklist (its last item); extends D80.

1. **Found by its shape, like a stroke (D80).** A prop that is exactly `{ x, y }` numbers, on
   an element whose schema also has an asset prop, is a focus on that picture. **Why:** golden
   rule 5. Any plugin with a picture and a point gets the control (a video's poster frame, a
   map pin), and a point with no picture to aim at stays read-only rather than guessing.
2. **The picture shows the result, not just the point.** The inspector shows the whole
   picture with the part the layer keeps lit and the cropped-away rest dimmed (for `cover`,
   the default fit; from the layer's size on the slide), plus a percentage readout. Drag
   the dot or click anywhere on the picture; the slide previews it live, and releasing is
   ONE transaction. **Why:** "focus 0.3, 0.2" means nothing until you see what's cut off;
   two number fields would have been parity on paper only.
3. **Keyboard too (WCAG 2.5.7).** The dot is a slider: arrows move it 1%, Shift 10%,
   committed when the key is released (one undo step per press); Esc puts it back. Reset
   clears it to the centre (the prop removed, as for any field).
4. **Stored to 0.1%, kept on the picture.** Values are clamped to 0–1 and rounded to three
   decimals. Out-of-range values an agent wrote still render (the renderer is unchanged)
   and show clamped. **Why:** no schema change, so no file-format change.

## D83 — A free canvas with structured blocks; layout says where things rest, not how they move

**Status:** Accepted (2026-11-20). Builds on D3, D49 and D50; doesn't change D3's engine or
the file format.

A slide made by hand started as the same centred column agents build, so dragging reordered
instead of placing, and the slide's own layout couldn't be changed at all (its root frame
can't be selected). Every hand-made deck tool (Keynote, PowerPoint, Canva, Figma) is a free
canvas at the slide level, with structure opted into per block.

1. **Slides made in the editor start Free** (`HAND_SLIDE_LAYOUT`, `{ mode: "absolute" }`).
   Agents' slides still start as a stack (`createSlide`). **Why:** people place things;
   agents describe structure and do pixel maths badly (D3). Both kinds of slide are the
   same document, so either can be edited by the other.
2. **The slide's layout lives in the Slide section** ("Layout": Free / Stack / Grid and that
   mode's settings), the same `LayoutSection` a frame shows as "Auto layout". Stack/Grid →
   Free moves nothing (D50). Free → Stack/Grid re-arranges the layers, so it shows a toast
   with Undo instead of asking first (the app's rule for edits that change a lot).
3. **Add auto layout (Ctrl+Alt+A, a layer button, a registry command).** It reads the
   arrangement already on screen: layers spread out sideways become a row, else a column;
   reading order along it; their average spacing as the gap; cross-axis start. Several free
   layers are wrapped in a stack that hugs them, at their corner (in front of what they were
   in front of). One Free frame becomes a stack in place, padded by where its children sat.
   Layers already in a flow are grouped like Ctrl+G, whose frame copies their flow. One
   transaction. **Why Ctrl+Alt+A:** Figma's Shift+A opens the Add menu here (D81).
4. **Agents see and keep a Free slide.** The outline shows `[at x,y]` for every layer placed
   by its position (an absolute frame's children too, not only `positioning: "free"`), and
   `get_docs("layout")` says to keep a person's arrangement and not switch their root.
5. **Layout is where a layer rests; motion is a transform on top; depth is a transform too.**
   The rule for Phase 4: animations move layers with transforms and opacity (x, y, z,
   rotations, scale, blur) relative to their rest position, whatever placed them. Free
   layers suit motion paths and hand-made Magic Move; stacks add layout animations (FLIP:
   measure before and after, animate the difference) and staggering in reading order.
   Nothing animates width or height frame by frame (it reflows the slide every frame and
   breaks `seek(t)`). 2.5D (perspective, z depth) is transform state on frames and layers;
   real 3D scenes are plugin elements with their own camera on the one clock. **Why:** this
   is how motion tools keep layout and animation from fighting, and it means the free/flow
   choice never limits what can be animated.

`model/auto-layout.test.ts` covers the flow guess and each case; `phase3-free-canvas.test.ts`
covers it in real Chromium (Free without a pixel moving, Ctrl+Alt+A, the toast's Undo, new
slides Free).

## D84 — Crop mode: a `crop` rectangle, edited on the canvas like Figma's

**Status:** Accepted (2026-11-20). Extends D82 (focus point) and D83.

Images could only be fitted (cover/contain/fill) and aimed (focus), so resizing one re-fitted
the picture and nothing kept a chosen part of it.

1. **`crop: { x, y, w, h }`, fractions of the picture** (`CropSchema` in core), on the image
   element. It must stay on the picture (x + w ≤ 1, y + h ≤ 1), so a crop never shows empty
   space; the error shows a valid example. Fractions, not pixels, so replacing the asset or
   optimizing it (D67) keeps the crop. No format version change: it's an optional prop.
2. **Rendered as CSS `object-view-box`.** The picture is cut to the crop first, then `fit`
   and `focus` apply to that part as before, and the percentages are of the picture itself,
   so the plugin never needs its pixel size. **Why:** a few lines instead of a wrapper that
   needs the picture's size before it loads. Chromium only, which is every surface that
   renders a deck today (Electron, the headless renderer, export). An HTML export for other
   browsers will need a fallback (a positioned `<img>` in a clipping box).
3. **Found by its shape, like the focus (D82):** an `{ x, y, w, h }` number prop next to an
   asset prop is a crop field, so a plugin's picture element gets crop mode too.
4. **Crop mode on the canvas.** Double-click an image (or Crop image in the inspector) to
   enter it. The whole picture shows behind the layer, dimmed outside it: drag inside the
   layer to move it over the picture, drag the dimmed picture to pan it behind the layer,
   drag the layer's edges to trim, drag the picture's round corner knobs to scale it (Alt:
   from its centre). Moving and trimming keep the picture put on the slide and change the
   layer's position and size. **Why move, not pan, inside:** you grab the selection, as in
   Photoshop, Canva and phone photo editors (the first version panned there, and moving the
   selection is what people reached for). A layer its stack or grid places can't move, so
   there the picture pans the other way: the same part comes into view. Enter, Esc, a double-click, a click elsewhere or another selection leaves.
   Entering and leaving are view state; each gesture is one "Crop image" transaction (crop,
   plus size and position for a trim). The maths (`model/crop.ts`) works in the layer's own
   axes, so rotated layers crop the same way. With no crop yet, it starts from what the
   layer shows now (cover, aimed by the focus).
5. **Outside crop mode:** dragging an image's corner keeps its aspect ratio unless Shift is
   held (the other way round from other layers, like Keynote and Canva), so resizing scales
   the picture instead of re-cropping it; edges still change the shape. Ctrl/Cmd-dragging any
   handle trims, like crop mode (Figma's quick crop), read live during the drag.
6. **The inspector:** Crop shows Crop image / Done, how much is kept, and Reset (the whole
   picture again). Focus hides while a crop is set: with the layer at the crop's shape there's
   nothing left for it to aim.

`model/crop.test.ts` covers the maths; `phase3-crop.test.ts` covers crop mode, both resize
rules and reset in real Chromium.

## D85 — Grids align their items across the cell too (`justify`)

**Status:** Accepted (2026-11-20).

A grid had only `align` (vertical, CSS `align-items`), so any layer narrower than its
column sat at the column's left: a 200px logo couldn't be centred in its cell.

1. **`justify` on grid layouts**: start | center | end | stretch (default stretch), rendered
   as CSS `justify-items`. **Why `justify`:** it's CSS's word for the inline axis and what
   stacks already use for their main axis, so agents guess it; stack values like
   space-between don't apply to one item in a cell, so a grid takes the four alignments
   only. Optional and additive, so no format change.
2. **Sizing follows it**, as `align` does for height: `"auto"` width stretches across the
   cell only while `justify` is stretch (`stretchedBy`), `"hug"` fits its content and
   follows `justify`, fixed widths are placed by it, `"fill"` always stretches. Grouping a
   grid's layers copies `justify` with the rest of the flow (D54).
3. **The inspector names the axes:** a grid shows Horizontal (Left / Center / Right /
   Stretch) and Vertical (Top / Middle / Bottom / Stretch) instead of one "Align". Stacks
   keep Align and Justify, where cross and main axis is what matters.
4. **Agents:** `get_docs("layout")` documents both, with the logo example.

`phase3-grid-align.test.ts` covers it in real Chromium.

## D86 — The selection's size badge

**Status:** Accepted (2026-11-20).

1. **Always under the selection, not only while dragging:** `176 × 36` in slide pixels,
   centred under the selection's on-screen bounds. One layer shows its own size (rotation
   aside, like the inspector's Width and Height); several show the size of their bounds.
   Whole pixels, or one decimal when a size isn't whole (text that fits its content).
2. **Live, from the canvas:** it's measured from the rendered layer, like the outlines, so
   during a resize it follows the preview with no extra plumbing. The resize and trim
   drags dropped their own size badge at the pointer, which only repeated it; rotate (°)
   and crop scale (%) keep theirs.
3. **Clear of the rotate knob:** when the knob shows below the layer it pushes the badge
   further down (where the knob is, from the layer's rotation); otherwise the badge sits
   8px under the selection. Hidden while typing and while drawing a marquee.

## D87 — On-canvas gradient handles

**Status:** Accepted (2026-11-20). Fulfils D66 §8. §3's linear and radial handles amended by D88.

1. **They show while the paint picker edits a gradient,** on what it paints: the layer, or
   the slide for its background. The layer's resize and rotate handles step aside meanwhile,
   like Figma's. Closing the picker (or leaving the gradient tab) removes them.
2. **The picker stays the owner.** It publishes the gradient it shows, its selected stop and
   its own preview/commit in a small store (`gradient-edit.ts`); the canvas draws from that
   and changes the gradient through the same calls. **Why:** one path for both, so a drag on
   the canvas is one undo step with the same label as a drag on the stop bar, the selected
   stop is shared, and a drag on the bar shows on the canvas live.
3. **What each kind gets**, all in the layer's own axes (the handle layer is sized and
   rotated like the outline), matching what CSS draws (`model/gradient-handles.ts`):
   - linear: its gradient line through the box, as long as CSS makes it; the end knobs
     turn it (Shift: 15° steps). The schema stores an angle, not two points, so the ends
     turn the gradient about the centre rather than moving freely;
   - radial: the centre knob moves the centre; the stops show on a ray to the farthest side;
   - angular: the centre knob, and a knob on a ring that turns where it starts.
4. **Stops are chips beside the guide, on a stem,** not on it. **Why:** a linear
   gradient's 0% and 100% stops sit exactly on its end knobs, and a radial gradient's 0% on
   its centre; beside the line every handle stays grabbable. Drag a chip along to move it,
   away to remove it (at least two stay); click the guide to add a stop colored like the
   gradient is there.
5. **Esc cancels a drag and leaves the picker open:** the popover listens first, so it
   skips Esc while a handle is dragged. Middle-button and Space still pan.

## D88 — Gradients placed freely, and Delete removes a stop

**Status:** Accepted (2026-11-21). Amends D87 §3.

1. **Gradients aren't locked to their box (Figma lets you place them anywhere).** Additive,
   optional fields (format v1 hasn't shipped, so no migration):
   - linear `start`/`end` (default 0 and 1, bounds ±10): where offsets 0 and 1 sit along
     CSS's gradient line, as fractions of it. CSS: each stop at `start + offset·(end − start)`
     percent, which can run past 0–100%;
   - radial `radius {x, y}` (fractions of the box's width and height, > 0): the ellipse
     offset 1 reaches, CSS `rx% ry% at …`. Unset is still `farthest-side`;
   - radial and conic `center` may sit outside the box (the schema never limited it; the
     handles kept it inside).
2. **A linear gradient still runs through the box's centre.** Its knobs go anywhere along
   and around it: the dragged knob lands under the pointer, the gradient turns about the
   centre, and the other knob keeps its place along the line. **Why not two free points
   like Figma:** sliding a linear gradient sideways changes nothing it draws, and two
   points only become a CSS angle with the box's pixel size, which CSS can't know for a
   hug or fill layer. Rendering it any other way (an SVG image) would bake theme colors in,
   losing live theme switches (tokens are CSS variables). So the only visible freedom
   Figma's points add is the ramp's start and end, which `start`/`end` give.
3. **Radial gradients get size knobs** on their ellipse (dashed outline), horizontal and
   vertical; Shift keeps the proportions. Moving the centre pins the size it showed, so the
   glow keeps its shape instead of growing with the distance to the far side.
4. **Delete and Backspace remove the selected stop while the handles show,** wherever the
   stop was selected (canvas chip or the picker's bar), and never delete the layer whose
   paint is open. With two stops left, a toast says a gradient needs two. Typing in a field
   still edits the text. **Why:** deleting the whole layer while editing its fill was a
   trap (before, only a focused stop on the bar caught the key).
5. **Contrast lint follows:** the gradient sampler reads a sized ellipse (`40% 50% at …`,
   verified against what Chromium reports); stops past 0–100% already parse.

## D89 — Every shortcut is a command; the menu bar is a view of the registry

**Status:** Accepted (2026-11-23). Completes D81 §5; round 5's menu bar.

1. **No hard-coded editor keys left.** Undo/redo, the clipboard, duplicate, delete, select
   all/parent/children, edit text, align, distribute, group, auto layout, layer and slide
   order, slide navigation, zoom and the panels are registry commands. One dispatcher
   (`installCommandKeys`) finds the command for a key press; App's 100-line handler and the
   canvas's zoom keys are gone. Gestures stay where they are: arrow nudging (a live preview
   committed on release), Space to pan, F2 in the Layers panel, text formatting inside the
   text editor, and Delete on a selected gradient stop (D88 §4, which runs first). **Why:**
   the command palette, Preferences → Keymap and plugin commands (D79 §4) need every
   command in one list, with its key.
2. **A command says when its keys apply, not just whether it can run.** New spec fields:
   `moreKeys` (Ctrl+Y for Redo, PageDown for Next slide, never shown), `matchKey` (zoom's
   "+" is matched by the character typed, per layout; the clipboard's keys return false
   because the browser's copy/paste events carry them), `inFields` (`"always"` for zoom,
   `"dropdown"` for undo, D73's pass-through), `repeat` (held keys repeat only where it
   makes sense: undo, duplicate, slides, reorder; never Delete) and `keyWhen` (the arrows
   change slides only with nothing selected; Delete removes the slide only from the slide
   list). A key goes to the **first registered command that applies**, so one key can mean
   several things by context: Esc leaves a tool, else selects the parent; Enter edits a text
   layer, else goes into a frame; Delete removes layers, else the slide; Alt+↑/↓ moves a
   layer, else the slide. A test lists the keys shared on purpose and fails on any other
   clash. **Why VS Code's model (`when` on the key, separate from enablement):** the menu
   must still run "Delete slide" when focus isn't in the slide list.
3. **Zoom keys work in fields; the rest wait their turn.** The dispatcher listens twice: in
   the capture phase for `inFields: "always"` commands (fields that stop their keys can't
   swallow Ctrl + "+"), and in the bubble phase for everything else, so menus, the rename
   field, the Add menu and the text editor handle their own keys first. A modal dialog owns
   the keyboard. Commands reach the canvas camera through `camera-controls.ts`, registered
   while the canvas is mounted.
4. **Menu bar: File, Edit, View, Insert, Slide, Arrange, Help.** Each command names its menu
   (`menu`) and group (`section`, a line between groups), so a plugin's command lands in its
   menu without editor code. The roadmap listed six menus; **Slide** was added (new,
   duplicate, delete, reorder) like Google Slides and Keynote, because slide commands in
   Edit or Insert are hard to find. Menus are text only, a check column when an item can be
   checked (panels are radio items, Follow AI a check box), shortcuts on the right. It
   behaves like a desktop menu bar: ←/→ move between menus, open or closed, and while one
   is open, pointing at another opens it. **Why:** this is what Figma, Google Slides and
   every desktop app teach (familiar interactions).
5. **Clipboard from the menu:** Cut and Copy run `execCommand`, which fires the same copy
   event the keys do, so layers reach the system clipboard. Browsers never let a page read
   the clipboard from a click, so Paste from the menu shows a toast naming Ctrl+V (Google
   Docs does the same). The desktop app (Phase 7) can paste from the menu for real.
6. **Narrow windows:** below 1600 px the undo/redo buttons go (the Edit menu and Ctrl+Z
   remain); below 1280 px the menu bar folds into one ☰ menu with each menu's name as a
   heading, scrolling if it's taller than the window. **Why:** at 1440 px (the common
   laptop) the deck name was cut to three letters; tools stay centred (D81 §6).
7. **Help → Keyboard shortcuts (Ctrl+/)** lists every command with a key, by menu, plus the
   canvas gestures. It's a view of the registry, so plugin shortcuts appear there too, and
   Preferences → Keymap grows from it.
8. **No zoom pill on the canvas** (it was D60's): View holds zoom in/out, fit, 100% and
   selection, each with its key, so the floating pill only covered the slide's corner.
   **Trade-off:** the zoom percentage is no longer shown anywhere; if it's missed, it goes in
   the top bar (Figma's spot), not back on the canvas.

## D90 — Workspace panels resize and collapse; the switcher waits for a second workspace

**Status:** Accepted (2026-11-24). Implements D53 §1–3.

1. **A workspace is a preset of panels** (`model/workspace.ts`, pure): each panel has a
   label and, if its edge resizes it, a size range and the most of the window it may take
   (left panel 180–400 px, at most 20 % of the width; inspector 260–480 px, at most 26 %).
   Design is the only one; Phase 4 adds Animate and Present as more presets. **Why:** D53
   keeps workspaces as views over the same deck, so a preset is all a workspace needs.
2. **No switcher until there's a second workspace.** **Why:** a switcher with one choice is
   an empty control, and D53 §3 already rules out empty tabs. The layout is already stored
   per workspace, so Phase 4 only adds presets and the switcher.
3. **Side panels resize by their edge, VS Code's sash:** drag to resize; drag past half the
   minimum to collapse (the size is kept for reopening) and back out to reopen; double-click
   for the preset size. The edge lights up after a short rest. It's the WAI-ARIA window
   splitter, so the keyboard works too: arrows resize (Shift: ×4), Home/End go to the
   smallest/largest, Enter collapses or reopens. Its keys never reach the editor's own (the
   arrows change slides there).
4. **Collapsed side panels come back** from a button in their corner of the canvas, from
   View → Left panel / Inspector (check boxes), or Ctrl+\ for both (Figma's Show/Hide UI).
   Alt+1–4 or View → a tab opens the left panel on that tab.
5. **Speaker notes only collapse,** from their header (PowerPoint's Notes button) or View.
   **Why:** they already grow with their text, so a height to drag would fight that.
6. **During a drag the panel is sized directly in the DOM** (`--panel-size`), and the layout
   is saved once, on release. **Why:** the layout re-renders the whole editor, and doing that
   on every pointer move is wasted work.
7. **The layout is stored per browser profile (localStorage), not in the settings file.**
   **Why:** it's how this window was left, like VS Code's layout, not a preference (D53 §5).
   A stored layout is parsed defensively (unknown workspaces or panels and broken values are
   dropped, sizes clamped), so another version's layout can't break the app. Trade-off: the
   web editor on another port or machine starts from the presets.

## D91 — Preferences: one settings file the server owns, applied live

**Status:** Accepted (2026-11-24). Implements D53 §5.

1. **One file per user, owned by the server** (`SettingsStore`, doc-server): where each OS
   keeps app settings (`~/.config/veloce/settings.json` on Linux, `%APPDATA%\Veloce` on
   Windows, `~/Library/Application Support/Veloce` on macOS), or `--settings` /
   `$VELOCE_SETTINGS`. Never in a `.veloce` file, never an op: no undo, no history, agents
   don't change it. **Why:** they're how this person works, not the deck (D53 §5); the
   server already owns every file, and Electron will use the same folders.
2. **No setting ships that does nothing.** The Interface tab (UI scale, light/dark) waits
   for Phase 7: CSS `zoom` on the page moved every popover (the View menu opened 27 px off
   its button at 125 %), while Electron's zoom factor scales everything consistently; and
   there's no light token set yet. A tab with nothing in it would be an empty tab (D53 §3).
3. **One Zod schema in core** (`SettingsSchema`) serves the file, the sync protocol and the
   dialog. Reading is forgiving field by field: a missing, broken or out-of-range value
   falls back to its default and the rest is kept; a file that isn't JSON is copied to
   `settings.json.broken` before anything overwrites it. Writing is strict: a patch with an
   unknown field or a bad value is refused with the field named. A `version` field leaves
   room for a migration. **Why:** a hand edit or another version's file must never stop
   the app from starting, and nothing invalid ever gets written.
4. **Live over the sync socket.** Every tab gets a `settings` message on connecting and after
   every change; `settings.update` changes some fields. The server applies the autosave
   pause and undo depth to the running workspace at once (the undo limit is read at each
   step). The decks folder and the port apply at the next start, and the dialog says what's
   in use now. Precedence at start: a flag, then the environment, then the setting, then
   the default, so a one-off `--port` never changes what's saved. **Why:** settings are
   server state like the deck, so no tab can disagree with the file.
5. **No Save button** (VS Code, Figma): each change applies and is saved at once, and
   nothing changes optimistically (the server answers in about a millisecond). Fields read
   like the inspector's: the default as a grey placeholder, a changed value with a reset
   button.
6. **What each setting changes:** Snapping off works like holding Alt on every drag. The
   nudge distances replace 1 / 10 px. Lint off, or a muted rule, only changes what this
   editor shows (the Issues tab and badges): agents always get every issue. Follow AI sets
   the top bar switch when the setting arrives or changes.
7. **Keymap is the shortcut list with a search** (by name, keys or keywords), the same view
   of the registry as Help → Keyboard shortcuts (D89). Rebinding waits for after 1.0.

## D92 — The command palette: one search over commands, settings, slides and layers

**Status:** Accepted (2026-11-24). Implements D53's palette; reads the registry (D81, D89).

1. **Ctrl/Cmd+K** opens it (Figma, Linear, Slack, Notion), and so does **View → Command
   palette…**. Ctrl/Cmd+Shift+P works too, unlisted, for VS Code hands. A search box near
   the top of a dimmed window; arrows, Enter, Esc; a press outside closes it; focus goes
   back where it was. **Why:** one place to reach everything is what keeps a big app easy
   to learn, and it's the one most tools agree on.
2. **It lists the registry**, so every menu command, tool and Add menu layer is in it with
   its keys, and a plugin's commands will be too with no extra code (D79). A command can
   opt out (`palette: false`): key-only plumbing (Esc's "Back to Select") and the palette
   itself. **Commands that can't run now stay listed, dimmed and last**, and Enter leaves
   them alone. **Why:** hiding them makes "Align left" look missing when nothing's selected
   (JetBrains' Find Action does the same).
3. **Settings:** on/off ones (Snapping, Check slides, Follow AI at start) flip in place with
   a check mark; the rest open Preferences on their tab. **Slides** (by number, name or first
   text) go to that slide; **layers** of every slide go to the slide and select the layer.
4. **Ranking:** every word typed must start a word of the name, its context (menu, slide)
   or its keywords. The best matches lead, whatever their kind: a label that starts with
   the query, then whole words, then word starts, then context or keywords. Sections
   (Commands, Settings, Slides, Layers) follow their best match. So "1" puts Slide 1 before
   Zoom to 100%, and "snapping" puts the setting before Preferences…. Words are letters
   and digits of any script ("Café", "日本"). Each kind shows its best few (layers 12), so
   a deck with thousands of layers stays instant. **Why:** a fixed kind order made the
   first result wrong for numbers and setting names, which the test caught.
5. **With nothing typed:** the last 5 commands run (this browser, like the Add menu's
   recent list; storage is optional), then every command.

## D93 — Versions: named copies of the deck, kept inside its file

**Status:** Accepted (2026-11-24). Round 5's "snapshots" (the sync protocol's `snapshot`
message is something else, so code and UI say "versions").

1. **Inside the `.veloce` file:** `versions/<id>.json`, each `{ name, savedAt, deck }` with
   the whole deck. Asset files are shared with the deck by content hash, so a version
   costs its JSON (a 6-slide deck: ~4 KB zipped). A format addition: an older reader skips
   the folder as unknown files, and no Veloce has shipped without it. **Why not beside the
   file:** a copied, mailed or moved deck would lose its safety net, and the format
   promises one self-contained file.
2. **Untrusted like the rest of the file, never fatal:** each version is migrated and
   validated like the deck, its assets hashed (each file once), and a version that isn't
   JSON, is too new, is invalid or misses an asset is skipped with a warning while the
   deck opens. Writing refuses bad version IDs and bytes nobody registers. At most 100
   versions per deck. **Why:** a damaged version must never cost you the deck.
3. **Saving and deleting aren't ops:** they change no slide, so there's nothing to undo,
   and they're the user's file management, not edits. The file is written at once (not
   after the autosave pause), and every tab of the deck gets the new list. Delete asks
   twice ("Delete … for good") because it can't be undone.
4. **Restore is one ordinary transaction** (`restoreOps`): remove every slide, drop the
   assets the version didn't have, add the ones it had, insert its slides, and set its
   theme and meta if they differ, as the client's origin. So Ctrl+Z (or the toast's Undo)
   brings back what was there, including an agent's rewrite, and agents hear about it like
   any change (D71 §5). Not the stage: no op changes it. **Why remove-and-insert every
   slide:** plain and always correct; the history holds a big step only as long as it
   holds any.
5. **Read-only preview** in File → Versions: the version's slides drawn by the same
   renderer from the deck the server sends (`version.open`), so nothing in it can be
   edited. The server keeps every version's asset bytes (the sweep, D65) and serves them
   (`assetInfo` checks the versions too), so a version's images show and come back on
   restore.
6. **Kept out for now:** agents saving versions (an MCP tool, or a version made
   automatically before an agent's first change of a session), renaming, and comparing
   versions. **Privacy:** a shared file carries its versions, old content included.
   Delete version clears them; Phase 8 adds "Save a copy without versions", and exports
   never include them.

## D94 — Components: saved subtrees, inserted as plain copies

**Status:** Accepted (2026-11-24). Round 6. Linked components stay in "After 1.0".

1. **Copy on insert, never linked.** A component is a template node plus a few params;
   inserting one (`instantiateComponent` in core) makes an ordinary node with fresh IDs.
   Nothing on a slide points at a component, so undo, morph, lint, export and every op work
   on copies as they do today, and changing or deleting a component never touches its
   copies. **Why:** linked instances need an override model and invertible ops across
   instances (After 1.0); copies give agents the win now (a card defined once instead of
   rebuilt 4–8 times per slide) with no new rules anywhere else.
2. **Stored per deck, in `document.json`:** `components` keyed by name, omitted when there
   are none. A format addition: optional, so files without it mean what they did, and no
   Veloce has shipped without it. Names are words in any script joined by single spaces,
   `-` or `_` (agents type them in `use`), unique ignoring case. At most 200 per deck, 20
   params each. Template IDs are their own namespace (a copy gets fresh ones).
3. **Saving and removing are ops** (`component.save`, `component.remove`), each with an
   exact inverse, unlike versions (D93 §3). **Why:** a component is part of the document an
   agent builds with, so it's undone with the change that made it (undo per origin, golden
   rule 7), agents hear about it, and versions restore it (`restoreOps` diffs components).
   A component's image counts as a use: `asset.remove` is refused under it, and its bytes
   are kept.
4. **Params are pure data:** `{ description?, targets: ["<node ID>.<field>"…] }`. Inserting
   `{ "use": "Card", "with": { "title": "Q3" } }` writes each value at its targets (`null`
   removes the field), then the copy is validated like any node: a value that doesn't fit
   is reported against its param (`with.title: …`), an unknown param suggests the nearest.
   Targets can't write `id`, `kind`, `type` or `children`, only fields an edit may change,
   and writing walks own keys only (no prototype keys, even `constructor`). No code, no
   expressions. **Why:** the schema stays the one source of truth for what's valid
   (golden rule 5), and a malicious file can't do more than a bad edit.
5. **Readable IDs for copies:** the copy's root takes the given `id`; inner nodes get
   `<copy id>-<template ID>`, without the template root's prefix (`card-title` in copy `c1`
   is `c1-title`), or a generated ID when that's taken. **Why:** an agent can edit a copy's
   title right after inserting it, without reading the slide back.
6. **MCP:** `save_component` (a `node` like upsert_slide's, or `from` a node on a slide;
   params as one target, a list, or `{ description, targets }`; replacing needs
   `overwrite: true`) and `list_components` (params and template outline). `{ use, with }`
   works anywhere a node goes, and is expanded where MCP input is normalized, so core ops
   and the undo log only see plain nodes (golden rule 1). The deck summary names the
   components; `get_docs("components")` explains them. save_component lists a compact
   schema (its `node` is upsert_slide's), keeping tool listings small.
7. **Editor:** Arrange → Save as component… (one layer; no shortcut, Ctrl+Alt is AltGr,
   D89) offers each text as a param, renamable or left out, and drops where the layer sat
   (position, anchor, free): a copy is placed where it's inserted. The Components tab
   (Alt+5) lists them A to Z with a preview: the template laid out at the deck's stage
   size, the camera framing its measured box (at most 50%). A click inserts a copy where
   the Add menu would put a layer; the bin deletes the component (one undo step, copies
   stay). The command palette finds components by name ("Insert component").
8. **Kept out for now:** dragging a component onto the canvas, editing a component in
   place, a library shared between decks, and linked instances (After 1.0). Slide layouts
   come next, as slide-level components with the same `use`/`with`.

## D95 — Slide layouts are slide-level components, with built-in ones

**Status:** Accepted (2026-11-24). Round 6. Builds on D94.

1. **A slide layout is a component with `slide`** (`{ background? }`): its node is a
   slide's root frame, and `use` makes a whole slide (`instantiateSlide`). Same record,
   ops, params, undo and file storage as components; one name space. **Why:** one
   mechanism for agents and code, not a second, parallel store.
2. **Slots:** a component (layout or not) may name a frame as its `slot`; children given
   with `use` replace that frame's placeholder content. `Title and content` fills its
   `content` frame this way, so an agent writes a whole slide in one call:
   `{ "use": "Title and content", "with": { "title": … }, "children": [ … ] }`. Without a slot,
   children are refused with a hint (insert them with node.insert).
3. **Built in, from theme tokens only:** Title, Title and content, Two columns, Section
   header (on the primary color), Big number and Quote live in core (`BUILTIN_LAYOUTS`), not
   in files, so every deck has them and they take on its theme (a test checks each token
   exists in every built-in theme). A deck's own component with the same name (ignoring
   case) replaces the built-in for that deck. Names follow D94's rule, so "Title and
   content", not "Title + content": agents type them.
4. **IDs from the slide's:** a slide `s3` made from a layout has `s3-title`, `s3-content`.
   When an agent rebuilds its own slide with upsert_slide, the old slide's IDs are free again,
   so the copy gets the same readable IDs (applies to D94 copies inside it too).
5. **MCP:** `upsert_slide` (and `slide.insert`) take `use` / `with` on the slide; `layout`
   and `style` are refused next to `use` (they come from the layout). `save_component`
   `from: "<slide id>"` saves a slide layout, and `slot` names a slot. `list_components`
   lists layer components, then every layout (own and built-in), with slots; the deck
   summary names the layouts. Mixing them up (a layout as a node, a component as a slide)
   says which to use.
6. **Editor:** Slide → New slide from layout… shows every layout drawn in the deck's theme,
   the deck's own first; a click adds the slide after the current one and goes there. The
   deck's own can be deleted (one undo step; slides made from them stay). Slide → Save slide
   as layout… saves the slide on screen (its background too), its texts offered as params.
   The command palette finds layouts ("New slide from layout"). Previews are decorative
   (`aria-hidden`), so a card's name is its accessible name.
7. **Kept out for now:** applying a layout to an existing slide, editing a layout in place,
   per-theme layout variants beyond tokens, and layouts shared between decks (After 1.0).

## D96 — Documentation: a map now, user docs before 1.0, generated wherever possible

**Status:** Accepted (2026-11-24).

1. **Now:** a README that gets someone running (quick start, connecting Claude Code, what
   works) and [ARCHITECTURE.md](ARCHITECTURE.md), a one-page map of the packages, how a
   change flows and where to start reading, linking here for the why. **Why now:** the
   architecture is settled and the project is big (8 packages, 95 decisions); a map pays
   off at once for every session and contributor, and it barely goes stale. CLAUDE.md
   asks that a change that makes it wrong updates it in the same change.
2. **Before 1.0, not after:** the user guide, plugin developer docs (Phase 9) and the
   `.veloce` format spec (Phase 10). **Why:** 1.0 is the public launch: it promises
   third-party plugins and a stable file format, and an app people install needs a guide.
   **Why not now:** half the UI (Animate, Present, desktop, export) doesn't exist yet, so
   walkthroughs and screenshots written today would be rewritten before launch.
3. **Generated, not written, wherever the app already knows the answer:** keyboard
   shortcuts from the command registry, element props from their Zod schemas, MCP tools from
   their definitions, lint rules from `LINT_RULES`, as the agent docs already are (D13).
   **Why:** hand-written references drift; generated ones can't.
4. **After 1.0:** tutorials, videos and translated docs.

## D97 — Slide numbers, footers and sections

**Status:** Accepted (2026-11-24). Round 6, its last item.

1. **Fields are text runs:** `{ "text": "", "field": "slideNumber" | "slideCount" | "date" |
   "deckTitle" | "section" }`, like PowerPoint's and Keynote's fields, not a `{{slide}}`
   syntax in strings (that would turn a code slide's literal braces into numbers). `text`
   keeps what the field showed when written: search, copy and lint read it, and a lone
   element drawn outside a slide shows it.
2. **The renderer fills them in, the plugin draws them.** `ElementContext.fields()` gives the
   slide's values (core `fieldValues`); the text plugin draws `runText(run, values)`. Values
   change without the slide changing (another slide moved, the deck was renamed), so every
   render compares them and calls `update(props)` on the elements whose props hold a field
   run. **Why not substitute in the renderer:** it can't tell a text run from another
   plugin's own `field` key (a chart's data field); a false positive here only costs a
   redundant `update`. The date is today's (an option pins it for tests and exports), long
   style in the deck's language.
3. **The footer is deck settings:** `footer: { text?, slideNumber?, date? }`, set with a new
   `deck.setFooter` op (whole value, `null` removes it; versions restore it), drawn by the
   renderer over every slide as core's `footerNode` (date left, text centered, number right,
   `$text.small` in `$color.muted`, inside the slide's margin), through the same code as
   the slide's nodes. Its IDs start with `_`, which deck IDs can't, so selection, lint and
   ops never meet it; it's click-through and not measured. A slide opts out with
   `hideFooter`; the built-in Title and Section header layouts set it (PowerPoint's "Don't
   show on title slide"), and saved layouts keep it. **Why not nodes on each slide:** one
   setting changes every slide, agents can't forget a slide, and nothing drifts.
4. **Sections are markers, not a list:** `section: "<name>"` on the slide that starts one;
   it runs to the next. Slide ops can never leave a list out of step, and it's one field
   for agents. The editor keeps PowerPoint's behaviour on top (`model/sections.ts`): a
   section keeps its slides when its first slide moves away or is deleted, Alt+↑/↓ cross a
   section's edge into the next one without moving, a drag drops where the rail shows it
   (above a header ends the section before; under it, starts that one), and a duplicate
   joins its original's section. A section left with no slides is gone (sections can't be
   empty here). Agents' raw `slide.move`/`slide.remove` move the marker with the slide,
   which the docs say.
5. **Editor:** Insert → Footer and slide numbers…; Show footer in the Slide settings; the
   text toolbar's Insert field menu (fields are atoms you step over, shaded while typing);
   Slide → Add, Rename, Remove section and Move section up/down; section headers in the
   rail collapse (per tab), rename on double-click and remove (the slides stay).
6. **MCP:** `section` and `hideFooter` on slides, `deck.setFooter` in apply_ops, field runs
   in the text docs, the summary marks where sections start and shows the footer (only when
   there is one: tokens), and the design docs say to set the footer instead of drawing
   numbers by hand.
7. **Later:** sections in presenter view come with presenter view (Phase 4); a footer
   overlapping a free layer isn't linted yet; numbering that skips hidden slides or starts
   at another number waits for a user who needs it.
8. **After the first agent test:** the Title layout's title is a `deckTitle` field and the
   Section header's a `section` field until a param replaces them, so they follow renames
   (the editor asks for the new section's name when a Section header is added, and its
   preview shows a sample). A slide's ID works as `parentId` for node.insert/node.move
   (its root frame's ID is generated, and unknowable for a slide made in the same batch),
   and apply_ops lists new slides' root and inner IDs. Field runs may leave out `text`
   (MCP fills `""`); outlines show them as `{slideNumber}`. The empty-space hint points at
   a frame that fills the slide (a layout's content slot) and says it can be left. A
   `get_docs("sections")` topic covers all of it. **Why:** an agent building a sectioned
   deck hit each of these; none showed up in scripted tests. The retest added a
   `section-field` lint (a section field on a slide in no section shows nothing; a title
   showing the name of a section that started earlier is a stale section header), a
   `[no section]` mark in the summary, a "a run needs text or field" error, and a worked
   example of a corner label as a free layer (free positions ignore the frame's padding,
   which the schema description had wrong). Round 2: apply_ops also lints slides a change
   moved into another section without naming them (a section field there may now be
   wrong); numbered lists get room for their markers (1.8em, bullets 1.2em); and the
   empty-space hint no longer says to center a layout's slot, which floats the content away
   from its title. Round 3: free layers among a layout slide's `children` go on the slide,
   not in the slot (a corner label in one call, even on a layout with no slot); a bad
   footer key's hint names the footer's keys; the summary says "no footer" only when the
   deck has one. Round 4 found no bugs; apply_ops now also says which slides a change
   moved into another section, and outlines keep paragraphs apart (" / ").

## D98 — A `lead` text style, format v2, and layouts that fill the slide

Four agent test rounds (D97 §8) hit the same three things: the built-in Title and content
and Two columns layouts set short text in `$text.body` and look empty, every such slide drew
an empty-space hint, and agents reached for `$text.h2`/`h3` to make bullets bigger, which are
bold headings.

1. **`$text.lead`:** large body text, regular weight, in the body font: 1.5× `body`,
   otherwise like it (48px in the built-in themes; PowerPoint's 28pt body is ~56px on this
   stage, so `body` at 32 reads small for bullets). Like Keynote's and Google Slides' large
   body styles. The two layouts also put `$space.lg` between title and content. The two content layouts set their text in it, and the docs steer bullets
   to it.
2. **Format v2:** themes live inside each deck, so a deck from before has no `lead`. The
   v1→v2 migration (the first) adds it, derived from that deck's own `body` the same way,
   so a theme with its own fonts keeps them; a theme that already has one keeps it.
   **Why a migration, not a lookup fallback:** `theme.text` is read directly (theme CSS,
   the style picker, the theme dialog, the theme docs); filling it once at load keeps every
   reader simple, and an older Veloce refusing a v2 file is right, since it would show
   `$text.lead` as missing. The migration's logic is its own, not core's, so it never
   changes after release. Fixture: `packages/format/src/__tests__/fixtures/v1-*.json`.
3. **Empty space in a content area:** a short list at the top of a frame that fills the
   slide under its title is the usual slide (PowerPoint anchors content to the top), so
   the hint there waits for 70% empty instead of 40%: one line under a title, not three
   bullets. Elsewhere it's unchanged.
4. **A label on many slides:** the sections docs show saving the corner label once with
   save_component and adding `{ "use": "Section label" }` to each slide; with D97 §8's
   routing it lands on the slide, even on a layout with no slot.
5. **From the agent retest of this:** a copy inserted without an ID is named after its
   component (`section-label`, `section-label-2`), not `nd_…`, so lint messages and Layers
   read like the deck (slide layouts keep the slide's prefix); a frame written with
   `"type": "frame"` gets a hint saying frames have no `type`; and the summary says
   `Footer: none.` when there's none, so a removed footer isn't mistaken for a hidden line.
   The summary's `[no section: slides 1–3]` says how far the slides before the first section
   run, and the sections docs say how to rename one.

## D99 — Deleting decks: to a trash folder, with Undo

There was no way to remove a deck. File → **Move deck to trash** (also in the command
palette) takes the open deck away; a toast offers **Undo**, as for other destructive edits
(no "are you sure?").

1. **A trash, not a delete:** the file moves to `.trash/` in the decks folder, named
   `<ms>-<file>`, like Google Slides' trash or the OS trash. Undo (sync `restore`) moves it back
   this session, under its old name if it's free, and makes it the active deck. Trashed
   files over 30 days old are removed when the workspace opens; the trash isn't scanned
   as decks. **Why our own folder, not the OS trash:** Node has no trash API without a
   dependency, the server may run headless, and it keeps Undo exact. Electron can switch to
   `shell.trashItem` later.
2. **Safe against late saves:** pending edits are saved before the file moves, so a restore
   brings back exactly what was there; after that, a save of the removed deck does nothing
   (a stale `OpenDeck` someone still holds can't write the file back).
3. **Every tab follows:** deleting the active deck makes the most recent other one active
   and every tab switches to it; with none left, tabs show no deck and File → New works.
4. **Manage decks** (File → Manage decks…): every deck, most recently edited first, with
   search, to open one or trash several in a row. Its Undo was a bar inside the dialog,
   because a modal `<dialog>` made the toast behind it inert (superseded by D108: the toast
   now shows inside the dialog). Restoring
   makes the deck active only if it was active when trashed, so undoing the trash of some
   other deck doesn't move anyone's view.
5. **Not for agents:** MCP has no delete tool: removing a whole deck is the user's call. An
   agent whose current deck was trashed is told the user moved it to the trash and not to
   recreate it.

## D100 — Motion is the animation driver; GSAP isn't shipped

**Status:** Accepted (2026-11-24), at the Phase 3 → 4 gate. Supersedes D14. §1 superseded by
D105 (our own timeline in core; Motion optional).

1. **Motion** (motion.dev, MIT) is the only `AnimationDriver` Veloce bundles. GSAP isn't
   shipped, not even as an optional plugin. **Why (new information since D14):** GSAP's
   Standard "No Charge" License (Webflow, 2025-04-30) has a "Prohibited Uses" clause: no use
   in tools that let people build visual animations without code in a way that competes with
   Webflow's visual animation builder. Veloce's Animate workspace is a no-code visual
   animation builder, and Phase 8 exports animated standalone HTML: at best a gray area, and
   "competing" is the licensor's call. On top of that, the license isn't OSI-approved (no
   GPL forks, no Debian main). Motion has none of these limits.
2. **Nothing else changes:** decks store animation intent (D5), the driver sits behind
   the `AnimationDriver` interface, and plugins still implement `seek(t)` on the one clock
   (golden rule 3). Check Motion's license and version when it's added (CLAUDE.md), and
   use only its MIT core, not the paid Motion+ extras.

## D101 — Suggestion mode fits without a format break; what Phase 4 must keep true

**Status:** Accepted (2026-11-24). A design note, not a feature: suggestion mode ships after
1.0. Resolves the Open question that gated Phase 4's timeline schema.

**The question:** could agent edits later be held as a reviewable change set (the user sees
them, then accepts or rejects them, per origin like undo) without breaking `.veloce`?
**Answer: yes**, if Phase 4 keeps the six rules in §2.

1. **The shape it would take:** a suggestion is a list of ordinary transactions held
   **beside** the deck, not applied to it. Nothing about suggestions goes in
   `document.json`, and nothing like Google Docs' inline suggestion markup either.
   - _Preview_ applies them to a copy of the deck. Structural sharing makes that cheap, and
     the read-only versions preview (D93 §5) already draws a deck that isn't the live one.
   - _The agent sees its own work:_ its session reads, lints and previews the live deck
     with its pending ops applied on top. When the live deck changes, those ops are
     re-applied (rebased) to it.
   - _Accept_ applies the ops to the live deck as one **`user`** transaction ("Accept:
     <label>"), the same way Revert is the user's own change (D71 §2). So Ctrl+Z takes it
     back, undo stays per origin, and the agent hears about it in its digest (D71 §5).
   - _Reject_ throws the ops away. The deck never changed, so there's nothing to undo.
   - _Conflicts:_ an op that no longer applies (its node was removed) fails, like a stale
     revert. A field the user changed since the suggestion was made is caught by
     comparing the suggestion's inverse (the values it saw) with the live deck. The review
     UI shows those ops as conflicts instead of silently overwriting the user's edits.
     **Why beside, not inline:** inline markup would change the document format and every
     reader of it. Ops held beside the deck are the same ops humans and agents already send
     (golden rule 1), so the feature adds a holding area and changes nothing in the model.
2. **What Phase 4 must keep true** (these also serve concurrent editing today):
   1. **Animations have IDs and are edited by their own ops**, like nodes
      (`animation.insert/update/remove/move` keyed by animation ID, or the same thing
      under other names). They must not be one array patched on the slide. **Why:** a
      merge patch replaces an array whole. A held suggestion that rewrote `animations`
      would wipe, on accept, every animation the user had added since. The same thing
      happens right now if the user and an agent edit one slide's animations at the same
      time (Phase 3's "Done when": no conflicts). MCP's `set_animations(slideId, steps)` can
      stay a friendly whole-slide call, turned into per-animation ops the way `upsert_slide`
      input is normalized.
   2. **References use IDs, never positions.** An animation's `target` is a node ID, and
      steps aren't numbered in storage (the step order can be derived from triggers), so a
      held op still means the same thing after other edits.
   3. **Removing a node removes the animations that target it, inside the same op,** and the
      inverse puts them back exactly. **Why:** otherwise a rebased suggestion (or an undo)
      ends up with animations pointing at nothing, and whether that fails depends on
      ordering.
   4. **Ops stay deterministic:** `applyOp` never makes IDs, reads the clock or uses
      randomness (true today: components make IDs while building ops, not while applying
      them). Rebasing re-applies ops, so the same ops must give the same deck.
   5. **Only document state goes through ops.** Presenter state (current slide or step,
      timer, laser pointer) and the Animate workspace's playhead are view state, like zoom
      (D60), not deck fields. Anything else in `document.json` changes only through ops.
   6. **Transitions and morph settings are slide or node fields patched by key** (objects,
      not arrays), so the existing merge-patch rule applies field by field.
3. **No new origin kind.** Pending ops keep their author's origin (`agent:<id>`); "pending"
   is where they sit, not who made them. When suggestion mode is built, the sync protocol
   gets additive messages (`suggestion.*`, an `accepts` link on change entries, next to
   `reverts` / `restores`). That's the protocol, not the file format.
4. **If suggestions are ever kept in the file**, stored ops become part of the format. The
   choice then is `suggestions/<id>.json` with the format version it was written in,
   handled like versions (D93 §2): an older reader skips the folder, and a suggestion that
   is too new or can't be migrated is dropped with a warning, never fatally. The first
   version can keep suggestions in memory only, for the session, and avoid this entirely.
5. **Kept out:** building any of it before 1.0, suggestions from the user (the "track
   changes" mode for people), and partial accept below one op.

## D102 — Visual regression tests: frozen reference decks, compared pixel by pixel

**Status:** Accepted (2026-11-24). Phase 4's first item, so the renderer work after it
can't silently move a pixel in existing decks.

1. **What's compared:** reference decks in `tests/visual/decks/` (5 decks, 14 slides, 5
   built-in themes), covering text styles, rich runs, lists, fields and the footer;
   stacks, grids, wrap, sizing, padding; free layers, anchors, rotation and opacity; every
   paint, strokes, shadows, clip; image fit, focus and crop; the built-in slide layouts and a
   component. Each slide is rendered by the real render worker
   (`PlaywrightRenderService.screenshot`, the same path as `render_preview`) at the stage's
   full size and compared with `tests/visual/screenshots/<deck>--<slide>.png`.
2. **The decks are frozen "existing decks":** JSON as stored, loaded like a file (migrated
   from its format version, validated, written as a `.veloce` and opened by the
   workspace), so a future migration is tested on them too. They were built once through
   MCP, the way an agent builds a deck, then saved. Don't edit one to make a test pass: add
   a deck or a slide. Nothing in them changes by itself: no `date` field or footer date.
3. **Comparison:** pixelmatch (ISC) with pngjs (MIT), root dev dependencies. Anti-aliased
   pixels are detected and ignored; everything else must match (threshold 0.1, **0 differing
   pixels allowed**). A 1px move of a rotated shape gives 14 differing pixels, of a small
   text label 119, both caught. **Why not a tolerance:** the same baselines match exactly on
   Fedora 44, Ubuntu 24.04 and Ubuntu 26.04 (CI's `ubuntu-latest`), checked in containers,
   because Chromium brings its own FreeType and HarfBuzz and the fonts are bundled. Raise
   the limit only with a CI diff that is noise, and record it here. **Why not SSIM** (which
   `@veloce/images` has): it scores how alike images _look_, so a small shift scores near 1.
   **Why not Playwright Test's `toHaveScreenshot`:** a second test runner beside Vitest.
4. **Workflow:** a mismatch writes `<slide>.actual.png` and `<slide>.diff.png` to
   `tests/visual/.output/` (git-ignored; CI uploads it as the `visual-diffs` artifact). After a
   deliberate visual change: look at the diffs, run `pnpm test:visual:update`, and commit the
   new screenshots with the change, so the review shows the before and after. Stored
   screenshots of slides that no longer exist fail the test. 14 screenshots are ~0.9 MB.

## D103 — The motion slot: the renderer draws motion on top of the rest position

**Status:** Accepted (2026-11-24). Phase 4's foundation, implementing D83 §5's rule
"layout is where a layer rests; motion is a transform on top".

1. **`MotionState` in core** (`motion.ts`): offsets from rest (`x`, `y`, `z`, `rotate`,
   `rotateX`, `rotateY`, `scale`, `scaleX`, `scaleY`, `opacity`, `blur`), all optional.
   Not document data: the timeline will produce it for a moment on the one clock, and
   nothing stores it. `resolveMotion` clamps it (opacity 0–1, no negative blur or scale,
   non-finite values at rest), so a plugin effect or an easing overshoot can't produce
   invalid CSS or a mirrored layer. It's in core because the clock that produces it will be.
2. **The renderer is the only writer** of a layer's `transform`, `opacity` and `filter`:
   `SlideRenderer.setMotion(map)` (and `SlideView.setMotion`) keeps each layer's motion and
   `nodeBoxCss` composes it with the layer's rotation, anchor shift and opacity
   (`drawnCss`). **Why:** `applyCss` clears an element's inline style on every restyle, so
   motion written by anyone else would vanish when an edit lands mid-playback; and the
   rotation and anchor centering already live in `transform`, so a second writer would
   overwrite them.
3. **Composed directly, not through CSS variables.** **Why:** custom properties inherit, so
   a parent's motion variables would reach every child without its own and move it twice.
4. **Transform order** (right to left, about the box's centre): scale and the 3D flips act
   along the layer's own axes, then its rotation (its own plus the motion's), then the move
   along the frame's axes, then a centred anchor's shift. So a rotated sticker moves where
   you point, stretches along its own edges and stays centred on its anchor, as in After
   Effects. Proven by real-Chromium geometry (`tests/integration/phase4-motion.test.ts`),
   which fails when the order is broken.
5. **At rest nothing changes:** a layer without motion gets byte-identical CSS (document
   values are never rounded; animated ones round to 4 decimals for short, stable strings),
   and the visual regression tests (D102) showed 0 changed pixels.
6. **Cheap per frame:** `setMotion` replaces the whole map each call (the clock passes
   everything that moves), touches only layers whose motion changed (compared by value),
   writes only those three properties, and never calls plugins or re-runs layout. IDs not
   on the slide are kept, so a layer an edit adds mid-playback starts where it should.
   `measure()` reports where layers are drawn, motion included: lint measures at rest.
   No `will-change` yet: promoting every animated layer to its own GPU layer costs memory;
   decide with the Phase 10 performance budget, measured.
7. **What it means for the rest of Phase 4:** FLIP layout animations need the clock and the
   timeline (they animate between two layouts), so they move after them. 2.5D needs new
   document fields (perspective on frames), so it lands with the other schema changes.
   The morph match key, the timeline, 2.5D, the motion level and `$motion` tokens (D104)
   ship together as **one** format version (v3), one migration and one "this file needs a
   newer Veloce" step for users, not several.

## D104 — Motion levels, motion tokens and choreography: animation-heavy without lag

**Status:** Accepted (2026-11-24). The user's product direction: Veloce is animation-heavy
and unique in it, not a copy of other apps, and never lags the device. The user (or an
agent, on the user's word) chooses between a simple deck with simple animations and a
heavy deck with an absurd amount of them.

1. **A motion level, set by the user or an agent:** `calm`, `subtle`, `lively`, `intense`,
   `absurd`, on the deck, with per-slide overrides (a wild intro, calm data slides).
   Stored in the deck (format v3), so every agent and person sees the same setting
   (golden rule 1), and set from the New deck dialog, the Animate workspace and MCP.
   **Why a level, not a list of effects:** "make it calm" or "go absurd" is how people
   describe motion, and one setting keeps a whole deck coherent.
2. **`$motion` tokens in themes,** next to `$color`, `$text` and `$space`: easing family,
   durations, stagger rhythm and signature transitions. A theme gives a deck a motion
   personality; the level scales it. **Why:** it's what makes Veloce's motion its own, and
   it fits the structured model (agents pick tokens, not milliseconds).
3. **Choreography from intent:** a rule-based engine turns an intent ("reveal the points one
   by one, punch the number") into ordinary animations, from each layer's role (title,
   body, number, visual), reading order, the slide's level and the theme's tokens. MCP
   exposes it (few tools, high leverage: a tiny payload buys a whole sequence), and the
   editor's "Animate this slide" calls the same engine with no AI key. Its output is
   plain, editable animations. **Why:** parity (golden rule 1) and the unique part no
   other tool has.
4. **No lag, by design and by measurement:**
   - Layers animate only through the motion slot (D103): transform and opacity, which the
     browser composites cheaply; layout never runs per frame.
   - **A performance test comes first in Phase 4:** 300+ animated layers, with blur, on a
     modest machine, played by main-thread `setMotion` and by the browser's compositor (Web
     Animations API, which can also seek). The numbers decide how presenting plays; seeking
     for scrubbing and export stays frame-exact either way.
   - **Performance lint:** the render worker measures frame times, and agents and people
     get "this slide will drop frames: 40 blurred layers" with a fix, so "absurd" stays
     smooth by rule, not by luck.
   - **Reduce motion:** a viewer whose OS asks for less motion gets the deck's calm
     version, in presenter mode and the HTML export.
5. **Taste still matters:** the design docs and lint keep `calm` to `lively` tasteful by
   default; `intense` and `absurd` are opt-in.

## D105 — Our own timeline in core; proven libraries draw. Motion-graphics scope

**Status:** Accepted (2026-11-24). Supersedes D100 §1 (Motion as the only animation
driver); D100 §2 (GSAP isn't shipped) stands.

**New information:** the user wants 2D animation at motion-graphics level (After Effects,
not PowerPoint), and three constraints rule out handing the timeline to a library: core
depends on nothing (D2) and the clock lives there; `seek(t)` must give the same frame
every time (MP4 export, the determinism test, golden rule 3), while libraries run their own
playback loop; and the timeline is saved in `.veloce` files, so a library's internal data
can't be the file format.

1. **We write the timeline evaluator** (core, pure, no dependencies): keyframe tracks,
   cubic-Bézier easing, springs, stagger, seeded randomness and motion paths, evaluated at a
   time `t` into `MotionState`s and property values. Well-known math, a few hundred lines,
   heavily tested. **Any number or color in an element's Zod schema can be a keyframe
   track** (golden rule 5): chart values, gradient stops, a plugin's props.
2. **Proven technology draws**, per kind of layer: the browser's DOM and compositor for
   text, layout and images (through the motion slot, D103); SVG for vector motion
   graphics (path morphing, draw-on strokes, masks); **PixiJS** (MIT) in a built-in
   plugin for particles, glow, displacement and shader transitions; **dotLottie** (MIT)
   for designers' After Effects files. **Motion** (MIT) is optional: its spring and easing
   math, or compositor playback, if the performance test (D104 §4) shows it pays.
   Licenses are checked again when each one is added (CLAUDE.md). Not used: Theatre.js
   (its studio is AGPL) and Remotion (its company license isn't open source).
3. **Motion-graphics scope becomes its own phase**, Phase 5, after the motion core: a curve
   editor, motion paths, a vector element (paths, polygons, stars, lines and arrows, with
   a strict path-data validator) with draw-on strokes and shape morphing, text animators
   (per character, word or line), animated masks and mattes, blend modes, the WebGL
   effects plugin, a camera (zoom, pan, parallax over 2.5D) and animated components.
   Lines and arrows move there from the plugins phase, and path shapes from After 1.0.
   **Phases renumbered** (2026-11-24): Plugins 5 → 6, Desktop 6 → 7, Export 7 → 8, AI
   knowledge 8 → 9, Launch prep 9 → 10. References in this log, the docs and the code were
   updated to the new numbers.
4. **The cost, said plainly:** the evaluator is the small part; the timeline and curve
   editors, presets, text animators, morphing and performance work are the large part, and
   they'd exist with any library.

## D106 — Animation UI: three depths, no mode switch

**Status:** Accepted (2026-11-24).

Animating has to be easy for everyone, yet whatever an agent can do over MCP, a person can
do in the editor (golden rule 1). A Simple/Advanced switch was considered and not chosen.

1. **One UI with three depths, all writing the same animations:**
   - **Depth 1, one click:** the motion level slider; **Animate this slide** (the
     choreography engine, D104 §3); a preset gallery that **previews live on hover**;
     transitions as thumbnails. Also in Design: right-click → Animate…, and a badge on
     animated layers.
   - **Depth 2, tune:** the steps list (on click, with previous, after previous; drag to
     reorder) and a few plain controls per effect: speed, direction, intensity, delay.
   - **Depth 3, full control:** the timeline panel, collapsed at the bottom of the Animate
     workspace: keyframes, the curve editor, motion paths, text animators and masks,
     everything MCP can do.
     **Why not modes:** a global switch hides features ("where did that go?"), means two
     UIs to build and keep in step, and its "Advanced" side becomes a junk drawer simple
     users never discover. The workspaces already separate _what_ you're doing (D53);
     depth separates _how much_ you control.
2. **Hover previews are free:** they're temporary `setMotion` calls (D103), never ops, so
   nothing enters the document or undo until a click applies the preset.
3. **Your own presets:** Save as preset keeps a tuned animation in the deck, like
   components (D94); agents use it by name and it follows the motion level.
4. **Nothing is locked:** animation an agent built at depth 3 shows at depth 1 as
   "Custom", with its live preview, so a simple user can still keep, tweak or remove it.
5. **Remembered, not moded:** whether the timeline panel is open is panel state, stored per
   workspace (D90), not a setting that changes what the app can do.

## D107 — Presenting plays motion on the compositor; seeking and export stay on the clock

**Status:** Accepted (2026-11-24). The measurement D104 §4 asked for, before the timeline.

**The test** (`tests/perf/motion/`, `pnpm perf:motion`): one 1920×1080 slide of 300 to 3000
layers (shapes and text) all moving at once (move, turn, scale, fade; blur on one layer in
three), drawn by the real renderer. Two ways to play it: the main thread evaluates motion
every frame and calls `setMotion` (D103), or the renderer composes the same motion into
keyframes with its own `drawnCss` and hands them to the browser's compositor (Web Animations
API). Three conditions: normal, the main thread slowed 4× (a weak laptop), and a 250 ms long
task every second (autosave on a big deck, a React re-render, a plugin mounting). Smoothness
comes from Chrome's own frame reports in a trace, on the real GPU (Intel Iris Xe, i5-12500H,
headless Chromium with `--enable-gpu`), median of 3 runs.

| Moving layers         | Main thread: normal / CPU 4× / long tasks | Compositor: normal / CPU 4× / long tasks |
| --------------------- | ----------------------------------------- | ---------------------------------------- |
| 300                   | 60 / 60 / 50 fps, **233 ms freezes**      | 60 / 60 / 60 fps, no drops               |
| 600                   | 60 / 53 / 50 fps                          | 60 / 60 / 60 fps                         |
| 1000                  | 53 / 32 / 44 fps                          | 60 / 60 / 60 fps                         |
| 3000                  | 17 / 10 / 15 fps                          | 30 / 30 / 30 fps                         |
| 1000, a third blurred | 37 / 25 / 31 fps                          | 34 / 37 / 34 fps                         |

Main-thread motion costs 2 ms of JavaScript per frame for 300 layers and 6 ms for 1000
(16 ms at 4× slower): cheap, but any long task freezes it for the task's length.

1. **Presenting plays transform, opacity and filter tracks on the compositor:** the timeline
   evaluator (core, D105) turns each track into Web Animations keyframes, composed by the
   renderer's `drawnCss`, so the renderer stays the only writer of those properties (D103 §2)
   and owns every `Animation` it starts. Easing goes over as `cubic-bezier()` or `linear()`
   (springs), not sampled, where the browser can express it. **Why:** it's the only way that
   stays at 60 fps while the app is busy, and it holds 60 fps up to 1000 moving layers even
   on a slowed CPU.
2. **Everything else plays on the clock (main thread):** tracks the compositor can't run
   (any schema property: chart values, colors, gradient stops, text animators) go through
   `seek(t)` and plugins, as golden rule 3 says.
3. **Seeking, scrubbing and export stay on the clock** (`setMotion` from the evaluator):
   frame-exact and deterministic. A test proves both paths draw the same frame at the same
   time (pixel comparison), so what you scrub is what plays.
4. **Budgets for performance lint (D104 §4),** measured on the machine above, with a margin
   for weaker GPUs: warn above about **600 layers moving at once** (1000 measured smooth) and
   about **100 blurring at once** (blur is the GPU's cost: 100 is smooth, 200 starts dropping,
   333 runs at 35 fps whichever path plays it). The exact numbers are set when the lint is
   built, from this test.
5. **Thousands of moving things are particles, not layers:** 3000 DOM layers top out at
   30 fps however they're played, so swarms, confetti and starfields belong in the WebGL
   effects plugin (Phase 5, PixiJS, D105 §2).
6. **Animate only what a track changes.** Animating `filter: none` on every layer made Chrome
   build a filter effect for each one and halved the compositor's frame rate at 1000 layers
   (35 fps → 60 fps once fixed). Keyframes carry a property only if the track moves it.

**Caveats:** one machine, headless Chromium at 60 Hz; CPU throttling slows the main thread
only. The numbers are recorded here, and the test is rerun when how motion is drawn or played
changes (CLAUDE.md).

## D108 — Toasts show inside the open modal dialog

**Status:** Accepted (2026-11-24). Supersedes D99 §4's Undo bar inside Manage decks.

A modal `<dialog>` makes everything outside it inert (D76), toasts included: an error from
a dialog's own action (Save version failing) or the Undo after trashing a deck in Manage
decks showed dimmed behind it and couldn't be clicked.

1. **Toasts are portaled into the topmost open modal dialog,** and back to the body when
   none is open. `Dialog` records itself when it opens (`trackModal` in `popup-host.ts`;
   it's the only caller of `showModal`), and `Toasts` follows the top of that stack. It's
   the same idea as popups (D76: portal into the dialog the trigger is in), for feedback that
   has no trigger.
2. **Not the popover top layer:** a `popover` shown after `showModal` is still inert in
   Chrome (checked in Chromium 156: the click lands on the dialog's backdrop).
3. **Dialogs animate opacity only,** never a transform, so `position: fixed` toasts inside
   them still place against the window (already true for popups, D76).
4. **Manage decks drops its own Undo bar:** the toast's Undo works over it now, the same as
   everywhere else.

## D109 — Morph match keys: a layer's key is its `matchKey`, else its ID

**Status:** Accepted (2026-11-24). The morph match key from Phase 4, the first part of
format v3 (D103 §7).

Morph moves a layer on one slide into "the same" layer on the next. Layer IDs are unique in
the deck, and Duplicate slide gives fresh ones, so matching by ID never finds anything.

1. **`matchKey` on every node** (optional, one line, up to 100 characters), and a layer's
   key is **its `matchKey`, or its ID when it has none** (`matchKeyOf` in `core/morph.ts`).
2. **Copies inherit their original's key unless the slide already uses it** (the editor's
   `cloneWithNewIds`): Duplicate slide keys every copy by its original, so the two slides
   pair with no key typed and the original slide untouched (one `slide.insert`, nothing to
   undo there, no clash with an agent editing it). Duplicating the duplicate keeps the chain.
   Pasting onto another slide keeps keys (a pasted logo morphs with the one it came from);
   duplicating a layer, or pasting it, next to its original gives the copy no key. The slide's
   root frame isn't a layer and never gets one.
   **Why not write keys onto the originals:** Duplicate slide would also edit the slide it
   copies, as a second op, on a slide an agent may be working on.
3. **Pairing** (`morphPairs`): by key first, then, among layers still unpaired, by name and
   type in tree order (PowerPoint's `!!name` idea without the prefix). Each layer pairs once;
   a key used twice on a slide pairs its first layer, and lint warns
   (`duplicate-match-key`), with the fix.
4. **Everyone can set it:** the inspector's **Morph key** field (placeholder "Auto"), agents'
   `matchKey` in `upsert_slide` and `apply_ops`, shown as `[key "…"]` in the deck summary.
5. **Format v3, still open:** `FORMAT_VERSION` is 3 and the v2 → v3 migration changes
   nothing (every v3 addition is optional; the number is what makes an older Veloce ask to
   be updated). No release has shipped, so v3 keeps growing with the timeline, 2.5D, the
   motion level and `$motion` tokens, and freezes when it ships.
6. **The agent retest** (CLAUDE.md) happens with the morph transition, when the key has a
   visible effect for an agent to check; scripted MCP tests cover the field, its errors,
   the summary and the lint now.

## D110 — The timeline schema: a slide's animations, in play order, edited one at a time

**Status:** Accepted (2026-11-24). Phase 4's timeline schema, part of format v3 (D103 §7),
keeping D101 §2's rules for suggestion mode and concurrent editing.

1. **`slide.animations`: a list in play order** (omitted when empty, up to 1000). Each
   animation has an `id` (in the deck's one ID space, with slides and nodes), a `target`
   (a layer on the same slide, never its root frame), a `trigger` (`onClick` by default,
   `withPrevious`, `afterPrevious`), `delay` and `duration` in milliseconds, an `easing`,
   `repeat` (a count or `"forever"`) and `alternate`, and either an **`effect`** (a preset
   by name with `params`) or its own **`tracks`**, never both.
   **Why a list with triggers, not numbered steps:** PowerPoint's model, which people know;
   and an op that adds or moves one animation means the same thing after other edits
   (D101 §2.2). `scheduleSlide` derives the steps: step 0 plays as the slide appears, each
   `onClick` starts the next.
2. **Edited only by `animation.insert/update/remove/move`,** by ID, each with an exact
   inverse; `slide.update` refuses `animations` (D101 §2.1: a merge patch would replace the
   whole list and wipe concurrent edits).
3. **Keyframe tracks** are keyed by what they move: a motion channel (`x`, `y`, `z`,
   `rotate`, `rotateX`, `rotateY`, `scale`, `scaleX`, `scaleY`, `opacity`, `blur`: drawn by
   the motion slot, D103) or a property path (`props.*` on elements, `style.*` on frames).
   A path's values are checked by setting each keyframe into the target's own schema
   (golden rule 5, D105 §1): `props.fill` takes what the shape's `fill` takes. Keyframes
   sit at `at` 0–1 of the duration, so a speed control is just `duration` (D106); where a
   track has no keyframe at 0 or 1, that end is the layer's own value, so
   `{ "opacity": [{ "at": 0, "value": 0 }] }` fades a layer in to however opaque it is.
4. **Easing:** CSS names, a cubic Bézier, or a duration-based spring (`{ spring: { bounce } }`).
   All three can go to the compositor exactly (`cubic-bezier()`, `linear()`, D107 §1).
5. **Removing a layer removes its animations** (its children's too) in the same op, and
   the inverse `node.insert` carries them back to their exact places (D101 §2.3). **Moving an
   animated layer to another slide is refused** with a hint: animations stay on their slide,
   and moving them along couldn't be undone exactly by one op.
6. **Copies:** Duplicate slide copies its animations with new IDs, pointed at the copies.
   `upsert_slide` rebuilding a slide keeps the animations of layers still on it (same ID)
   and says what it kept and removed. Duplicating or pasting single layers doesn't copy
   their animations yet.
7. **Not yet** (their own roadmap items): effect names are checked by the effect presets'
   registry (until then any well-formed name is accepted); `$motion` tokens for durations
   and easings; agents' animation ops and `set_animations` (`apply_ops` doesn't offer
   `animation.*` to agents yet, so nothing agents use changed beyond `upsert_slide`'s note);
   the evaluator and the clock that play it.

## D111 — Motion levels scale the theme's `$motion` tokens; explicit numbers never scale

**Status:** Accepted (2026-11-24). Phase 4's motion level and `$motion` tokens, making
D104 §1–2 concrete; part of format v3.

1. **The level:** `deck.motionLevel` (`calm`, `subtle`, `lively`, `intense`, `absurd`;
   omitted means `subtle`), set with `deck.setMotionLevel`, and `slide.motionLevel`, set
   with `slide.update`, overriding it. A slide moves at its own level, else the deck's.
2. **`$motion` tokens are a fixed set,** not open names like `$color`: durations
   `$motion.fast`, `.normal` and `.slow`; `$motion.stagger`; easings `$motion.enter`,
   `.exit` and `.move`. **Why fixed:** the schema catches a typo and lists the valid ones,
   agents learn seven words instead of picking milliseconds, and every theme can be swapped
   for another without a missing token.
3. **Themes hold the values at `subtle`** in `theme.motion`: their motion personality.
   Veloce (light and dark) is quick with a soft landing, Midnight cinematic, Ember springy,
   Paper gentle and editorial, Studio crisp. A theme without `motion` (custom ones) moves
   like Veloce. An animation's defaults are `$motion.normal` and `$motion.enter`, so an
   unconfigured animation follows the theme and the level.
4. **The level scales tokens, never explicit numbers** (`MOTION_LEVEL_SCALES` is the whole
   definition, tuned in one place):

   | level   | durations | stagger | distance | spring bounce |
   | ------- | --------- | ------- | -------- | ------------- |
   | calm    | ×1.25     | ×1.5    | ×0.5     | none          |
   | subtle  | ×1        | ×1      | ×1       | ×1            |
   | lively  | ×0.9      | ×0.8    | ×1.6     | ×1.3          |
   | intense | ×0.8      | ×0.6    | ×2.5     | ×1.6          |
   | absurd  | ×0.7      | ×0.4    | ×4       | ×2 (max 1)    |

   **Why explicit numbers don't scale:** a person or agent who typed 800 ms meant it; only
   "the theme's normal speed" should follow the level. Distance is read by the effect
   presets (how far a slide-in travels, how big a pop gets); the level's other powers
   (more effects, denser choreography) belong to the presets and the choreography engine.
5. **Migration:** a v2 theme still named like a built-in (editing one renames it
   "… (custom)") gets that built-in's motion from a frozen snapshot in the v2→v3
   migration, so it still matches its theme card; a test keeps the snapshot equal to the
   built-ins until v3 ships.
6. **Not yet:** setting the level in the editor (the Animate workspace's slider and the New
   deck dialog, D106) and over MCP (the MCP item: `set_theme` and `apply_ops` don't offer
   it yet, so nothing agents use changed); editing a theme's `$motion` values in the editor;
   a theme's signature transition (with slide transitions); reduce motion playing `calm`
   (presenter mode, D104 §4).
7. **The level also says how much moves** (added 2026-11-24, at the user's request): "calm"
   must mean fewer things move, not the same things slower, or an agent could animate 40
   layers slowly and call it calm. The same table holds, per level, which layers animate
   by role (`reach`), how many effects one layer gets, which layers keep moving after they
   arrive (`ambient`), and a one-line `summary` for people and agents:

   | level   | what animates                 | effects per layer | keeps moving |
   | ------- | ----------------------------- | ----------------- | ------------ |
   | calm    | key: the title and main point | 1 (soft fades)    | nothing      |
   | subtle  | content, in reading order     | 1                 | nothing      |
   | lively  | most: content and visuals     | 2                 | key elements |
   | intense | all, layered, with depth      | 3                 | content      |
   | absurd  | all, all the time             | no limit          | everything   |

   **Who reads it:** the choreography engine picks which layers to animate from their role
   and this table; agents get the summaries in the MCP docs, so "make it calm" means two
   things move, not twenty; lint warns (never errors) when a slide does far more than its
   level says, with the fix "remove the loops, or set the slide to lively". Each lands with
   its own roadmap item. Performance budgets (D107 §4) still cap every level.
