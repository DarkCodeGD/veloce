/**
 * @veloce/core: the document model and the rules for changing it.
 *
 * Pure TypeScript: no DOM, no Node APIs (enforced by this package's compiler settings).
 * Used by the editor, the doc-server, the MCP server and every plugin.
 */
export * from "./assets.js";
export * from "./builders.js";
export * from "./checks.js";
export * from "./default-theme.js";
export * from "./document.js";
export * from "./errors.js";
export * from "./ids.js";
export * from "./json.js";
export * from "./ops/apply.js";
export * from "./ops/schema.js";
export * from "./schema/index.js";
export * from "./suggest.js";
export * from "./tokens.js";
export * from "./transaction.js";
export * from "./tree.js";
export * from "./validate.js";
