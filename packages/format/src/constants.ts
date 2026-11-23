/** File extension of Veloce decks. */
export const FILE_EXTENSION = ".veloce";

/** Registered as the deck MIME type (OS file associations, HTTP downloads). */
export const MIME_TYPE = "application/vnd.veloce+zip";

/** Value of `manifest.format`, used to recognise a .veloce file. */
export const FORMAT_ID = "veloce";

/** Fixed paths inside the zip container. */
export const PATHS = {
  manifest: "manifest.json",
  document: "document.json",
  theme: "theme.json",
  plugins: "plugins.lock.json",
  preview: "preview.png",
  assetsDir: "assets/",
  fallbacksDir: "fallbacks/",
  /** Saved versions (D93): `versions/<id>.json`, each a whole deck. Assets live in `assets/`. */
  versionsDir: "versions/",
} as const;

/** Safety limits for reading untrusted files. All sizes are uncompressed bytes. */
export interface ReadLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  maxJsonBytes: number;
}

export const DEFAULT_READ_LIMITS: ReadLimits = {
  maxEntries: 10_000,
  maxTotalBytes: 2 * 1024 ** 3, // 2 GiB
  maxEntryBytes: 1024 ** 3, // 1 GiB
  maxJsonBytes: 64 * 1024 ** 2, // 64 MiB
};
