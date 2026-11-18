/**
 * @veloce/format: read and write `.veloce` files.
 *
 * A .veloce file is a zip container:
 *   manifest.json        format id + version, title, timestamps (stored uncompressed, first)
 *   document.json        the deck without its theme
 *   theme.json           design tokens
 *   plugins.lock.json    plugin id → version used when saving (optional)
 *   assets/<sha256>.ext  asset bytes, content-addressed (deduplicated, integrity-checked)
 *   fallbacks/<id>.png   static render per plugin element, for decks opened without the plugin
 *   preview.png          thumbnail (optional)
 */
export type { DeckBundle, ReadResult } from "./bundle.js";
export * from "./constants.js";
export * from "./errors.js";
export * from "./manifest.js";
export * from "./migrations.js";
export { extensionFor } from "./mime.js";
export { type ReadOptions, readVeloce } from "./read.js";
export { type WriteOptions, writeVeloce } from "./write.js";
