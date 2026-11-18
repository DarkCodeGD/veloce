/**
 * @veloce/mcp: MCP tools, resources and instructions, mounted in-process next to the doc-server.
 *
 * Phase 0 placeholder. Real implementation lands per docs/ROADMAP.md.
 */
import { packageName as core } from "@veloce/core";
import { packageName as docServer } from "@veloce/doc-server";

export const packageName = "@veloce/mcp";

/** Workspace packages this package depends on (checked by the smoke test). */
export const dependsOn: readonly string[] = [core, docServer];
