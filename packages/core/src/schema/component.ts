/**
 * Components (D94): a subtree saved under a name, with a few declared params, to insert
 * again as a plain copy. The deck keeps them in `components`, keyed by name.
 *
 * A param maps one value to node fields inside the template: `"title.props.content"` is the
 * `props.content` of the template node with ID `title`. Inserting `{ use, with }` writes each
 * given value there (see components.ts); a param left out keeps the template's own value.
 */
import { z } from "zod";
import { NodeSchema } from "./node.js";

/** The most components one deck keeps. */
export const MAX_COMPONENTS = 200;
export const MAX_COMPONENT_PARAMS = 20;
export const MAX_PARAM_TARGETS = 10;

/**
 * Words in any script joined by single spaces, `-` or `_`: "Card", "Feature card",
 * "kpi-tile", "Équipe". Agents type them in `use`, so no punctuation or stray spaces.
 */
export const COMPONENT_NAME_PATTERN = /^[\p{L}\p{N}]+(?:[ _-][\p{L}\p{N}]+)*$/u;
export const ComponentNameSchema = z.string().max(60).regex(COMPONENT_NAME_PATTERN, {
  error:
    'Component names are words joined by single spaces, "-" or "_", e.g. "Feature card" or "kpi-tile" (at most 60 characters)',
});

/** Like a JSON key an agent writes in `with`: `title`, `accentColor`, `level_2`. */
export const PARAM_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
export const ParamNameSchema = z.string().regex(PARAM_NAME_PATTERN, {
  error: 'Param names start with a letter, then letters, digits or "_", e.g. "title" or "accent"',
});

/**
 * `<node ID>.<field>[.<field>…]`. Node IDs can't contain dots, so the first segment is
 * always the ID. Fields start with a letter, so `__proto__` can never be one.
 */
export const PARAM_TARGET_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\.[A-Za-z][A-Za-z0-9_-]{0,63}){1,4}$/;
export const ParamTargetSchema = z.string().regex(PARAM_TARGET_PATTERN, {
  error:
    'Expected a target like "title.props.content": a node ID inside the component, then the field (up to 4 levels)',
});

export const ComponentParamSchema = z.strictObject({
  /** What the value means, for whoever inserts it (agents read it in list_components). */
  description: z.string().max(300).optional(),
  targets: z.array(ParamTargetSchema).min(1).max(MAX_PARAM_TARGETS),
});
export type ComponentParam = z.infer<typeof ComponentParamSchema>;

export const ComponentSchema = z.strictObject({
  /** What it's for: shown in the components panel and to agents. */
  description: z.string().max(500).optional(),
  params: z
    .record(ParamNameSchema, ComponentParamSchema)
    .refine((params) => Object.keys(params).length <= MAX_COMPONENT_PARAMS, {
      error: `A component has at most ${MAX_COMPONENT_PARAMS} params`,
    })
    .optional(),
  /** The template: copied with fresh IDs on every insert, never linked to. */
  node: NodeSchema,
});
export type Component = z.infer<typeof ComponentSchema>;

export const ComponentsSchema = z
  .record(ComponentNameSchema, ComponentSchema)
  .refine((all) => Object.keys(all).length <= MAX_COMPONENTS, {
    error: `A deck keeps at most ${MAX_COMPONENTS} components`,
  });
