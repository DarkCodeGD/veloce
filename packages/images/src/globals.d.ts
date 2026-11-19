/**
 * The two browser globals the codecs speak, declared for this Node-only package (its
 * tsconfig has no DOM library; `codecs.ts` provides `ImageData` at runtime).
 */
declare global {
  namespace WebAssembly {
    /** An opaque compiled module. */
    interface Module {}
    function compile(bytes: ArrayBufferView | ArrayBuffer): Promise<Module>;
  }

  class ImageData {
    constructor(data: Uint8ClampedArray, width: number, height: number);
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
  }
}

export {};
