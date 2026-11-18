/**
 * @veloce/plugin-api: Plugin contract, registry and conformance test kit. Built-in elements use this same API.
 *
 * Phase 0 placeholder. Real implementation lands per docs/ROADMAP.md.
 */
import { packageName as core } from "@veloce/core";

export const packageName = "@veloce/plugin-api";

/** Workspace packages this package depends on (checked by the smoke test). */
export const dependsOn: readonly string[] = [core];
