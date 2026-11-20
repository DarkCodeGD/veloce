/**
 * @veloce/doc-server: owns open documents (D1).
 *
 * - `Workspace`: a folder of .veloce files; open/create/list, active deck, atomic autosave.
 * - `OpenDeck`: one live document (transactions, per-origin undo, asset bytes, change events).
 * - `SyncHub`: the sync protocol for editor clients, independent of the transport.
 * - `RenderService`: contract for headless measuring/screenshots (implemented by the apps).
 * - `lintWithRender` / `DeckLinter`: lint with measurements, per call or live for editor tabs.
 */
export * from "./asset-import.js";
export * from "./fs.js";
export * from "./lint.js";
export * from "./open-deck.js";
export * from "./render.js";
export * from "./sync-hub.js";
export * from "./workspace.js";
