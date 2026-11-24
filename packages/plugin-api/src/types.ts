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
import type { FieldValues, Sizing } from "@veloce/core";
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

export interface VelocePlugin {
  manifest: PluginManifest;
  // biome-ignore lint/suspicious/noExplicitAny: each element has its own props type
  elements: ReadonlyArray<ElementDefinition<any>>;
}

/** Identity helpers that give plugin authors full type inference. */
export function defineElement<P extends ElementProps>(
  definition: ElementDefinition<P>,
): ElementDefinition<P> {
  return definition;
}

export function definePlugin(plugin: VelocePlugin): VelocePlugin {
  return plugin;
}
