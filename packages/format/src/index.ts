/**
 * @veloce/format: Read/write .veloce files (zip container): manifest, content-hashed assets, format migrations.
 *
 * Phase 0 placeholder. Real implementation lands per docs/ROADMAP.md.
 */
import { packageName as core } from "@veloce/core";

export const packageName = "@veloce/format";

/** Workspace packages this package depends on (checked by the smoke test). */
export const dependsOn: readonly string[] = [core];
