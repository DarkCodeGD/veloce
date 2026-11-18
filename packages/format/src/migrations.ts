/**
 * Format migrations: how decks from older Veloce versions keep opening forever.
 *
 * `MIGRATIONS[n]` upgrades a raw document (the deck as plain JSON) from format version
 * `n` to `n + 1`. To change the document format:
 *   1. bump `FORMAT_VERSION` in @veloce/core,
 *   2. add `MIGRATIONS[old]` here,
 *   3. add a fixture file of the old version and a test that it migrates.
 * Migrations must be pure and must never be edited once released.
 */
import { FORMAT_VERSION } from "@veloce/core";
import { FormatError } from "./errors.js";

export type RawDocument = Record<string, unknown>;
export type Migration = (doc: RawDocument) => RawDocument;

/** Format v1 is the first version, so there's nothing to migrate yet. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export function migrateDocument(
  doc: RawDocument,
  from: number,
  to: number = FORMAT_VERSION,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): RawDocument {
  if (from > to) {
    throw new FormatError(
      "TOO_NEW",
      `This deck uses format version ${from}, but this Veloce only understands up to ${to}. Update Veloce to open it.`,
    );
  }
  let current = doc;
  for (let version = from; version < to; version++) {
    const migrate = migrations[version];
    if (!migrate)
      throw new Error(`Missing migration from format version ${version} to ${version + 1}`);
    current = { ...migrate(current), formatVersion: version + 1 };
  }
  return current;
}
