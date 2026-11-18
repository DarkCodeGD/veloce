/**
 * @veloce/renderer: Renders a deck to DOM: stage scaling, plugin host, timeline clock, layout measurement.
 *
 * Phase 0 placeholder. Real implementation lands per docs/ROADMAP.md.
 */
import { packageName as core } from "@veloce/core";
import { packageName as pluginApi } from "@veloce/plugin-api";

export const packageName = "@veloce/renderer";

/** Workspace packages this package depends on (checked by the smoke test). */
export const dependsOn: readonly string[] = [core, pluginApi];
