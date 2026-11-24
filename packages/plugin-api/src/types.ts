/**
 * The plugin contract.
 *
 * A plugin contributes **element types** (text, chart, lottie…). Each element type is:
 *   - metadata (type ID, title, one-line description),
 *   - a zod `propsSchema`: the single source of truth that generates the inspector UI, the MCP
 *     tool input (JSON Schema), validation and docs (golden rule #5),
 *   - `aiDocs`: markdown teaching an AI agent how to use it well,
 *   - `mount()`: renders into a container the renderer owns and returns a live instance.
 *
 * Built-in elements use this exact contract (golden rule #6).
 */
import type { EffectContext, FieldValues, ResolvedEffect, Sizing } from "@veloce/core";
import type { z } from "zod";

export type ElementProps = Record<string, unknown>;

export interface PluginManifest {
  /** Namespaced ID, e.g. `"veloce.text"` or `"acme.sparkles"`. */
  id: string;
  name: string;
  /** Semantic version, e.g. `"1.2.0"`. Recorded in plugins.lock.json when a deck is saved. */
  version: string;
  description?: string;
  /** SPDX license identifier, e.g. `"Apache-2.0"`. */
  license?: string;
  homepage?: string;
}

/** Services the renderer gives every mounted element. */
export interface ElementContext {
  /** A URL the browser can load for an asset ID (blob:, file:, http:…, chosen by the renderer). */
  assetUrl(assetId: string): string;
  /**
   * What text fields show on the slide being drawn (D97): its number, the deck's title… A
   * text run with `field` draws `values[run.field]` (core's `runText`). The renderer calls
   * `update(props)` again when they change, so read them while rendering, never cache them.
   * Absent (or null) outside a slide: draw the run's own `text`.
   */
  fields?(): FieldValues | null;
}

/** A mounted element. The renderer drives it; it never drives itself. */
export interface ElementInstance<P extends ElementProps = ElementProps> {
  /** Re-render with new (already validated) props. */
  update(props: P): void;
  /**
   * Show the element as it looks `time` seconds into its slide's timeline (golden rule #3).
   * Plugins never run their own animation loop; the shared clock calls this.
   */
  seek(time: number): void;
  /**
   * Remove everything the element created: DOM children, listeners, timers, workers, WebGL
   * contexts. Must be safe to call twice. The conformance kit checks this.
   */
  dispose(): void;
  /** Optional static image of the element (fallbacks, thumbnails) when DOM capture isn't enough. */
  renderStatic?(): Promise<Blob>;
}

export interface ElementDefinition<P extends ElementProps = ElementProps> {
  /** Element type ID. Built-ins are bare (`"text"`); third-party types are namespaced (`"acme.sparkles"`). */
  type: string;
  title: string;
  /** One line, shown in pickers and the AI's element list. */
  description: string;
  propsSchema: z.ZodType<P, P>;
  /** A complete, valid set of props: used for "insert" in the UI, docs examples and conformance tests. */
  defaultProps: P;
  /** Size used when a node doesn't set width/height. Default: `"hug"` on both axes. */
  defaultSize?: { width?: Sizing; height?: Sizing };
  /** True if `seek(t)` always produces the same output for the same `t` and props. */
  deterministic: boolean;
  /** Markdown for AI agents: what it's for, key props, an example, pitfalls. */
  aiDocs: string;
  /**
   * Render into `container` (an empty element the renderer sizes and positions). Only add
   * children: the container's own attributes and style belong to the renderer.
   */
  mount(container: HTMLElement, props: P, ctx: ElementContext): ElementInstance<P>;
}

/** What an effect is for: bringing a layer in, taking it out, or drawing the eye to it. */
export type EffectKind = "entrance" | "exit" | "emphasis";

export type EffectParams = Record<string, unknown>;

/**
 * An effect preset (D117): a named animation (`"fade-in"`, `"acme.sparkle"`) that turns into
 * keyframe tracks for one layer, shaped by the slide's motion level and the theme's `$motion`
 * tokens. Pure: no DOM, the same tracks for the same input, so it runs in the server, the
 * editor and export alike, and seeking stays deterministic (golden rule 3).
 */
export interface EffectDefinition<P extends EffectParams = EffectParams> {
  /** Built-ins are bare (`"fade-in"`); third-party effects are namespaced (`"acme.sparkle"`). */
  name: string;
  title: string;
  /** One line, shown in the preset gallery and the AI's effect list. */
  description: string;
  kind: EffectKind;
  /**
   * Its settings (direction, distance…), every field optional: an effect with no params
   * plays as `defaultParams` say. One schema for validation, the inspector, MCP and docs
   * (golden rule 5).
   */
  paramsSchema: z.ZodType<P, P>;
  /**
   * Defaults for the params that have fixed ones: what `{ "name": "…" }` alone plays. A
   * param left out here is decided in `resolve`, usually by the level (how far a slide-in
   * travels).
   */
  defaultParams: P;
  /** Element types it can play on (`["text"]`); omitted: any layer, frames included. */
  targets?: readonly string[];
  /** Markdown for AI agents: what it looks like, when to use it, its params. */
  aiDocs: string;
  /**
   * The tracks it plays, and the duration and easing it wants when the animation sets none
   * (`$motion` tokens, so they follow the level). `params` have `defaultParams` filled in;
   * `context.tokens.distance` says how far things travel at this level.
   */
  resolve(params: P, context: EffectContext): ResolvedEffect;
}

export interface VelocePlugin {
  manifest: PluginManifest;
  // biome-ignore lint/suspicious/noExplicitAny: each element has its own props type
  elements: ReadonlyArray<ElementDefinition<any>>;
  /** Effect presets it adds (D117). */
  // biome-ignore lint/suspicious/noExplicitAny: each effect has its own params type
  effects?: ReadonlyArray<EffectDefinition<any>>;
}

/** Identity helpers that give plugin authors full type inference. */
export function defineElement<P extends ElementProps>(
  definition: ElementDefinition<P>,
): ElementDefinition<P> {
  return definition;
}

export function defineEffect<P extends EffectParams>(
  definition: EffectDefinition<P>,
): EffectDefinition<P> {
  return definition;
}

export function definePlugin(plugin: VelocePlugin): VelocePlugin {
  return plugin;
}
