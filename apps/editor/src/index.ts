/**
 * @veloce/editor: The Veloce editor web app (UI shell around the renderer).
 *
 * Phase 0 placeholder. Real implementation lands per docs/ROADMAP.md.
 */
import { packageName as core } from "@veloce/core";
import { packageName as pluginApi } from "@veloce/plugin-api";
import { packageName as renderer } from "@veloce/renderer";

export const packageName = "@veloce/editor";

/** Workspace packages this package depends on (checked by the smoke test). */
export const dependsOn: readonly string[] = [core, pluginApi, renderer];
