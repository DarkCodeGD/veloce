/**
 * Getting files to the server: upload a dropped or pasted file, or copy an asset over from
 * another open deck (cross-deck paste). The server decides what a file is and replies with
 * `{ id, info }`; the editor then registers it with `asset.add` in a transaction, like any
 * other change. Uploads run a few at a time, so dropping a folder of photos doesn't open
 * dozens of connections at once.
 */
import { assetKind, MAX_ASSET_BYTES } from "@veloce/core";
import { assetUrl } from "./editor-context.js";
import type { Imported } from "./model/asset-insert.js";

/** At most this many uploads in flight. */
const PARALLEL = 3;

export class UploadError extends Error {}

/** True for a file worth sending: an image or font by its declared type or extension. */
export function looksImportable(file: File): boolean {
  if (assetKind(file.type) !== "other") return true;
  return /\.(png|jpe?g|gif|webp|avif|svg|ttf|otf|woff2?)$/i.test(file.name);
}

/** Upload one file to a deck. Throws `UploadError` with the server's reason. */
export async function uploadAsset(deckId: string, file: Blob, name?: string): Promise<Imported> {
  if (file.size > MAX_ASSET_BYTES) {
    throw new UploadError(
      `${name ?? "The file"} is over ${MAX_ASSET_BYTES / 1024 ** 2} MiB, the most a deck can hold per file`,
    );
  }
  let response: Response;
  try {
    response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/assets`, {
      method: "POST",
      body: file,
      headers: {
        "content-type": "application/octet-stream",
        "x-veloce-upload": "1",
        ...(name && { "x-veloce-filename": encodeURIComponent(name) }),
      },
    });
  } catch {
    throw new UploadError("Couldn't reach the Veloce server to upload the file");
  }
  const body = (await response.json().catch(() => ({}))) as Partial<Imported> & {
    error?: string;
  };
  if (!response.ok || !body.id || !body.info) {
    const reason = body.error ?? `Upload failed (${response.status})`;
    throw new UploadError(name ? `${name}: ${reason}` : reason);
  }
  return { id: body.id, info: body.info };
}

/**
 * Upload several files, a few at a time. Resolves with the ones that made it, in order, and
 * the reasons for the rest (one bad file doesn't sink the others).
 */
export async function uploadAll(
  deckId: string,
  files: readonly File[],
): Promise<{ imported: Imported[]; errors: string[] }> {
  const results: Array<Imported | string> = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const file = files[i] as File;
      try {
        results[i] = await uploadAsset(deckId, file, file.name);
      } catch (error) {
        results[i] = error instanceof UploadError ? error.message : `${file.name}: upload failed`;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));
  return {
    imported: results.filter((r): r is Imported => typeof r !== "string"),
    errors: results.filter((r): r is string => typeof r === "string"),
  };
}

/** Copy assets from another deck on this server into `deckId` (cross-deck paste). */
export async function copyAssets(
  fromDeckId: string,
  deckId: string,
  ids: readonly string[],
  names: Readonly<Record<string, string | undefined>> = {},
): Promise<Imported[]> {
  return Promise.all(
    ids.map(async (id) => {
      const response = await fetch(assetUrl(fromDeckId, id)).catch(() => null);
      if (!response?.ok) {
        throw new UploadError("The deck these layers came from isn't open in Veloce anymore");
      }
      return uploadAsset(deckId, await response.blob(), names[id]);
    }),
  );
}
