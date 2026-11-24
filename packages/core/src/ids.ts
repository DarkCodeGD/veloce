/**
 * Identifiers.
 *
 * IDs are plain strings chosen by whoever creates the thing. Humans get generated IDs
 * like `nd_k3x9q2m8ab`; AI agents may pick readable ones (`"title"`, `"card-1"`) so they
 * can reference nodes within the same batch without a round trip. Slide and node IDs
 * share one namespace per deck, so an ID always identifies exactly one thing.
 */
import { webCrypto } from "./crypto.js";

/** 1–64 chars of letters, digits, `_` or `-`, starting with a letter or digit. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Prefixes used for generated IDs. They make IDs self-describing in logs and errors. */
export type IdPrefix = "dk" | "sl" | "nd" | "tx" | "an";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
/** Largest multiple of the alphabet size below 256; bytes above it are rejected to avoid modulo bias. */
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);

/** Cryptographically random lowercase alphanumeric string. */
export function randomId(length = 10): string {
  let out = "";
  while (out.length < length) {
    for (const byte of webCrypto().getRandomValues(new Uint8Array(length * 2))) {
      if (byte < UNBIASED_LIMIT) out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Generate a prefixed ID, e.g. `createId("nd")` → `"nd_k3x9q2m8ab"`. */
export function createId(prefix: IdPrefix): string {
  return `${prefix}_${randomId(10)}`;
}
