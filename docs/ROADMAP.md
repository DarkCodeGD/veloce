# Veloce Roadmap

> **Source of truth for what to build next.** Claude: read "Current status" first, work on the
> first unchecked item in the active phase, tick boxes as items land, and update "Current status"
> before the session ends. Decisions and their reasons live in [DECISIONS.md](DECISIONS.md).
>
> **Phases 0–9 hold only what ships in 1.0.** Everything else waits in "After 1.0" at the
> bottom: don't start those items before 1.0 ships unless the user moves one up.

## Veloce 1.0 (the shipping line)

1.0 ships when all of this is true:

- **Design, Animate and Present workspaces** are polished: a Blender-style workspace switcher
  with Figma-clean panels, an app menu bar, a command palette and Preferences (D53).
- Decks are built and edited by hand **and** by AI: over MCP (Claude Code and other clients)
  and with the built-in assistant (bring your own key).
- Decks animate (steps, effects, transitions, morph) and present well (presenter view,
  second screen, laser pointer).
- Reuse: components and slide layouts; slide numbers, footers and sections.
- The core plugins (chart, icon, code, math, video, Lottie) pass conformance.
- Export to PDF, PNG, standalone HTML and MP4.
- It installs and updates on Linux, Windows and macOS, signed, and opens `.veloce` files.

## Current status

- **Active phase:** Phase 3: Manual editor, round 4 (free positioning and pro-tool basics)
- **Last updated:** 2026-11-19
- **Notes:** Renderer, doc-server, lint, MCP (14 tools), `apps/server` and the view-only editor
  are done. `pnpm check` is green (467 tests, including real-Chromium lint, preview and editor tests).
  Run it with `pnpm start` (opens on `http://127.0.0.1:4321`, decks in `./decks`).
  A scripted agent built a 4-slide deck end to end; lint caught real contrast bugs (fixed in the
  Midnight theme).
  - **First real Claude Code run:** a 5-slide deck. Its five hiccups are fixed and tested (D37).
  - **Second trial:** found the restart overwrite gap, false overflow on wrapped text, radial
    gradient edges and icon glyphs. All fixed or documented (D38).
  - **Phase 3, round 1 (D39):** selection with Figma-style drill-in, hover and selection
    outlines, a layers panel, a schema-generated inspector, slide add/duplicate/delete,
    editable notes, undo/redo with undo toasts, and keyboard shortcuts. Verified by driving
    real Chromium (select → recolor → delete → Undo → new slide, no console errors).
  - **Polish pass (D40–D41):** custom dropdowns, quiet scrollbars, toggle switches, styled
    tooltips with shortcuts, auto-growing text fields, and scrubbable number fields with live
    previews (one transaction per gesture, verified by `tests/integration/phase3-editor.test.ts`).
    Scrubbing is infinite (pointer lock + a wrapping virtual cursor, D42).
  - **Round 2, direct manipulation (D43):** drag to move (free frames: by position with
    snapping guides; stacks/grids: live reorder; drop into other frames), resize and rotate
    handles that follow rotated layers, arrow-key nudging. Every gesture is one transaction
    (`tests/integration/phase3-canvas.test.ts`).
  - **Round 2, typing on the slide (D44):** double-click or Enter edits a text layer in place
    with TipTap, pixel-identical to the render; the layout reflows live; formatting toolbar
    (marks, lists, links). One transaction per session (`tests/integration/phase3-text.test.ts`).
  - **Round 3 (D45):** marquee selection, spacing indicators (while dragging, and Alt + hover),
    dragging slides in the rail, and copy/cut/paste through the system clipboard (between
    slides and decks; text from other apps becomes a text layer).
    `tests/integration/phase3-structure.test.ts` covers the rail and the clipboard.
  - **History panel (D46):** every change by you and the AI, grouped by author, with the
    slides it touched; the server keeps the log, so it includes what the AI did before the
    editor opened.
  - **Themes (D47):** theme cards, palette editing with the system color picker and contrast
    warnings, font pickers over six bundled fonts (two new themes, Paper and Studio, use
    them), font previews in dropdowns, and "snap to the nearest theme color".
    `tests/integration/phase3-theme.test.ts` covers it.
  - **Assets (D48):** drop or paste images and fonts onto the canvas, "Replace…" an image in
    the inspector, "Add font file…" in the theme, and images that travel with layers pasted
    between decks. Agents get `add_asset`. The server sniffs every file. Fonts are named
    from their own `name` table and offered in the theme's font pickers.
    `tests/integration/phase3-assets.test.ts` covers it.
  - **Phase 3 reopened (2026-11-19):** the decks agents build are stacks and grids all the way
    down, so dragging a layer only reorders it; there's no way to place one freely, and
    switching a frame to Free collapses its children. Round 4 (below) fixes that and adds the
    basics people expect from Figma/Keynote before Motion, which needs freely placed layers.
  - **Round 4, free positioning (D49):** any layer in a stack or grid can go Free
    (inspector Position: Auto / Free, or Ctrl/Cmd-drag it out) without moving a pixel; it
    then moves, nudges and snaps by position while the flow closes up beneath it. Agents get
    `positioning: "free"`, a "Free layers" docs section and an `ignored-position` lint.
    `tests/integration/phase3-free.test.ts` covers it.
  - **Round 4, Free frames (D50):** switching a stack/grid to Free pins its children (and its
    own content-fitted size) exactly where they were, in one undo step. Fixed a long-standing
    bug on the way: every layout mode switch dropped the frame's padding.
  - **Round 4, Layers panel drag and drop (D51):** drag rows (or the whole selection) to
    reorder, onto a frame to move inside it, or left past a frame's last child to pull out;
    the canvas previews live, Escape cancels, layers dropped into Free frames stay put.
    `tests/integration/phase3-layers.test.ts` covers it.
  - **Round 4 and 5 grew (2026-11-19)** from an MCP-only agent run (a badge on an existing
    deck, then a 5-slide deck from scratch): a padding patch bug agents hit, anchors for
    free layers, opacity on color tokens, and a round for reusable components. Batch
    previews, shape geometry and a cross-slide consistency lint went to Phases 4, 5 and 8.
  - **Product shape and the 1.0 line (D53, 2026-11-19):** Blender-style workspaces with
    Figma-clean panels; a new round 5 (app shell: menu bar, workspaces, Preferences, command
    palette, snapshots) before Motion. The roadmap now holds only 1.0 work; the rest waits
    in "After 1.0".
  - **Round 4, group / ungroup (D54):** Ctrl+G (or the inspector's Group button) wraps the
    selection in a frame and Ctrl+Shift+G dissolves it, one undo step each, without moving
    anything: flow layers get a frame with their parent's flow, free layers an absolute frame
    cut to their box (rotation included). `tests/integration/phase3-group.test.ts` covers it.
  - **Round 4, align and distribute (D55):** an alignment bar in the inspector and Figma's
    keys (Alt+A/H/D, Alt+W/V/S, Alt+Shift+H/V) for free layers, across frames; a single
    layer aligns within its frame. `tests/integration/phase3-align.test.ts` covers it.
  - **Layers panel multi-select (D56):** Shift+click selects a range of rows, Ctrl/Cmd+click
    toggles one (it was Shift = toggle only, so selecting ten layers took ten clicks).
  - **Round 4, anchors (D57):** free layers can be pinned to any edge or the middle of their
    frame (`anchor: { x, y }`; inspector Pin X / Pin Y), so a badge stays in a card's corner
    whatever the card's size or its own text. Drags, resizes, nudges, align, group and paste
    all move anchored layers correctly; switching the pin never moves the layer. Agents get
    the field, docs, an outline marker and lint. `tests/integration/phase3-anchor.test.ts`.
  - **Padding patches (D52):** switching `padding` between `{ x, y }` and per-side values now
    replaces it (a merge-patch "shape rule", undo-exact), and mixed forms get an error that
    says how to write it.
  - **Agent feedback round 1 (D58):** from an MCP agent run against anchors. Free layers
    are now measured from the frame's edges (Figma's way), not inside its padding, so a
    pinned badge survives padding changes. Strokes are drawn inside without taking room.
    Lint: `ignored-padding`, a balanced `empty-space`, and free-layer `overlap` advice.
    Docs: negative offsets, `fill`, theme docs that name their deck. The user's decks were
    migrated (3 layers in 2 decks).
  - **Agent feedback round 2 (D59):** the retest needed no workarounds. A frame's `overflow`
    now counts only its flow children: free layers hanging past an edge are deliberate,
    and `off-canvas` still catches them leaving the slide. Docs: the slide root is centered
    top-to-bottom only (`align: "center"` for hug-width content), rotation (around the
    centre, the upright box is what `position` describes), strokes drawn inside, and
    `get_slide` bounds of rotated nodes. Acknowledging intentional lint findings went to
    Phase 8.
  - **Canvas zoom and pan (D60):** Ctrl/Cmd + wheel and pinch zoom at the pointer (10% to
    1600%). The wheel pans (Shift: sideways), and so do Space + drag and middle-drag.
    Keys: Mod+= / Mod+- step, Shift+1 fit, Shift+0 100%, Shift+2 selection. There's a zoom
    pill in the canvas corner. Zoom is view state, never an op.
  - **Text toolbar (D61):** a Style menu (the theme's `$text.*` styles), a Color menu (theme
    swatches first, then the system picker) and an Align menu (also Ctrl+Shift+L/E/R/J).
    None of them take the focus from the text. Formatting that covers the whole text moves
    to the layer's own `style` / `color` / `align` when typing ends, so the inspector and
    agents see it there. Styled paragraphs now get the whole style, letter-spacing and case
    included.
  - **Next:** round 4: opacity on color tokens (`$color.secondary/30`).
  - **Onboarding gotcha:** Claude Code only connects to MCP servers when a session starts, so the
    server must be running first. Register it with
    `claude mcp add --scope user --transport http veloce http://127.0.0.1:4321/mcp`. Put this in
    the README; Electron will start the server automatically.
  - **Still open:** the "current slide ±1" plugin-mount policy, now a Phase 5 item (thumbnails
    are live and lazily mounted for now; it matters once heavy plugins arrive).
  - `desktop` is still a placeholder.

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
fflate (zip) · TipTap (rich text) · own transform handles (D43) · GSAP (default animation driver; fallback driver: Motion, MIT. See D14) ·
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

- [x] Deck → DOM; frames map to CSS flexbox; stage scaled to fit via CSS transform
- Plugin host mount policy (current slide ±1): moved to Phase 5, where heavy plugins arrive
- [x] Theme tokens → CSS variables; font loading (await fonts before measuring)
- [x] Measurement pass: computed bounds per node, text overflow detection → reported to server

**Doc server**

- [x] Open/create/save documents; versioned; transactions applied in order
- [x] WebSocket sync protocol: client sends transaction → server applies → broadcasts patch + version; rejects stale/invalid with reason
- [x] Atomic autosave (write temp file → rename)
- [x] Render worker for screenshots/measurement without a user window (Playwright in dev/web; hidden BrowserWindow in Electron later)

**Lint (`core` rules + renderer measurements)**

- [x] Rules: text overflow, overlap, off-canvas, low contrast (WCAG), empty slide, too much text, missing alt text (+ small text, unknown token)
- [x] Output structured JSON with node ids and suggested fixes

**MCP (`mcp`, Streamable HTTP at `http://localhost:<port>/mcp`)**

- [x] Server `instructions` (core workflow + rules: the fallback for agents without the skill)
- [x] Tools (keep the set small, ~10):
  - `get_deck_summary` (compact: slides, node ids, types, bounds; no blobs)
  - `get_slide(slideId)`
  - `upsert_slide(slide)` (whole slide in one call)
  - `apply_ops(ops, label)` (batch transaction)
  - `list_element_types` (from plugin registry, with prop schemas)
  - `set_theme` (built-in name or brand overrides; the error and `get_docs("theme")` list themes, so no `list_themes`)
  - `lint(slideId?)`
  - `render_preview(slideId)` → image content block (`step` arrives with Phase 4 motion)
  - `undo_agent_changes(count?)`
  - `get_docs(topic)` (on-demand docs: core, layout, theme, each plugin's aiDocs)
  - added: `create_deck`, `list_decks`, `open_deck` (D33)
- [x] Resources: `deck://current/summary`, `deck://current/theme`
- [x] All inputs validated with Zod; errors are actionable (`isError: true` + how to fix)

**Editor (view-only)**

- [x] Slide list + stage + live updates from server

- [x] `apps/server`: one local port for the editor, `/ws`, `/mcp` and assets; Host/Origin checks (D34)

**Done when:** in Claude Code, "make a 5-slide pitch deck about X" produces a good-looking deck
live in the browser; the agent runs `lint` + `render_preview` and fixes its own issues.
Then: review agent transcripts and redesign any tool the agent struggled with.

## Phase 3 — Manual editor

- [x] Selection (click, shift-click, marquee), hover outlines, layers panel (D39, D45)
- [x] Move/resize/rotate; snapping guides + spacing indicators (D43, D45)
- [x] Auto-layout-aware drag (reorder within frame, drop into frames)
- [x] Text editing with TipTap, mapped to the core rich text model (D44)
  - Moved to round 4: toolbar controls for text color, paragraph alignment and style.
- [x] Inspector panel auto-generated from each plugin's `propsSchema`
- [x] Slide panel: add, duplicate, delete, reorder (drag, or Alt+↑/↓) (D45)
- [x] Theme picker + token-aware color/font pickers (D47)
- [x] Asset import (drag & drop or paste images/fonts → content-hashed assets; MCP `add_asset`) (D48)
- [x] Clipboard (copy/paste within and between decks, images included), keyboard shortcuts (D45, D48)
- [x] Undo/redo for the `user` origin only; history panel shows agent transactions too (D46)

**Round 4: free positioning and pro-tool basics**

- [x] Free positioning per layer: a layer inside a stack or grid can leave the flow and sit
      at its own `x`/`y` on top of it (Figma's "ignore auto layout"). Inspector toggle
      (Position: Auto / Free) and dragging a layer out of its stack; it keeps its on-screen
      spot. Same option for agents over MCP (schema + docs + lint), with a migration if the
      format changes
- [x] Switching a frame to Free keeps everything where it is: children get their current
      rendered positions (and sizes where they were stretched), in one transaction
- [x] Layers panel drag and drop: reorder, and move layers into or out of frames (same ops as
      canvas drags; keyboard path stays Alt+↑/↓)
- [x] Fix: `node.update` can't switch `padding` to another form. Merge-patching
      `{ x, y }` with `{ top, right, bottom, left }` yields `{ x, y, top, … }`, which matches
      no padding shape and fails with a bare `set.layout.padding: Invalid input`. Replace a
      padding object whole when the patch switches its form (like the layout `mode` rule in
      `json.ts`, so undo inverses stay right), check other union-of-objects fields for the
      same trap, and make any remaining error say how to fix the call
- [x] Group / ungroup (Ctrl+G / Ctrl+Shift+G): wrap the selection in a frame that keeps its
      layout, and unwrap it (D54)
- [x] Align and distribute for multi-selection (left/center/right, top/middle/bottom; space
      evenly), in free frames (D55)
- [x] Layers panel multi-select like Figma: Shift+click selects a range of rows,
      Ctrl/Cmd+click toggles one (D56)
- [x] Anchors for free layers: `anchor: { x: "start" | "center" | "end", y: … }` says which
      edge of the frame `position` is measured from, so a badge pinned to a card's top-right
      corner stays there when its text, the card's size or the padding changes (Figma
      constraints). `position` keeps its one `{ x, y }` shape. Inspector anchor picker,
      drags and nudges keep working, MCP docs + lint. Extends D49 (D57)
- [x] Canvas zoom and pan: Ctrl/Cmd + scroll and pinch, Space + drag, zoom to fit, 100%;
      handles, guides and text editing stay correct at every zoom
- [x] Text toolbar: text color (theme tokens first), paragraph alignment, text style
      (`$text.*`) (D61)
- [ ] Opacity on color tokens: `$color.secondary/30` (glows, bubbles, glass highlights) so
      translucent colors follow theme switches instead of being hard-coded hex with alpha.
      Token resolution, contrast lint (already flattens alpha), and an opacity control in the
      editor's token color picker (the system picker has no alpha, D47)
- [ ] Unused uploads are cleaned up: files uploaded but never registered with `asset.add`
      (a cancelled drop, a failed paste) are swept on save and on close
- [ ] Image optimization on import: photos far larger than the stage are downscaled, and
      heavy formats re-encoded (WebP/AVIF, keeping PNG where transparency or sharp edges
      need it), so a phone photo doesn't add 40 MB to a deck. The original is never needed
      again; the user is told what was done

**Round 5: app shell (D53)**

The editor becomes an app: Blender's workspaces for different kinds of work, Figma's clean
panels with the important options in reach. Done before Motion, so Phase 4 lands as the
Animate and Present workspaces instead of being squeezed into today's screen.

- [ ] Top bar: app menu bar (File, Edit, View, Insert, Arrange, Help) with every command
      and its shortcut; the deck switcher, Follow AI / Live and Present stay in the bar on
      every workspace (AI activity is never hidden in one workspace)
- [ ] Workspaces: a switcher with fixed presets of resizable, collapsible panels. Design is
      the first (today's editor); a workspace appears only once its phase ships (Animate
      and Present in Phase 4). Panel sizes and the last workspace are remembered
- [ ] Preferences window, stored in a user settings file owned by the server (app settings,
      not deck content, so not ops): Interface (UI scale, dark/light), Editing (undo steps,
      snapping, nudge distance), Files (decks folder, autosave interval), Keymap (every
      shortcut, searchable; rebinding after 1.0), AI (MCP port, connect instructions, Follow
      AI default). System settings (GPU, hardware acceleration) arrive with Phase 6
- [ ] Command palette (Ctrl/Cmd+K): search every command, setting, slide and layer; shows
      shortcuts. The glue that keeps a big app easy to use
- [ ] Snapshots: File → Save version (named), a version list, open read-only, restore (one
      transaction, undoable). A safety net when an agent rewrites a deck

**Round 6: reuse (components and slide layouts)**

Agents rebuild the same card 4–8 times per slide and can't reuse a drawing they made from
shapes, which means large, repetitive MCP payloads and drifting styles. Humans want the
same slide structure every time without rebuilding it.

- [ ] Components (copy on insert): save any subtree as a named component with a few
      declared params (e.g. `color`, `label`, `level`) that map to node fields. Inserting
      makes a plain copy with fresh IDs, so the document never links to it: undo, morph and
      export work as they do today. Stored per deck (`components` in `document.json`, a
      format addition with its decision entry). Pure data, no code
- [ ] MCP: `save_component`, `list_components`, and `node.insert` with
      `{ "use": "<name>", "with": { … } }`, expanded where MCP input is normalized, so core
      ops and the undo log only ever see plain nodes (golden rule 1)
- [ ] Editor: "Save as component" on a selection, and a components panel to insert from
- [ ] Slide layouts are slide-level components: "Save slide as layout", "New slide from
      layout" (title, title + content, two columns, section header…), with built-in ones
      per theme. Agents use them with the same `use`/`with`
- [ ] Slide numbers, footers and sections: dynamic fields (slide number, total, date, deck
      title) usable in any text; named sections that group slides in the rail and in
      presenter view

**Done when:** a full deck can be built by hand, with layers placed exactly where you want
them, including inside the AI's auto-layout slides; every command is reachable from the
menu bar and the command palette, and Preferences persist; an agent can define a card once
and reuse it across the deck; human and agent edit concurrently without conflicts; Ctrl+Z
never undoes the agent's work.

## Phase 4 — Motion

**Blocker:** resolve the GSAP license question (Open questions) before starting.

- [ ] Visual regression tests first: reference decks rendered in CI and compared with
      stored screenshots, so the renderer work below can't silently move a pixel in
      existing decks
- [ ] Timeline schema: per-slide steps (click triggers); animations `{ target, effect | keyframes, trigger: onClick | withPrevious | afterPrevious, delay, duration, easing }`
- [ ] Core clock: `seek(slideId, step, t)`; plugins driven via `seek(t)`
- [ ] `AnimationDriver` interface; GSAP as default driver (swap-able)
- [ ] Effect presets (fade, slide, scale, blur, typewriter, count-up, stagger…), extensible by plugins
- [ ] Slide transitions (fade, push, zoom) + **morph** (match nodes by id across slides)
- [ ] Presenter mode: fullscreen, speaker notes, next-slide preview, timer, second window
      synced, laser pointer
- [ ] Animate workspace (timeline, steps, effect and transition pickers) and Present
      workspace (rehearse in presenter view), both on the round 5 shell
- [ ] MCP: `set_animations(slideId, steps)`, `render_preview` at a step/time
- [ ] MCP: batch previews, `render_preview({ slideIds: [...] })` returning one contact
      sheet, so an agent reviews a whole deck in one call instead of one per slide
- [ ] Determinism test: seek to the same step/time twice → identical screenshots

**Done when:** decks animate in presenter mode and every frame is reproducible by seeking.

## Phase 5 — Plugins

Each plugin: `propsSchema`, `aiDocs`, `renderStatic`, conformance kit passes.

- [ ] Plugin host mount policy: mount the current slide ±1 only; others show static thumbnails
- [ ] `chart` (ECharts): bar/line/pie/area/scatter, data in props, animated entry
- [ ] `lottie` (dotLottie): play/seek, segment control
- [ ] `code` (Shiki): syntax highlight, line highlight steps
- [ ] `math` (KaTeX)
- [ ] `icon` (Lucide/Iconify). Motivation from an agent transcript: agents used `↕` and other
      symbol characters as icons, and they render in a fallback font (Inter only covers text). Until
      this lands, the design docs tell agents not to use them.
- [ ] `video`: seek-synced to the clock
- [ ] Per-corner radius on shapes and frames

**Done when:** all plugins pass conformance; the agent can discover and use them via `list_element_types` + `get_docs`.

## Phase 6 — Desktop app (Electron)

- [ ] Main process hosts doc-server + MCP; window loads the editor
- [ ] Security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, minimal preload IPC
- [ ] `.veloce` file associations (Windows registry, macOS UTI/Info.plist, Linux .desktop + shared-mime-info), `open-file` handling, single-instance lock
- [ ] `veloce://` protocol handler
- [ ] Native menus (macOS mirrors round 5's menu bar), recent files, window state, crash
      recovery from autosave
- [ ] Preferences → System: GPU preference (high-performance / power saving; applied at
      launch, so it asks for a restart; on Linux the launcher sets the PRIME environment)
      and hardware acceleration on/off
- [ ] "Connect AI" panel: copy-paste config for Claude Code / Claude Desktop / Cursor; stdio shim for clients that need it
- [ ] Packaging: AppImage + deb + rpm, NSIS (Windows), dmg (macOS); electron-updater

**Done when:** installs on all 3 OSes, double-clicking a `.veloce` opens it, and Claude Code connects.

## Phase 7 — Export

- [ ] PDF (printToPDF / Playwright), one page per slide (option: per step)
- [ ] PNG/JPEG per slide
- [ ] Standalone HTML: self-contained animated deck playable in any browser
- [ ] MP4: frame-by-frame render through the seekable clock + ffmpeg

**Done when:** a deck can be shared with someone who doesn't have Veloce: as a PDF, images,
a self-contained HTML file that plays the animations, or a video.

## Phase 8 — AI knowledge and the built-in assistant

- [ ] Reference docs generated from Zod schemas + plugin `aiDocs` (no hand-written API docs)
- [ ] MCP `instructions` + `get_docs` topics finalized
- [ ] Claude skill `veloce-deck-design`: workflow (storyline → theme → batch build → lint → preview → fix) + design taste rules
- [ ] `llms.txt` + human docs site for plugin developers
- [ ] AI eval suite: fixed prompts → decks → lint score + screenshot review; run when tools change
- [ ] Cross-slide consistency lint: flag titles/kickers in the same role whose position
      drifts between content slides (usually `justify: "center"` with different content
      heights). Until then, the layout docs tell agents to use `justify: "start"` on content
      slides
- [ ] Acknowledge intentional lint findings: a way for an agent or a person to mark one
      issue as "meant that way" so it stops showing in lint results, without silencing the
      rule everywhere. Design questions first: where the acknowledgement lives (on the node,
      by rule), whether it survives edits that change the measurement, and how the editor
      shows it. (Agent feedback round 2: an intentional overhang kept failing the final lint.)
- [ ] Built-in assistant: a chat panel in the editor for people without an MCP client.
      Bring your own key: Anthropic, or any OpenAI-compatible endpoint (which also covers
      local models like Ollama). It's one more MCP client of the same server (origin
      `agent:assistant`), so undo, history and Follow AI work as for any agent. Keys are
      stored with the OS keychain, never in decks or logs

**Done when:** a fresh agent with only the MCP (no skill) can make a decent deck, and with
the skill makes a great one; someone with only an API key can do the same inside the app.

## Phase 9 — Launch prep

- [ ] Code signing: Apple Developer + notarization; Windows signing certificate
- [ ] Opt-in crash reporting & telemetry
- [ ] Performance budget: 60fps playback, memory stable across 100+ slides, no leaks
- [ ] Accessibility (keyboard nav, screen reader labels, alt text)
- [ ] Starter templates & themes, onboarding
- [ ] Trademark check for "Veloce", dependency license audit
- [ ] `.veloce` format spec and stability promise (what 1.x will always open), plus fuzz tests
      for the reader: files from the internet are untrusted
- [ ] UI strings kept in one place so translating the app later is a data change (the
      translations themselves come after 1.0)

**Done when:** everything in "Veloce 1.0" at the top is true, on all three OSes.

---

## After 1.0

Parked on purpose: valuable, but not needed to ship. Don't start these before 1.0 unless the
user moves one into a phase.

**Workspaces and app**

- 3D workspace (with the `three` plugin)
- Custom workspace layouts (split any area, Blender-style) and keymap rebinding
- Translated UI (strings are already centralized in Phase 9)

**Editing**

- Find and replace across the deck; auto-fit text (shrink to fit its box)
- Right-to-left and CJK text layout
- `path`/`polygon` shapes for custom silhouettes, with a strict path-data validator
- Frame style presets in the theme (`$style.card`), decided together with components
- A user component library shared between decks (`~/.config/veloce/library/`)
- Linked components: a main component with instances and overrides (an override model,
  invertible ops across instances, detach). Also makes deck-wide slide-layout edits possible

**Presenting**

- Phone as a remote (scan a QR code: advance slides, read notes)
- Pen/ink annotations while presenting; rehearsal with per-slide timings
- Recording a talk with a webcam bubble, exported as video
- Audio: background music, per-slide narration, auto-advance (kiosk loops)

**AI**

- Suggestion mode: an agent's edits arrive as a change set to accept or reject per slide
  (see Open questions: check the design before Phase 4)
- Deck translation that keeps the layout (lint catches overflow); generated speaker notes

**Plugins**

- `rive`, `diagram` (Mermaid), `three` (scene, camera, lights; WebGL context manager with a
  budget under 16 live contexts), optional `physics` (fixed timestep, seeded RNG)
- `custom-component` (AI/user code in a sandboxed iframe with a param schema) and the
  community plugin sandbox (iframe + postMessage RPC, permission prompts, install UX)

**Import and export**

- PPTX import (shapes, text, images, basic layout; best-effort animations) and PPTX export
  (static, with fallbacks for plugin elements)
- Handouts and notes pages as PDF; accessible (tagged) PDF

---

## Open questions

- [x] **Project license:** Apache-2.0 (decided 2026-11-18). GSAP can stay the default driver if its license text checks out (D14).
- [ ] **GSAP license:** read the GSAP "standard no-charge license" text. Veloce doesn't compete with
      Webflow, but GSAP's license is not OSI-approved: fine next to an MIT/Apache app, but a conflict with GPL
      and a blocker for strict distro packaging (e.g. Debian main). If incompatible → Motion becomes the
      default driver and GSAP ships as an optional plugin. **Resolve before Phase 4.**
- [ ] **Name:** trademark search for "Veloce" in the software class.
- [x] **Extension:** `.veloce` confirmed by the user (2026-11-18).
- [ ] **Suggestion mode (after 1.0, but check now):** before Phase 4 changes the document
      model, confirm that agent edits could later be held as a reviewable change set (per
      origin, like undo) without a format break. A short design note is enough.
- [ ] **Sync:** server op log now; move to Yjs only if cloud multi-user collaboration becomes a goal.
- [ ] **Business:** hosted web viewer / cloud sync / plugin marketplace (post-launch).
