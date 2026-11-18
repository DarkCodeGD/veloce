/**
 * @veloce/server: Standalone Node entry point: doc-server + MCP over HTTP (web/dev use).
 *
 * Phase 0 placeholder. Real implementation lands per docs/ROADMAP.md.
 */
import { packageName as docServer } from "@veloce/doc-server";
import { packageName as mcp } from "@veloce/mcp";

export const packageName = "@veloce/server";

/** Workspace packages this package depends on (checked by the smoke test). */
export const dependsOn: readonly string[] = [docServer, mcp];
