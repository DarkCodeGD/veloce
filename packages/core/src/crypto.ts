/**
 * Runtime-neutral access to the Web Crypto API.
 *
 * Node ≥ 19 and every modern browser expose `globalThis.crypto`. We describe the tiny
 * slice we use locally instead of pulling in DOM or Node typings, which keeps `core`
 * free of any runtime-specific types (golden rule: core runs anywhere).
 */
interface WebCryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
}

export function webCrypto(): WebCryptoLike {
  const crypto = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (!crypto?.getRandomValues || !crypto.subtle) {
    throw new Error("Web Crypto API (globalThis.crypto) is not available in this environment");
  }
  return crypto;
}
