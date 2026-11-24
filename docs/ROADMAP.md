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
- Third-party plugins, sandboxed like Figma, add commands, panels and element types, and
  agents can call their commands (D79).
- Export to PDF, PNG, standalone HTML and MP4.
- It installs and updates on Linux, Windows and macOS, signed, and opens `.veloce` files.

## Current status

- **Active phase:** Phase 3: Manual editor, complete (phase gate due)
- **Last updated:** 2026-11-24
- **Next:** Phase 3 is complete: run the phase gate before Phase 4 starts (its blocker, the
  GSAP license question, comes first).
- **State:** `pnpm check` is green (906 tests, including real-Chromium lint, preview and editor
  tests). `pnpm start` runs it on `http://127.0.0.1:4321` (decks in `./decks`). MCP has 16 tools.
- **Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) is the map of how it fits together; keep it
  true when the architecture changes. User guide and references come in Phase 9 (D96).
- **Done so far** (the why lives in [DECISIONS.md](DECISIONS.md)):
  - Phases 0–2: monorepo, schema, ops, file format, plugin API, renderer, doc-server, lint,
    MCP and a view-only editor. The first real Claude Code runs' issues are fixed (D37, D38).
  - Phase 3, rounds 1–3: selection, inspector, polish, direct manipulation, text editing,
    marquee, clipboard, history, themes and assets (D39–D48).
  - Round 4: free layers, Free frames, layer drag and drop, group, align, anchors, zoom, text
    toolbar, color opacity, own color picker, upload cleanup, paint picker and image
    optimization (D49–D67).
  - Agent feedback rounds 1–3 and a fix-check retest: lint accuracy, clearer errors, and
    per-session decks for agents (D58, D59, D68–D70).
  - Round 5: reverting AI changes from History, and agents told what the user changed, retested
    and tightened (D71, D72); lint in the editor (D73); frame border and shadow (D74); per-side padding (D75); deck info and
    new deck from a File menu (D76, D77); theme styles (D78); shape outline (D80); the tool bar
    and Add menu on a command registry (D81); image focus point (D82). Parity with agents is
    done. A free canvas: hand-made slides start Free, Add auto layout (D83); crop mode (D84); grid cell alignment (D85); the size badge (D86); on-canvas gradient handles (D87, D88); every shortcut a command, and the menu bar (D89); resizable, collapsible workspace panels (D90); Preferences (D91); the command palette (D92); versions (D93).
  - Round 6: components, copied on insert, for agents and people (D94); slide layouts, built
    in and the deck's own (D95); slide numbers, footers and sections (D97), with the agent test's
    fixes, retested by a spawned agent before the user's final test (D97 §8). A `lead` text style
    and format v2, fuller content layouts (D98). Deleting decks (trash with Undo) and Manage decks
    (D99).
- **Onboarding gotcha:** Claude Code only connects to MCP servers when a session starts, so the
  server must be running first. Register it with
  `claude mcp add --scope user --transport http veloce http://127.0.0.1:4321/mcp`. Put this in
  the README; Electron will start the server automatically.
- **Still open:** the "current slide ±1" plugin-mount policy (Phase 5); `desktop` is a
  placeholder.

---

## The product in one paragraph

Veloce is a desktop app (Linux, Windows, macOS) for making professional, animated presentations.
**AI agents build decks through an MCP server**, and humans edit the same deck by hand in the editor,
even at the same time. Decks are saved as **`.veloce`** files. Capabilities (3D, Lottie, Rive, charts…)
and tools (commands, panels) come from **plugins**, sandboxed like Figma's, that all follow one
contract and one shared timeline clock. It is a
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
7. **Every op is invertible** and every transaction records its origin (`user` | `agent:<id>` |
   `plugin:<id>`, D79), so undo is tracked per origin and "undo what the AI did" is one step.

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
│   ├── images/          image optimization on import (WebAssembly codecs, SSIM, worker thread)
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

- [x] Git, license (Apache-2.0), pnpm workspace, strict shared tsconfig, Vitest + Biome, scripts
- [x] Package dependency directions guarded by `scripts/architecture.test.ts`; CI on GitHub Actions

## Phase 1 — Foundation (`core`, `format`, `plugin-api`) ✅ (2026-11-18)

- [x] Schema: deck, slides, auto-layout frames (stack, grid, absolute), elements, rich text,
      theme tokens, stage (D17)
- [x] 12 invertible ops, merge-patch updates, atomic transactions, per-origin undo,
      actionable errors (D18, D19)
- [x] `.veloce` zip format: content-hashed assets, migrations, hardened reader (D21)
- [x] Plugin contract, registry, CSS helpers, conformance kit; built-in text, shape and image
      plugins (D22)

✅ `tests/integration/phase1.test.ts`

## Phase 2 — See it + let the AI in ✅

- [x] Renderer: deck → DOM, theme variables, font loading, measurement pass
- [x] Doc server: WebSocket sync, atomic autosave, headless render worker
- [x] Lint: overflow, overlap, off-canvas, contrast, empty slide, too much text, alt text,
      small text, unknown tokens; structured issues with fixes
- [x] MCP over Streamable HTTP: instructions, 14 tools, 2 resources, Zod-validated input,
      actionable errors (D33)
- [x] View-only editor and `apps/server` on one local port with Host/Origin checks (D34)

## Phase 3 — Manual editor

- [x] Rounds 1–3: selection, hover, layers panel, move/resize/rotate, snapping, auto-layout
      drag, TipTap text editing, schema-generated inspector, slide panel, themes, assets,
      clipboard, shortcuts, per-origin undo and a history panel (D39–D48)

**Round 4: free positioning and pro-tool basics** ✅

- [x] Free layers in stacks and grids (D49), and Free frames that keep every child in place (D50)
- [x] Layers panel drag and drop (D51) and multi-select (D56)
- [x] Padding form switches patch cleanly (D52)
- [x] Group / ungroup (D54), align and distribute (D55)
- [x] Anchors for free layers (D57)
- [x] Canvas zoom and pan (D60)
- [x] Text toolbar: color, alignment, text style (D61)
- [x] Opacity on color tokens: `$color.x/30` (D63)
- [x] Unused uploads cleaned up (D65)
- [x] Paint picker: solid, linear, radial, angular and image fills (D66)
- [x] Image optimization on import (D67)

**Round 5: app shell (D53)**

The editor becomes an app: Blender's workspaces for different kinds of work, Figma's clean
panels with the important options in reach. Done before Motion, so Phase 4 lands as the
Animate and Present workspaces instead of being squeezed into today's screen.

- [x] **Parity with agents** (golden rule #1: whatever an agent can do, the user can do in the
      editor). Audit from 2026-11-20, most important first. Keep the inspector airy (D47):
      only 4 of these live in it, and each stays hidden until it's used. The rest go to
      the History panel, a lint panel, the File menu or a dialog.
  - [x] Review AI changes: Revert one change or an agent's run from the History panel, as
        the user's own undoable step; agents get a "since your last call" digest and
        upsert_slide won't bring back removed slides (D71, D72)
  - [x] Lint in the editor: an Issues tab with the issues agents see, worded for people,
        badges on the tab, thumbnails and layers, click to select (D73)
  - [x] Frame border and shadow in the inspector: Border / Shadow headers with **+** / **−**,
        theme shadow presets or Custom values (D74)
  - [x] Per-side padding: one field, or four with "Individual sides" (`SidesField`, D75)
  - [x] Deck info: File → Deck info dialog; agents see it, slides carry the language (D76)
  - [x] New deck from the editor: File → New with a theme, New slide in an empty deck (D77)
  - [x] Theme styles: File → Theme styles (or the inspector's Theme section) edits text
        styles and the spacing, radius and shadow scales; one undo step per Save (D78)
  - [x] Shape outline: a shape's `stroke` uses the frame's Border section, found by its
        schema (D80)
  - [x] Image focus point: a dot dragged on the picture, the cropped part dimmed (D82)
- [x] Tool bar and Add menu: draw with tools, Shift+A / right-click / ➕ to add at a spot,
      one `node.insert` each (D62, D81)
- [x] Free canvas: slides made by hand start Free, the slide's Layout in the Slide section,
      Add auto layout (Ctrl+Alt+A) from what's on screen (D83)
- [x] Crop mode, like Figma's: double-click to pan, trim and scale the picture; Ctrl-drag
      trims; image corners keep their ratio; a `crop` prop agents can set too (D84)
- [x] Grid cell alignment: Horizontal (`justify`) next to Vertical (`align`) (D85)
- [x] Size badge under the selection (`176 × 36`, slide pixels), live while resizing (D86)
- [x] On-canvas gradient handles: ends, center and stops on the slide itself (D87); placed
      freely, sized, Delete removes a stop (D88)
- [x] Command registry (D79 §4): tools and the Add menu's entries register in one place the
      tool bar, Add menu and keyboard read (D81)
- [x] Every remaining shortcut is a registry command, found by one key dispatcher (D89)
- [x] Menu bar: File, Edit, View, Insert, Slide, Arrange, Help, every command with its
      shortcut; folds to ☰ in narrow windows; Help → Keyboard shortcuts (D89). The deck
      switcher, Follow AI / Live (and Present, Phase 4) stay in the bar on every workspace
- [x] Workspaces: fixed presets of resizable, collapsible panels, sizes and the last
      workspace remembered. Design is the first (today's editor); the switcher appears with
      a second workspace (Animate and Present in Phase 4) (D90)
- [x] Preferences (File → Preferences, Ctrl+,): a user settings file owned by the server,
      live in every tab. Editing (snapping, nudge, undo steps, lint and its rules), Files
      (decks folder, autosave), Keymap (searchable), AI (Follow AI, port, connect command).
      Interface waits for Phase 6 (D91)
- [x] Command palette (Ctrl/Cmd+K, View): every command with its keys, the settings, the
      slides and layers in one search, best match first, recent commands on top (D92)
- [x] Versions: File → Save version (named), File → Versions (list, read-only preview,
      restore as one undoable change, delete). Kept inside the `.veloce` file (D93)

**Round 6: reuse (components and slide layouts)**

Agents rebuild the same card 4–8 times per slide and can't reuse a drawing they made from
shapes, which means large, repetitive MCP payloads and drifting styles. Humans want the
same slide structure every time without rebuilding it.

- [x] Components (copy on insert): a named subtree with params mapping to node fields,
      stored in `document.json`, saved and removed by invertible ops, copies plain with
      readable IDs (D94)
- [x] MCP: `save_component`, `list_components`, and `{ "use", "with" }` anywhere a node goes,
      expanded where MCP input is normalized (D94)
- [x] Editor: Arrange → Save as component (texts offered as params), a Components tab with
      previews to insert from, and the palette (D94)
- [x] Slide layouts are slide-level components with slots: Slide → New slide from layout
      (built-in Title, Title and content, Two columns, Section header, Big number, Quote, in
      the deck's theme), Save slide as layout; agents use them with `use`/`with` (D95)
- [x] Slide numbers, footers and sections: field runs (slide number and count, date, deck
      title, section) in any text; the deck's footer (date, text, number) with a per-slide
      opt-out; named sections grouping the rail; for agents and people (D97)

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
- [ ] Motion is a transform on top of a layer's rest position, never width/height per frame;
      stacks get layout animations (FLIP); 2.5D is perspective and z on frames (D83 §5)
- [ ] Timeline schema: per-slide steps (click triggers); animations `{ target, effect | keyframes, trigger: onClick | withPrevious | afterPrevious, delay, duration, easing }`
- [ ] Core clock: `seek(slideId, step, t)`; plugins driven via `seek(t)`
- [ ] `AnimationDriver` interface; GSAP as default driver (swap-able)
- [ ] Effect presets (fade, slide, scale, blur, typewriter, count-up, stagger…), extensible by plugins
- [ ] Slide transitions (fade, push, zoom) + **morph** (match nodes by id across slides)
- [ ] Presenter mode: fullscreen, speaker notes, next-slide preview, timer, second window
      synced, laser pointer; its slide overview grouped by sections (D97)
- [ ] Animate workspace (timeline, steps, effect and transition pickers) and Present
      workspace (rehearse in presenter view), both on the round 5 shell
- [ ] MCP: `set_animations(slideId, steps)`, `render_preview` at a step/time
- [ ] MCP: batch previews, `render_preview({ slideIds: [...] })` returning one contact
      sheet, so an agent reviews a whole deck in one call instead of one per slide
- [ ] Determinism test: seek to the same step/time twice → identical screenshots

**Done when:** decks animate in presenter mode and every frame is reproducible by seeking.

## Phase 5 — Plugins

Each plugin: `propsSchema`, `aiDocs`, `renderStatic`, conformance kit passes. Security: SVG
assets (icons, logos) load only through `<img>`, never inlined, so scripts in an SVG can't run.

- [ ] Plugin host mount policy: mount the current slide ±1 only; others show static thumbnails
- [ ] `chart` (ECharts): bar/line/pie/area/scatter, data in props, animated entry
- [ ] `lottie` (dotLottie): play/seek, segment control
- [ ] `code` (Shiki): syntax highlight, line highlight steps
- [ ] `math` (KaTeX)
- [ ] `icon` (Lucide/Iconify). Motivation from an agent transcript: agents used `↕` and other
      symbol characters as icons, and they render in a fallback font (Inter only covers text). Until
      this lands, the design docs tell agents not to use them.
- [ ] `video`: seek-synced to the clock
- [ ] Per-corner radius on shapes and frames: one radius field, plus an "individual
      corners" toggle that opens the four (toggling back sets one value again). Reuse
      `SidesField` from round 5's per-side padding (D75)

**App plugins (D79):** sandboxed like Figma; plugins add commands, panels and element types.

- [ ] `plugin:<id>` origin in core: per-origin undo, History, Revert and lint treat plugins
      like agents
- [ ] Plugin manifest schema: `apiVersion`, contributions (commands, panels, element types),
      permissions (network domains, asset upload, clipboard)
- [ ] Sandbox host: one opaque-origin iframe per plugin with a strict CSP; typed async RPC
      over `MessageChannel`; escape tests (no parent DOM, storage, Node or undeclared network)
- [ ] Plugin API v1: read the deck, selection and changes; transactions; register commands
      and panels; notifications; plugin storage
- [ ] Third-party element types in the sandbox: `seek(t)` over RPC, frame-ready before
      capture so export stays deterministic; a placeholder for a missing plugin
- [ ] Plugins panel: install from a file or folder, the permissions prompt, enable, disable
      and uninstall with no restart; developer mode loads an unpacked folder and reloads on save
- [ ] Plugin commands as MCP tools (opt in, input schema), run in the server's headless page
- [ ] Conformance kit for app plugins (disable removes everything), an example plugin, a
      starter template and generated API docs

**Done when:** all plugins pass conformance; the agent can discover and use them via
`list_element_types` + `get_docs`; a third-party plugin installed from a file adds a command
and a panel, edits the deck as one undoable step under its own name, can't reach the
network or disk without permission, and disabling it removes every trace.

## Phase 6 — Desktop app (Electron)

- [ ] Main process hosts doc-server + MCP; window loads the editor
- [ ] Render worker (previews, lint measurements) in a hidden BrowserWindow instead of
      Playwright's Chromium, so the app needs no separate browser download
- [ ] Security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, minimal preload IPC
- [ ] `.veloce` file associations (Windows registry, macOS UTI/Info.plist, Linux .desktop + shared-mime-info), `open-file` handling, single-instance lock
- [ ] `veloce://` protocol handler
- [ ] Native menus (macOS mirrors round 5's menu bar), recent files, window state, crash
      recovery from autosave
- [ ] Preferences → Interface (D91 §2): UI scale through Electron's zoom factor (CSS zoom
      misplaces popovers), and light/dark once there's a light token set
- [ ] Preferences → System: GPU preference (high-performance / power saving; applied at
      launch, so it asks for a restart; on Linux the launcher sets the PRIME environment)
      and hardware acceleration on/off
- [ ] "Connect AI" panel: copy-paste config for Claude Code / Claude Desktop / Cursor; stdio shim for clients that need it
- [ ] Packaging: AppImage + deb + rpm, NSIS (Windows), dmg (macOS); electron-updater. Ship
      the image codecs' `.wasm` files and the optimizer's `worker.js` as real files (asar
      unpacked, not bundled): the worker starts from its own URL (D67 §8)

**Done when:** installs on all 3 OSes, double-clicking a `.veloce` opens it, and Claude Code connects.

## Phase 7 — Export

- [ ] PDF (printToPDF / Playwright), one page per slide (option: per step)
- [ ] PNG/JPEG per slide
- [ ] Standalone HTML: self-contained animated deck playable in any browser
- [ ] MP4: frame-by-frame render through the seekable clock + ffmpeg
- [ ] "Save a copy without versions" (and export never includes them): a file sent to
      someone shouldn't carry the old versions inside it (D93 §6)

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
- [ ] User guide on the docs site (with Phase 8's plugin docs): getting started, connecting
      an agent, each workspace, components and layouts, presenting, exporting. Written once
      the UI has settled (after Phases 4–6) (D96)
- [ ] Generated reference pages on the docs site: keyboard shortcuts from the command
      registry, element props from their schemas, MCP tools, lint rules, so they can't drift
      from the app (D96)
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
- `custom-component` (AI/user code in a sandboxed iframe with a param schema), built on the
  D79 sandbox
- A plugin directory in the app (browse, install, update), and plugin signing

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
