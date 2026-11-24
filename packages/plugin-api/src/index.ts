/**
 * @veloce/plugin-api: the contract every plugin (built-in or third-party) implements, for
 * element types and effect presets; the registry that validates them; CSS helpers; and the
 * conformance kits.
 *
 * Plugins should import `z` from here (not from "zod" directly) so the whole app shares a
 * single zod instance and JSON Schema generation works across plugins.
 */
export { z } from "zod";
export * from "./conformance.js";
export * from "./css.js";
export * from "./effect-conformance.js";
export * from "./registry.js";
export * from "./types.js";
