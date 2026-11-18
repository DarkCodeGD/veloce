import type { Deck } from "@veloce/core";
import type { Manifest, PluginsLock } from "./manifest.js";

/** Everything a .veloce file holds, in memory. */
export interface DeckBundle {
  deck: Deck;
  /** Asset bytes keyed by asset ID (SHA-256). Must match `deck.assets` exactly. */
  assets: ReadonlyMap<string, Uint8Array>;
  /** Plugin ID → version used when saving. */
  plugins?: PluginsLock;
  /** PNG thumbnail of the first slide (file browsers, recent-files lists). */
  preview?: Uint8Array;
  /** PNG per element node ID, shown when that element's plugin isn't installed. */
  fallbacks?: ReadonlyMap<string, Uint8Array>;
}

export interface ReadResult extends DeckBundle {
  manifest: Manifest;
  plugins: PluginsLock;
  fallbacks: ReadonlyMap<string, Uint8Array>;
  /** Non-fatal problems (ignored files, missing plugins…), for logs or a UI notice. */
  warnings: string[];
  /** Set when the file was saved in an older format and upgraded while reading. */
  migratedFrom?: number;
}
