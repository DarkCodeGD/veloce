import { z } from "zod";
import { FORMAT_ID } from "./constants.js";

/**
 * `manifest.json`: small, read first, enough to recognise and list a deck without
 * parsing the whole document. Unknown keys are tolerated (newer writers may add some).
 */
export const ManifestSchema = z.object({
  format: z.literal(FORMAT_ID),
  formatVersion: z.number().int().min(1),
  title: z.string(),
  createdAt: z.iso.datetime(),
  modifiedAt: z.iso.datetime(),
  generator: z.object({ name: z.string(), version: z.string() }).optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** `plugins.lock.json`: plugin ID → version the deck was saved with. */
export const PluginsLockSchema = z.record(z.string().max(200), z.string().max(100));
export type PluginsLock = z.infer<typeof PluginsLockSchema>;
