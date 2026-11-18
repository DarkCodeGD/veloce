/**
 * @veloce/plugin-api: the contract every element plugin (built-in or third-party) implements,
 * the registry that validates elements against it, CSS helpers, and the conformance kit.
 *
 * Plugins should import `z` from here (not from "zod" directly) so the whole app shares a
 * single zod instance and JSON Schema generation works across plugins.
 */
export { z } from "zod";
export * from "./conformance.js";
export * from "./css.js";
export * from "./registry.js";
export * from "./types.js";
