/**
 * MIME type ↔ file extension for assets inside the zip. The extension is only a convenience
 * for people unzipping a deck by hand; the deck's asset registry stays the source of truth.
 */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  // SVGs can contain scripts: renderers must only ever load them via <img> (scripts don't run there).
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "model/gltf-binary": "glb",
  "application/json": "json",
};

/** Formats that are already compressed, so deflating them again only burns CPU. */
const PRECOMPRESSED = new Set([
  "png",
  "jpg",
  "webp",
  "gif",
  "avif",
  "mp4",
  "webm",
  "mp3",
  "ogg",
  "woff2",
  "woff",
]);

export function extensionFor(mime: string): string {
  return EXTENSIONS[mime.toLowerCase()] ?? "bin";
}

export function isPrecompressed(extension: string): boolean {
  return PRECOMPRESSED.has(extension);
}
