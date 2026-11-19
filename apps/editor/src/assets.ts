/**
 * Getting files to the server: upload a dropped or pasted file, or copy an asset over from
 * another open deck (cross-deck paste). The server decides what a file is and replies with
 * `{ id, info }`; the editor then registers it with `asset.add` in a transaction, like any
 * other change. Uploads run a few at a time, so dropping a folder of photos doesn't open
 * dozens of connections at once.
 *
 * Big photos come back optimized (D67): a toast says how much smaller, with "Keep original"
 * to use the uploaded files instead. Optimizing takes a second or two per photo, so a slow
 * upload says what it's doing.
 */
import { assetKind, MAX_ASSET_BYTES } from "@veloce/core";
import { run } from "./actions.js";
import { assetUrl, client } from "./editor-context.js";
import { type Imported, keepOriginals, optimizedMessage } from "./model/asset-insert.js";
import { dismissToast, showToast } from "./toasts.js";

/** At most this many uploads in flight. */
const PARALLEL = 3;
/** An upload taking longer than this (optimizing a big photo) shows an "Importing…" toast. */
const SLOW_MS = 700;
/** How long "Keep original" is offered (the server keeps originals for 10 minutes). */
const KEEP_ORIGINAL_MS = 12_000;

export class UploadError extends Error {}

/** True for a file worth sending: an image or font by its declared type or extension. */
export function looksImportable(file: File): boolean {
  if (assetKind(file.type) !== "other") return true;
  return /\.(png|jpe?g|gif|webp|avif|svg|ttf|otf|woff2?)$/i.test(file.name);
}

/**
 * Upload one file to a deck (a replaced picture, an image fill), with the "optimized" toast.
 * Throws `UploadError` with the server's reason.
 */
export async function uploadAsset(deckId: string, file: Blob, name?: string): Promise<Imported> {
  const imported = await whileSlow(`Importing ${name ?? "the file"}…`, () =>
    send(deckId, file, name, true),
  );
  announceOptimized(deckId, [imported]);
  return imported;
}

/** POST the bytes; the server says what they are (and optimizes them unless asked not to). */
async function send(deckId: string, file: Blob, name: string | undefined, optimize: boolean) {
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
        ...(!optimize && { "x-veloce-optimize": "0" }),
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
  return {
    id: body.id,
    info: body.info,
    ...(body.optimization && { optimization: body.optimization }),
  };
}

/** Run `task`; if it takes a while, say `message` until it's done. */
async function whileSlow<T>(message: string, task: () => Promise<T>): Promise<T> {
  let toast: number | null = null;
  const timer = setTimeout(() => {
    toast = showToast({ message, tone: "info" }, 120_000);
  }, SLOW_MS);
  try {
    return await task();
  } finally {
    clearTimeout(timer);
    if (toast !== null) dismissToast(toast);
  }
}

/**
 * "beach.png optimized: 3.6 MB → 220 KB (−94%)", with "Keep original": every use of the
 * optimized files in the deck switches to the uploaded originals, in one undo step.
 */
export function announceOptimized(deckId: string, files: readonly Imported[]): void {
  const message = optimizedMessage(files);
  if (!message) return;
  const several = files.filter((f) => f.optimization).length > 1;
  showToast(
    {
      message,
      tone: "info",
      action: {
        label: several ? "Keep originals" : "Keep original",
        run: () => {
          const deck = client.getState().deck;
          const command = deck?.id === deckId ? keepOriginals(deck, files) : null;
          if (command) void run(command);
          else showToast({ message: "That image isn't in the deck anymore", tone: "error" });
        },
      },
    },
    KEEP_ORIGINAL_MS,
  );
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
        results[i] = await send(deckId, file, file.name, true);
      } catch (error) {
        results[i] = error instanceof UploadError ? error.message : `${file.name}: upload failed`;
      }
    }
  };
  const what = files.length === 1 ? (files[0]?.name ?? "the file") : `${files.length} files`;
  await whileSlow(`Importing ${what}…`, () =>
    Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker)),
  );
  const imported = results.filter((r): r is Imported => typeof r !== "string");
  announceOptimized(deckId, imported);
  return { imported, errors: results.filter((r): r is string => typeof r === "string") };
}

/**
 * Copy assets from another deck on this server into `deckId` (cross-deck paste). They're
 * already in a deck as the user wants them: never optimized again.
 */
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
      return send(deckId, await response.blob(), names[id], false);
    }),
  );
}
