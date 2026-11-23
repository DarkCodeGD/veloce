/**
 * Slides and the deck: the top of the document model.
 */
import { z } from "zod";
import { ComponentsSchema } from "./component.js";
import { FrameNodeSchema } from "./node.js";
import { PaintSchema } from "./paint.js";
import { AssetIdSchema, IdSchema } from "./primitives.js";
import { ThemeSchema } from "./theme.js";

/**
 * Version of the document format. Bump it only together with a migration in
 * `@veloce/format`, so files from every older version keep opening.
 */
export const FORMAT_VERSION = 1;

export const SlideSchema = z.strictObject({
  id: IdSchema,
  name: z.string().max(200).optional(),
  background: PaintSchema.optional(),
  /** Speaker notes (plain text). */
  notes: z.string().max(50_000).optional(),
  /** Skipped in presentation mode, still editable. */
  hidden: z.boolean().optional(),
  /** Always fills the stage; its own width/height/position are ignored. */
  root: FrameNodeSchema,
});
export type Slide = z.infer<typeof SlideSchema>;

/** A slide's own fields without its node tree. */
export const SlideFieldsSchema = SlideSchema.omit({ root: true });

const FontWeightSchema = z.number().int().min(1).max(1000);

export const AssetInfoSchema = z.strictObject({
  mime: z
    .string()
    .max(100)
    .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, { error: 'Expected a MIME type like "image/png"' }),
  /** File size in bytes. */
  bytes: z.number().int().min(0),
  /** Original file name, for humans. */
  name: z.string().max(255).optional(),
  /** Intrinsic pixel size for images/videos. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /**
   * For font files: the face it provides, read from the font's own `name` and `OS/2` tables
   * when it was imported. Themes use `family` in their font stacks; every font asset with that
   * family is registered as one of its faces.
   */
  font: z
    .strictObject({
      family: z
        .string()
        .min(1)
        .max(100)
        // It goes into font stacks (CSS): no quotes, backslashes or control characters.
        .refine((name) => [...name].every((c) => c >= " " && c !== '"' && c !== "\\"), {
          error: "Font family names can't contain quotes, backslashes or control characters",
        }),
      /** CSS font-weight (1–1000). A variable font gives its range, e.g. [100, 900]. */
      weight: z.union([FontWeightSchema, z.tuple([FontWeightSchema, FontWeightSchema])]).optional(),
      style: z.enum(["normal", "italic"]).optional(),
      /** What kind of face it is (from its own OS/2 table): picks the fallback in font stacks. */
      category: z.enum(["serif", "sans-serif", "monospace"]).optional(),
    })
    .optional(),
});
export type AssetInfo = z.infer<typeof AssetInfoSchema>;

export const DeckMetaSchema = z.strictObject({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  authors: z.array(z.string().max(200)).max(100).optional(),
  /** BCP 47 language tag, e.g. "en" or "pt-BR". */
  language: z.string().max(35).optional(),
});
export type DeckMeta = z.infer<typeof DeckMetaSchema>;

export const StageSchema = z.strictObject({
  width: z.number().int().min(320).max(7680),
  height: z.number().int().min(240).max(7680),
});
export type Stage = z.infer<typeof StageSchema>;

export const DeckSchema = z.strictObject({
  id: IdSchema,
  formatVersion: z.number().int().min(1),
  meta: DeckMetaSchema,
  stage: StageSchema,
  theme: ThemeSchema,
  slides: z.array(SlideSchema).max(5000),
  /** Asset registry keyed by SHA-256. The bytes live outside the document (in the .veloce zip). */
  assets: z.record(AssetIdSchema, AssetInfoSchema),
  /**
   * Saved components by name (D94): templates to insert as plain copies. Omitted when there
   * are none. Their asset references count as uses, like a slide's.
   */
  components: ComponentsSchema.optional(),
});
export type Deck = z.infer<typeof DeckSchema>;
