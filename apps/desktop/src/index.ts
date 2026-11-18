/**
 * @veloce/desktop: Electron shell: main process hosts doc-server + MCP, window loads the editor.
 *
 * Phase 0 placeholder. Real implementation lands per docs/ROADMAP.md.
 */
import { packageName as docServer } from "@veloce/doc-server";
import { packageName as mcp } from "@veloce/mcp";

export const packageName = "@veloce/desktop";

/** Workspace packages this package depends on (checked by the smoke test). */
export const dependsOn: readonly string[] = [docServer, mcp];
