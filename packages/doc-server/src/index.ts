/**
 * @veloce/doc-server: Owns open documents: applies transactions, versioning, WebSocket sync, atomic autosave.
 *
 * Phase 0 placeholder. Real implementation lands per docs/ROADMAP.md.
 */
import { packageName as core } from "@veloce/core";
import { packageName as format } from "@veloce/format";

export const packageName = "@veloce/doc-server";

/** Workspace packages this package depends on (checked by the smoke test). */
export const dependsOn: readonly string[] = [core, format];
